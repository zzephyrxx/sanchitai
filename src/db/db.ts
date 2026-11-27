import dayjs from 'dayjs';
/**
 * 三尺台 本地数据库（Dexie / IndexedDB）
 *
 * 单一 DB 工厂（schema 集中、加法演进，不轻率提升 Dexie 版本以兼容旧版回退）。
 * 备份：环形快照自动 10 份 + 手动 10 份（meta 表 + 桌面端落盘）+ BackupShape 统一迁移与导入导出管线。
 */
import { Dexie } from 'dexie';
import type { Table } from 'dexie';
import { APP_VERSION } from '@/constants/changelog';
import { computeNextDevNode, isStageFullyArchived } from '@/constants/dev-nodes';
import { DEFAULT_BRANCH_NAME } from '@/constants/workspace-presets';
import { formatMemberCode, getBranchAbbreviation } from '@/utils/member-code';
import { normalizeMemberRecord } from '@/utils/member-status';
import seedJson from './seed/seed-data.json';

export const DB_NAME = 'sanchitai-db';
export const CURRENT_SCHEMA_VERSION = 8;
export const BACKUP_RING_SIZE = 10;

const BUILTIN_DOC_TEMPLATES: Sct.DocTemplate[] = (
  (seedJson as unknown as { docTemplates?: Sct.DocTemplate[] }).docTemplates ?? []
).map(tpl => ({ ...tpl, identity: 'secretary' }));

export function getBuiltinDocTemplates(): Sct.DocTemplate[] {
  return BUILTIN_DOC_TEMPLATES.map(tpl => JSON.parse(JSON.stringify(tpl)) as Sct.DocTemplate);
}

export interface MetaRow {
  key: string;
  value: unknown;
}

class SanchitaiDB extends Dexie {
  // 注意：必须用 declare —— useDefineForClassFields 会把普通字段声明覆写为 undefined，
  // 盖掉 Dexie 构造时动态赋值的 Table 实例（Dexie 官方 TS 指南要求）
  declare members: Table<Sct.Member, string>;
  declare seatMaps: Table<Sct.SeatMap, string>;
  declare calEvents: Table<Sct.CalEvent, string>;
  declare devStages: Table<Sct.DevStage, string>;
  declare feeRecords: Table<Sct.FeeRecord, [string, string]>;
  declare talks: Table<Sct.Talk, string>;
  declare docTemplates: Table<Sct.DocTemplate, string>;
  declare docs: Table<Sct.Doc, string>;
  declare attendance: Table<Sct.Attendance, string>;
  declare pointRecords: Table<Sct.PointRecord, string>;
  declare pointVetoes: Table<Sct.PointVeto, string>;
  declare transferRecords: Table<Sct.TransferRecord, string>;
  declare volunteerActivities: Table<Sct.VolunteerActivity, string>;
  declare meta: Table<MetaRow, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      // v1 曾使用 snake_case 表名（与类属性不一致导致取表失败），v2 改为驼峰
      members: 'id, identity, type, group, name',
      seat_maps: 'map_id, identity',
      cal_events: 'id, identity, date, category, kind, status, merged_into',
      dev_stages: 'member_id, identity, stage',
      fee_records: '[member_id+year_month], member_id, year_month, identity, status',
      talks: 'id, identity, date',
      doc_templates: 'id, identity, category',
      docs: 'id, identity, created_at',
      meta: 'key'
    });

    this.version(2).stores({
      // 删除 v1 的 snake_case 表
      seat_maps: null,
      cal_events: null,
      dev_stages: null,
      fee_records: null,
      doc_templates: null,
      // v2 正式 schema（驼峰，与类属性同名）
      seatMaps: 'map_id, identity',
      calEvents: 'id, identity, date, category, kind, status, merged_into',
      devStages: 'member_id, identity, stage',
      feeRecords: '[member_id+year_month], member_id, year_month, identity, status',
      docTemplates: 'id, identity, category'
      // members / talks / docs / meta 沿用 v1 定义
    });

    // v3：会议考勤表
    this.version(3).stores({
      attendance: 'id, event_id, member_id, identity'
    });

    // v4：党员信息表增加 join_date / full_date 索引，并回填转正时间与自动身份状态
    this.version(4)
      .stores({
        members: 'id, identity, type, group, name, join_date, full_date'
      })
      .upgrade(async tx => {
        const today = dayjs().format('YYYY-MM-DD');
        await tx
          .table('members')
          .toCollection()
          .modify((m: Sct.Member) => {
            const normalized = normalizeMemberRecord(m, today);
            m.type = normalized.type;
            m.join_date = normalized.join_date;
            m.full_date = normalized.full_date;
            if (normalized.key_dates) {
              m.key_dates = normalized.key_dates;
            }
          });
      });

    // v5：党员信息表扩展（学号/性别/民族/出生年月/宿舍/班级/身份证号/联系电话/支部名称），并规范编号为「支部缩写+3位数字」
    this.version(5)
      .stores({
        members: 'id, identity, code, student_id, type, group, name, join_date, full_date'
      })
      .upgrade(async tx => {
        const metaRow = (await tx.table('meta').get('branch-name')) as MetaRow | undefined;
        const defaultBranch =
          typeof metaRow?.value === 'string' && metaRow.value.trim() ? metaRow.value.trim() : DEFAULT_BRANCH_NAME;
        const prefix = getBranchAbbreviation(defaultBranch);
        const rows = (await tx.table('members').toArray()) as Sct.Member[];
        const legacyRe = /^(DY|FZ|JJ|SQ)\d+$/i;
        const randomRe = /^M[A-Za-z0-9_-]{6}$/;
        const prefixRe = new RegExp(`^${prefix}(\\d+)$`, 'i');

        let maxSeq = 0;
        for (const m of rows) {
          const hit = (m.code ?? '').trim().match(prefixRe);
          if (hit) {
            maxSeq = Math.max(maxSeq, Number(hit[1]) || 0);
          }
        }

        for (const m of rows) {
          let changed = false;
          if (!m.branch_name?.trim()) {
            m.branch_name = defaultBranch;
            changed = true;
          }
          const curCode = (m.code ?? '').trim();
          if (!curCode || legacyRe.test(curCode) || randomRe.test(curCode)) {
            maxSeq += 1;
            m.code = formatMemberCode(prefix, maxSeq);
            changed = true;
          }
          if (changed) {
            await tx.table('members').put(m);
          }
        }
      });

    // v6：党员积分台账（年度积分明细表 + 一票否决表）
    this.version(6).stores({
      pointRecords: 'id, member_id, year, date, category, status, identity',
      pointVetoes: 'id, member_id, year, identity'
    });

    // v7：全系统「研究方向组」迁移为「第 X 党小组」（仅迁移旧演示组名，保留用户自定义名称）
    this.version(7)
      .stores({})
      .upgrade(async tx => {
        const legacyMap: Record<string, string> = {
          视算一组: '第一党小组',
          视算二组: '第二党小组',
          博士组: '第三党小组',
          软件组: '第四党小组',
          综合方向组: ''
        };
        await tx
          .table('members')
          .toCollection()
          .modify((m: Sct.Member) => {
            const g = (m.group ?? '').trim();
            if (g in legacyMap) {
              m.group = legacyMap[g];
            }
          });
      });

    // v8：成员全生命周期状态索引 + 组织关系转接表 + 志愿时长活动表
    this.version(8)
      .stores({
        members: 'id, identity, code, student_id, type, lifecycle_status, group, name, join_date, full_date',
        transferRecords: 'id, member_id, direction, status, initiated_date, identity',
        volunteerActivities: 'id, date, source, status, event_id, identity'
      })
      .upgrade(async tx => {
        await tx
          .table('members')
          .toCollection()
          .modify((m: Sct.Member) => {
            if (!m.lifecycle_status) {
              m.lifecycle_status = '在册正常';
            }
          });
      });
  }
}

export const db = new SanchitaiDB();

// ---------------- meta ----------------

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

// ---------------- 备份与迁移 ----------------

export interface BackupShape {
  schemaVersion: number;
  app_version?: string;
  exported_at: string;
  snapshot_label?: string;
  branch_name?: string;
  members: Sct.Member[];
  seat_maps: Sct.SeatMap[];
  cal_events: Sct.CalEvent[];
  dev_stages: Sct.DevStage[];
  fee_records: Sct.FeeRecord[];
  talks: Sct.Talk[];
  doc_templates: Sct.DocTemplate[];
  docs: Sct.Doc[];
  attendance?: Sct.Attendance[];
  point_records?: Sct.PointRecord[];
  point_vetoes?: Sct.PointVeto[];
  point_rules?: Sct.PointRuleItem[];
  point_schemes?: Sct.PointScheme[];
  point_year_scheme?: Record<string, string>;
  point_year_snapshots?: Record<string, Sct.PointScheme>;
  transfer_records?: Sct.TransferRecord[];
  volunteer_activities?: Sct.VolunteerActivity[];
  workspace_config?: Sct.WorkspaceConfig;
  party_groups?: string[];
  youth_committee_slots?: Sct.YouthCommitteeSlot[];
  academy_flow?: unknown;
  knowledge_custom_items?: unknown;
  knowledge_hidden_ids?: string[];
  policy_cards?: unknown;
  policy_files?: Record<string, unknown>;
  [extra: string]: unknown;
}

export type SnapshotKind = 'auto' | 'manual';

export interface BackupSnapshotEntry {
  key: string;
  kind: SnapshotKind;
  ts: string;
  shape: BackupShape;
}

export interface DiskSnapshotHooks {
  onPush?: (kind: SnapshotKind, key: string, shape: BackupShape) => Promise<void> | void;
  onDelete?: (kind: SnapshotKind, key: string) => Promise<void> | void;
  onListDisk?: () => Promise<BackupSnapshotEntry[]>;
}

let diskSnapshotHooks: DiskSnapshotHooks | null = null;

export function registerDiskSnapshotHooks(hooks: DiskSnapshotHooks) {
  diskSnapshotHooks = hooks;
}

/**
 * 增量式版本迁移（v1~v5 向上兼容，不丢弃未知字段）：
 * - 统一修正成员入党/转正身份
 * - 修正已完成归档的正式党员残留「材料归档」next_node
 * - 当材料模板为空时自动兜底内置默认党支部模板
 */
export function migrateBackupShape(raw: unknown): BackupShape {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const today = dayjs().format('YYYY-MM-DD');
  const rawMembers = Array.isArray(src.members) ? (src.members as Sct.Member[]) : [];
  const normalizedMembers = rawMembers.map(m => ({
    ...normalizeMemberRecord(m, today),
    lifecycle_status: m.lifecycle_status ?? '在册正常'
  }));

  const rawStages = Array.isArray(src.dev_stages) ? (src.dev_stages as Sct.DevStage[]) : [];
  const normalizedStages = rawStages.map(stage => {
    const materials = Array.isArray(stage.materials) ? stage.materials : [];
    const nextNode =
      stage.stage === '正式党员' && isStageFullyArchived(stage.stage, materials)
        ? ''
        : stage.next_node === '材料归档' && isStageFullyArchived(stage.stage, materials)
          ? ''
          : (stage.next_node ?? computeNextDevNode(stage.stage, materials));
    return {
      ...stage,
      materials,
      next_node: nextNode
    };
  });

  const rawTemplates = Array.isArray(src.doc_templates) ? (src.doc_templates as Sct.DocTemplate[]) : [];
  const docTemplates = rawTemplates.length > 0 ? rawTemplates : getBuiltinDocTemplates();

  const sourceSchema = typeof src.schemaVersion === 'number' ? src.schemaVersion : 1;

  return {
    ...src,
    schemaVersion: Math.max(sourceSchema, CURRENT_SCHEMA_VERSION),
    app_version: typeof src.app_version === 'string' ? src.app_version : APP_VERSION,
    exported_at: typeof src.exported_at === 'string' ? src.exported_at : new Date().toISOString(),
    branch_name:
      typeof src.branch_name === 'string' && src.branch_name.trim() ? src.branch_name.trim() : DEFAULT_BRANCH_NAME,
    members: normalizedMembers,
    seat_maps: Array.isArray(src.seat_maps) ? (src.seat_maps as Sct.SeatMap[]) : [],
    cal_events: Array.isArray(src.cal_events) ? (src.cal_events as Sct.CalEvent[]) : [],
    dev_stages: normalizedStages,
    fee_records: Array.isArray(src.fee_records) ? (src.fee_records as Sct.FeeRecord[]) : [],
    talks: Array.isArray(src.talks) ? (src.talks as Sct.Talk[]) : [],
    doc_templates: docTemplates,
    docs: Array.isArray(src.docs) ? (src.docs as Sct.Doc[]) : [],
    attendance: Array.isArray(src.attendance) ? (src.attendance as Sct.Attendance[]) : [],
    point_records: Array.isArray(src.point_records) ? (src.point_records as Sct.PointRecord[]) : [],
    point_vetoes: Array.isArray(src.point_vetoes) ? (src.point_vetoes as Sct.PointVeto[]) : [],
    point_rules: Array.isArray(src.point_rules) ? (src.point_rules as Sct.PointRuleItem[]) : undefined,
    point_schemes: Array.isArray(src.point_schemes) ? (src.point_schemes as Sct.PointScheme[]) : undefined,
    point_year_scheme:
      src.point_year_scheme && typeof src.point_year_scheme === 'object'
        ? (src.point_year_scheme as Record<string, string>)
        : undefined,
    point_year_snapshots:
      src.point_year_snapshots && typeof src.point_year_snapshots === 'object'
        ? (src.point_year_snapshots as Record<string, Sct.PointScheme>)
        : undefined,
    transfer_records: Array.isArray(src.transfer_records) ? (src.transfer_records as Sct.TransferRecord[]) : [],
    volunteer_activities: Array.isArray(src.volunteer_activities)
      ? (src.volunteer_activities as Sct.VolunteerActivity[])
      : [],
    workspace_config:
      src.workspace_config && typeof src.workspace_config === 'object'
        ? (src.workspace_config as Sct.WorkspaceConfig)
        : undefined,
    party_groups: Array.isArray(src.party_groups) ? (src.party_groups as string[]) : undefined,
    youth_committee_slots: Array.isArray(src.youth_committee_slots)
      ? (src.youth_committee_slots as Sct.YouthCommitteeSlot[])
      : undefined,
    academy_flow: src.academy_flow,
    knowledge_custom_items: src.knowledge_custom_items,
    knowledge_hidden_ids: Array.isArray(src.knowledge_hidden_ids) ? (src.knowledge_hidden_ids as string[]) : undefined,
    policy_cards: src.policy_cards,
    policy_files:
      src.policy_files && typeof src.policy_files === 'object'
        ? (src.policy_files as Record<string, unknown>)
        : undefined
  };
}

const BUILTIN_TPL_SYNC_KEY = 'doc-templates-v028-synced';

function isOlderThanV028(version?: string): boolean {
  if (!version) return true;
  const parts = version
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map(n => Number.parseInt(n, 10) || 0);
  const [maj = 0, min = 0, pat = 0] = parts;
  if (maj !== 0) return maj < 0;
  if (min !== 2) return min < 2;
  return pat < 8;
}

/** 确保材料库内置党支部模板存在；首次升级至 v0.2.8 时无损补齐新增内置模板（不覆盖已有修改） */
export async function ensureDefaultDocTemplates(): Promise<number> {
  const builtins = getBuiltinDocTemplates();
  if (!builtins.length) return 0;

  const existing = await db.docTemplates.toArray();
  if (existing.length === 0) {
    await db.docTemplates.bulkPut(builtins);
    await setMeta(BUILTIN_TPL_SYNC_KEY, true);
    return builtins.length;
  }

  const synced = await getMeta<boolean>(BUILTIN_TPL_SYNC_KEY);
  if (synced) return 0;

  const existingIds = new Set(existing.map(t => t.id));
  const missing = builtins.filter(t => !existingIds.has(t.id));
  if (missing.length) {
    await db.docTemplates.bulkPut(missing);
  }
  await setMeta(BUILTIN_TPL_SYNC_KEY, true);
  return missing.length;
}

/** 全库导出为统一备份格式（schemaVersion = 8） */
export async function exportBackup(): Promise<BackupShape> {
  const [
    members,
    seat_maps,
    cal_events,
    dev_stages,
    fee_records,
    talks,
    doc_templates,
    docs,
    attendance,
    point_records,
    point_vetoes,
    transfer_records,
    volunteer_activities,
    allMetaRows
  ] = await Promise.all([
    db.members.toArray(),
    db.seatMaps.toArray(),
    db.calEvents.toArray(),
    db.devStages.toArray(),
    db.feeRecords.toArray(),
    db.talks.toArray(),
    db.docTemplates.toArray(),
    db.docs.toArray(),
    db.attendance.toArray(),
    db.pointRecords.toArray(),
    db.pointVetoes.toArray(),
    db.transferRecords.toArray(),
    db.volunteerActivities.toArray(),
    db.meta.toArray()
  ]);

  const metaMap = new Map<string, unknown>();
  const policyFiles: Record<string, unknown> = {};
  for (const row of allMetaRows) {
    if (row.key.startsWith('policy-file-')) {
      policyFiles[row.key] = row.value;
    } else if (!row.key.startsWith('backup-')) {
      metaMap.set(row.key, row.value);
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    branch_name: (metaMap.get('branch-name') as string | undefined) || DEFAULT_BRANCH_NAME,
    members,
    seat_maps,
    cal_events,
    dev_stages,
    fee_records,
    talks,
    doc_templates: doc_templates.length > 0 ? doc_templates : getBuiltinDocTemplates(),
    docs,
    attendance,
    point_records,
    point_vetoes,
    point_rules: metaMap.get('point-rules') as Sct.PointRuleItem[] | undefined,
    point_schemes: metaMap.get('point-schemes') as Sct.PointScheme[] | undefined,
    point_year_scheme: metaMap.get('point-year-scheme') as Record<string, string> | undefined,
    point_year_snapshots: metaMap.get('point-year-snapshots') as Record<string, Sct.PointScheme> | undefined,
    transfer_records,
    volunteer_activities,
    workspace_config: metaMap.get('workspace-config') as Sct.WorkspaceConfig | undefined,
    party_groups: metaMap.get('party-groups') as string[] | undefined,
    youth_committee_slots: metaMap.get('youth-committee-slots') as Sct.YouthCommitteeSlot[] | undefined,
    academy_flow: metaMap.get('academy-flow'),
    knowledge_custom_items: metaMap.get('knowledge-custom-items'),
    knowledge_hidden_ids: metaMap.get('knowledge-hidden-ids') as string[] | undefined,
    policy_cards: metaMap.get('policy-cards-v1'),
    policy_files: Object.keys(policyFiles).length > 0 ? policyFiles : undefined
  };
}

/** 写入环形快照（自动与手动各独立保留最近 10 份，并同步落盘到桌面端数据目录） */
export async function pushBackupRing(kind: SnapshotKind = 'auto', label?: string): Promise<BackupSnapshotEntry> {
  const cursorKey = kind === 'manual' ? 'backup_ring_cursor_manual' : 'backup_ring_cursor_auto';
  const ring = (await getMeta<number>(cursorKey)) ?? 0;
  const slot = ring % BACKUP_RING_SIZE;
  const key = `backup-${kind}-${slot}`;
  const snapshot = await exportBackup();
  if (label?.trim()) {
    snapshot.snapshot_label = label.trim();
  }
  await setMeta(key, snapshot);
  await setMeta(cursorKey, (slot + 1) % BACKUP_RING_SIZE);
  try {
    await diskSnapshotHooks?.onPush?.(kind, key, snapshot);
  } catch {
    /* 落盘失败不影响本地快照 */
  }
  return { key, kind, ts: snapshot.exported_at, shape: snapshot };
}

/** 读取环形快照（按新→旧；自动合并 IndexedDB 与桌面端磁盘快照，向下兼容旧版 backup-0..4） */
export async function listBackupRing(kind?: SnapshotKind): Promise<BackupSnapshotEntry[]> {
  const rows = await db.meta.filter(r => r.key.startsWith('backup-')).toArray();
  const legacyRe = /^backup-\d+$/;
  const merged = new Map<string, BackupSnapshotEntry>();

  for (const r of rows) {
    if (r.key.includes('cursor') || !r.value) continue;
    const shape = r.value as BackupShape;
    const entryKind: SnapshotKind = r.key.startsWith('backup-manual-')
      ? 'manual'
      : r.key.startsWith('backup-auto-') || legacyRe.test(r.key)
        ? 'auto'
        : 'auto';
    merged.set(r.key, { key: r.key, kind: entryKind, ts: shape.exported_at, shape });
  }

  try {
    const diskEntries = (await diskSnapshotHooks?.onListDisk?.()) ?? [];
    for (const d of diskEntries) {
      const existing = merged.get(d.key);
      if (!existing || d.ts > existing.ts) {
        merged.set(d.key, d);
      }
    }
  } catch {
    /* ignore disk snapshot errors */
  }

  return Array.from(merged.values())
    .filter(entry => (!kind ? true : entry.kind === kind))
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
}

/** 删除指定本地快照（同步清理桌面磁盘副本） */
export async function deleteBackupSnapshot(key: string): Promise<void> {
  if (!key.startsWith('backup-') || key.includes('cursor')) return;
  const kind: SnapshotKind = key.startsWith('backup-manual-') ? 'manual' : 'auto';
  await db.meta.delete(key);
  try {
    await diskSnapshotHooks?.onDelete?.(kind, key);
  } catch {
    /* ignore */
  }
}

/** 按入党/转正时间自动同步党员身份（预备期届满自动转为正式党员，无需手动确认） */
export async function syncMemberPartyStatuses(): Promise<number> {
  const today = dayjs().format('YYYY-MM-DD');
  const allMembers = await db.members.toArray();
  const updates: Array<{ next: Sct.Member; typeChanged: boolean }> = [];

  for (const m of allMembers) {
    const next = normalizeMemberRecord(m, today);
    const typeChanged = next.type !== m.type;
    const dateChanged = next.full_date !== (m.full_date ?? '') || next.join_date !== (m.join_date ?? '');
    if (typeChanged || dateChanged) {
      updates.push({ next, typeChanged });
    }
  }

  if (!updates.length) return 0;

  await db.transaction('rw', [db.members, db.devStages], async () => {
    for (const { next, typeChanged } of updates) {
      await db.members.put(next);
      if (typeChanged) {
        const prevStage = await db.devStages.get(next.id);
        const materials = prevStage?.materials ?? [];
        const computedNext = computeNextDevNode(next.type, materials);
        await db.devStages.put({
          member_id: next.id,
          stage: next.type,
          stage_date: next.type === '正式党员' ? next.full_date || today : next.join_date || today,
          next_node: computedNext,
          next_due: next.type === '预备党员' ? next.full_date || prevStage?.next_due : undefined,
          materials,
          timeline: [
            ...(prevStage?.timeline ?? []),
            {
              node: next.type === '正式党员' ? '预备期满自动转为正式党员' : `身份同步为${next.type}`,
              date: today,
              note: '按入党/转正时间自动计算'
            }
          ],
          identity: 'secretary'
        });
      }
    }
  });

  return updates.filter(u => u.typeChanged).length;
}

/** 写入核心党务台账分组（原子写入含关联 meta 键，缺失可选字段时显式清理旧值防脏数据残留） */
async function replaceCoreTables(shape: BackupShape): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.members,
      db.seatMaps,
      db.calEvents,
      db.devStages,
      db.feeRecords,
      db.talks,
      db.attendance,
      db.pointRecords,
      db.pointVetoes,
      db.transferRecords,
      db.volunteerActivities,
      db.meta
    ],
    async () => {
      await Promise.all([
        db.members.clear(),
        db.seatMaps.clear(),
        db.calEvents.clear(),
        db.devStages.clear(),
        db.feeRecords.clear(),
        db.talks.clear(),
        db.attendance.clear(),
        db.pointRecords.clear(),
        db.pointVetoes.clear(),
        db.transferRecords.clear(),
        db.volunteerActivities.clear()
      ]);
      await Promise.all([
        db.members.bulkPut(shape.members ?? []),
        db.seatMaps.bulkPut(shape.seat_maps ?? []),
        db.calEvents.bulkPut(shape.cal_events ?? []),
        db.devStages.bulkPut(shape.dev_stages ?? []),
        db.feeRecords.bulkPut(shape.fee_records ?? []),
        db.talks.bulkPut(shape.talks ?? []),
        db.attendance.bulkPut(shape.attendance ?? []),
        db.pointRecords.bulkPut(shape.point_records ?? []),
        db.pointVetoes.bulkPut(shape.point_vetoes ?? []),
        db.transferRecords.bulkPut(shape.transfer_records ?? []),
        db.volunteerActivities.bulkPut(shape.volunteer_activities ?? [])
      ]);

      if (shape.branch_name && typeof shape.branch_name === 'string') {
        await db.meta.put({ key: 'branch-name', value: shape.branch_name.trim() });
      }
      if (Array.isArray(shape.point_rules)) {
        await db.meta.put({ key: 'point-rules', value: shape.point_rules });
      } else {
        await db.meta.delete('point-rules');
      }
      if (Array.isArray(shape.point_schemes)) {
        await db.meta.put({ key: 'point-schemes', value: shape.point_schemes });
      } else {
        await db.meta.delete('point-schemes');
      }
      if (shape.point_year_scheme && typeof shape.point_year_scheme === 'object') {
        await db.meta.put({ key: 'point-year-scheme', value: shape.point_year_scheme });
      } else {
        await db.meta.delete('point-year-scheme');
      }
      if (shape.point_year_snapshots && typeof shape.point_year_snapshots === 'object') {
        await db.meta.put({ key: 'point-year-snapshots', value: shape.point_year_snapshots });
      } else {
        await db.meta.delete('point-year-snapshots');
      }
      if (shape.workspace_config && typeof shape.workspace_config === 'object') {
        await db.meta.put({ key: 'workspace-config', value: shape.workspace_config });
      }
      if (Array.isArray(shape.party_groups)) {
        await db.meta.put({ key: 'party-groups', value: shape.party_groups });
      } else {
        await db.meta.delete('party-groups');
      }
      if (Array.isArray(shape.youth_committee_slots)) {
        await db.meta.put({ key: 'youth-committee-slots', value: shape.youth_committee_slots });
      } else {
        await db.meta.delete('youth-committee-slots');
      }
    }
  );
}

/** 写入材料库、资料库与流程图分组（原子事务并清理缺失的旧归档文件） */
async function replaceLibraryTables(shape: BackupShape): Promise<void> {
  const templates =
    Array.isArray(shape.doc_templates) && shape.doc_templates.length > 0
      ? shape.doc_templates
      : getBuiltinDocTemplates();
  await db.transaction('rw', [db.docTemplates, db.docs, db.meta], async () => {
    await Promise.all([db.docTemplates.clear(), db.docs.clear()]);
    await Promise.all([db.docTemplates.bulkPut(templates), db.docs.bulkPut(shape.docs ?? [])]);
    if (isOlderThanV028(shape.app_version)) {
      await db.meta.delete(BUILTIN_TPL_SYNC_KEY);
    }

    if (shape.academy_flow !== undefined) {
      await db.meta.put({ key: 'academy-flow', value: shape.academy_flow });
    } else {
      await db.meta.delete('academy-flow');
    }
    if (shape.knowledge_custom_items !== undefined) {
      await db.meta.put({ key: 'knowledge-custom-items', value: shape.knowledge_custom_items });
    } else {
      await db.meta.delete('knowledge-custom-items');
    }
    if (shape.knowledge_hidden_ids !== undefined) {
      await db.meta.put({ key: 'knowledge-hidden-ids', value: shape.knowledge_hidden_ids });
    } else {
      await db.meta.delete('knowledge-hidden-ids');
    }
    if (shape.policy_cards !== undefined) {
      await db.meta.put({ key: 'policy-cards-v1', value: shape.policy_cards });
    } else {
      await db.meta.delete('policy-cards-v1');
    }
    const oldFileKeys = (await db.meta.filter(r => r.key.startsWith('policy-file-')).primaryKeys()) as string[];
    if (oldFileKeys.length) {
      await db.meta.bulkDelete(oldFileKeys);
    }
    if (shape.policy_files && typeof shape.policy_files === 'object') {
      const entries = Object.entries(shape.policy_files).map(([key, value]) => ({ key, value }));
      if (entries.length) {
        await db.meta.bulkPut(entries);
      }
    }
  });
}

/** 静默替换业务数据（供桌面端 ⇄ 浏览器本机微服务实时同步使用，不写入环形快照） */
export async function replaceDataFromSync(rawShape: BackupShape): Promise<void> {
  const shape = migrateBackupShape(rawShape);
  await replaceCoreTables(shape);
  await replaceLibraryTables(shape);
}

/** 按模块选择性导入（导入前先自动快照当前库，仅替换所选分组） */
export async function importSelectiveBackup(
  rawShape: BackupShape,
  modules: { core?: boolean; library?: boolean }
): Promise<void> {
  await pushBackupRing('auto');
  const shape = migrateBackupShape(rawShape);
  if (modules.core) {
    await replaceCoreTables(shape);
  }
  if (modules.library) {
    await replaceLibraryTables(shape);
  }
}

/** 导入备份：先自动快照当前库，再整体替换 */
export async function importBackup(shape: BackupShape): Promise<void> {
  await pushBackupRing('auto');
  await replaceDataFromSync(shape);
}

/** 清空全部业务数据（保留 meta 备份、工作台配置与种子标记，并保留材料库内置默认模板） */
export async function clearAllData(): Promise<void> {
  const builtins = getBuiltinDocTemplates();
  await db.transaction(
    'rw',
    [
      db.members,
      db.seatMaps,
      db.calEvents,
      db.devStages,
      db.feeRecords,
      db.talks,
      db.docTemplates,
      db.docs,
      db.attendance,
      db.pointRecords,
      db.pointVetoes,
      db.transferRecords,
      db.volunteerActivities,
      db.meta
    ],
    async () => {
      await Promise.all([
        db.members.clear(),
        db.seatMaps.clear(),
        db.calEvents.clear(),
        db.devStages.clear(),
        db.feeRecords.clear(),
        db.talks.clear(),
        db.docTemplates.clear(),
        db.docs.clear(),
        db.attendance.clear(),
        db.pointRecords.clear(),
        db.pointVetoes.clear(),
        db.transferRecords.clear(),
        db.volunteerActivities.clear()
      ]);
      const policyFileKeys = (await db.meta.filter(r => r.key.startsWith('policy-file-')).primaryKeys()) as string[];
      await db.meta.bulkDelete([
        'party-groups',
        'youth-committee-slots',
        'point-rules',
        'point-schemes',
        'point-year-scheme',
        'point-year-snapshots',
        'academy-flow',
        'knowledge-custom-items',
        'knowledge-hidden-ids',
        'policy-cards-v1',
        ...policyFileKeys
      ]);
      if (builtins.length) {
        await db.docTemplates.bulkPut(builtins);
      }
    }
  );
}
