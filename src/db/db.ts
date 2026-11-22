import dayjs from 'dayjs';
/**
 * 三尺台 本地数据库（Dexie / IndexedDB）
 *
 * 单一 DB 工厂（借鉴 SP runDbUpgrade 教训：schema 集中、加法演进）。
 * 备份：环形快照 5 份（meta 表）+ BackupShape 统一导入导出管线。
 */
import { Dexie } from 'dexie';
import type { Table } from 'dexie';
import { formatMemberCode, getBranchAbbreviation } from '@/utils/member-code';
import { normalizeMemberRecord } from '@/utils/member-status';

export const DB_NAME = 'sanchitai-db';

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
          typeof metaRow?.value === 'string' && metaRow.value.trim() ? metaRow.value.trim() : '智感硕博党支部';
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

// ---------------- 备份 ----------------

export interface BackupShape {
  schemaVersion: number;
  exported_at: string;
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
  party_groups?: string[];
  youth_committee_slots?: Sct.YouthCommitteeSlot[];
}

export type SnapshotKind = 'auto' | 'manual';

export interface BackupSnapshotEntry {
  key: string;
  kind: SnapshotKind;
  ts: string;
  shape: BackupShape;
}

const BACKUP_RING_SIZE = 5;

/** 全库导出为统一备份格式 */
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
    branchName,
    pointRules,
    partyGroups,
    youthSlots
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
    getMeta<string>('branch-name'),
    getMeta<Sct.PointRuleItem[]>('point-rules'),
    getMeta<string[]>('party-groups'),
    getMeta<Sct.YouthCommitteeSlot[]>('youth-committee-slots')
  ]);
  return {
    schemaVersion: 4,
    exported_at: new Date().toISOString(),
    branch_name: branchName || '智感硕博党支部',
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
    point_rules: pointRules,
    party_groups: partyGroups,
    youth_committee_slots: youthSlots
  };
}

/** 写入环形快照（自动与手动各独立保留最近 5 份） */
export async function pushBackupRing(kind: SnapshotKind = 'auto'): Promise<void> {
  const cursorKey = kind === 'manual' ? 'backup_ring_cursor_manual' : 'backup_ring_cursor_auto';
  const ring = (await getMeta<number>(cursorKey)) ?? 0;
  const snapshot = await exportBackup();
  await setMeta(`backup-${kind}-${ring}`, snapshot);
  await setMeta(cursorKey, (ring + 1) % BACKUP_RING_SIZE);
}

/** 读取环形快照（按新→旧；可按 auto/manual 筛选，自动快照向下兼容旧版 backup-0..4） */
export async function listBackupRing(kind?: SnapshotKind): Promise<BackupSnapshotEntry[]> {
  const rows = await db.meta.filter(r => r.key.startsWith('backup-')).toArray();
  const legacyRe = /^backup-\d+$/;
  return rows
    .filter(r => !r.key.includes('cursor') && r.value)
    .map(r => {
      const shape = r.value as BackupShape;
      const entryKind: SnapshotKind = r.key.startsWith('backup-manual-')
        ? 'manual'
        : r.key.startsWith('backup-auto-') || legacyRe.test(r.key)
          ? 'auto'
          : 'auto';
      return { key: r.key, kind: entryKind, ts: shape.exported_at, shape };
    })
    .filter(entry => (!kind ? true : entry.kind === kind))
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

/** 删除指定本地快照 */
export async function deleteBackupSnapshot(key: string): Promise<void> {
  if (!key.startsWith('backup-') || key.includes('cursor')) return;
  await db.meta.delete(key);
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
        await db.devStages.put({
          member_id: next.id,
          stage: next.type,
          stage_date: next.type === '正式党员' ? next.full_date || today : next.join_date || today,
          next_node: next.type === '正式党员' ? '材料归档' : prevStage?.next_node,
          next_due: next.type === '预备党员' ? next.full_date || prevStage?.next_due : undefined,
          materials: prevStage?.materials ?? [],
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

/** 静默替换业务数据（供桌面端 ⇄ 浏览器本机微服务实时同步使用，不写入环形快照） */
export async function replaceDataFromSync(shape: BackupShape): Promise<void> {
  const today = dayjs().format('YYYY-MM-DD');
  const normalizedMembers = (shape.members ?? []).map(m => normalizeMemberRecord(m, today));
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
      db.pointVetoes
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
        db.pointVetoes.clear()
      ]);
      await Promise.all([
        db.members.bulkPut(normalizedMembers),
        db.seatMaps.bulkPut(shape.seat_maps ?? []),
        db.calEvents.bulkPut(shape.cal_events ?? []),
        db.devStages.bulkPut(shape.dev_stages ?? []),
        db.feeRecords.bulkPut(shape.fee_records ?? []),
        db.talks.bulkPut(shape.talks ?? []),
        db.docTemplates.bulkPut(shape.doc_templates ?? []),
        db.docs.bulkPut(shape.docs ?? []),
        db.attendance.bulkPut(shape.attendance ?? []),
        db.pointRecords.bulkPut(shape.point_records ?? []),
        db.pointVetoes.bulkPut(shape.point_vetoes ?? [])
      ]);
    }
  );
  if (shape.branch_name && typeof shape.branch_name === 'string') {
    await setMeta('branch-name', shape.branch_name.trim());
  }
  if (Array.isArray(shape.point_rules)) {
    await setMeta('point-rules', shape.point_rules);
  }
  if (Array.isArray(shape.party_groups)) {
    await setMeta('party-groups', shape.party_groups);
  }
  if (Array.isArray(shape.youth_committee_slots)) {
    await setMeta('youth-committee-slots', shape.youth_committee_slots);
  }
}

/** 导入备份：先自动快照当前库，再整体替换 */
export async function importBackup(shape: BackupShape): Promise<void> {
  await pushBackupRing();
  await replaceDataFromSync(shape);
}

/** 清空全部业务数据（保留 meta 备份与种子标记） */
export async function clearAllData(): Promise<void> {
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
      db.pointVetoes
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
        db.pointVetoes.clear()
      ]);
    }
  );
}
