/**
 * 三尺台 本地数据库（Dexie / IndexedDB）
 *
 * 单一 DB 工厂（借鉴 SP runDbUpgrade 教训：schema 集中、加法演进）。
 * 备份：环形快照 5 份（meta 表）+ BackupShape 统一导入导出管线。
 */
import Dexie, { type Table } from 'dexie';

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
}

const BACKUP_RING_SIZE = 5;

/** 全库导出为统一备份格式 */
export async function exportBackup(): Promise<BackupShape> {
  const [members, seat_maps, cal_events, dev_stages, fee_records, talks, doc_templates, docs, branchName] =
    await Promise.all([
      db.members.toArray(),
      db.seatMaps.toArray(),
      db.calEvents.toArray(),
      db.devStages.toArray(),
      db.feeRecords.toArray(),
      db.talks.toArray(),
      db.docTemplates.toArray(),
      db.docs.toArray(),
      getMeta<string>('branch-name')
    ]);
  return {
    schemaVersion: 1,
    exported_at: new Date().toISOString(),
    branch_name: branchName || '智感硕博党支部',
    members,
    seat_maps,
    cal_events,
    dev_stages,
    fee_records,
    talks,
    doc_templates,
    docs
  };
}

/** 写入环形快照（保留最近 BACKUP_RING_SIZE 份） */
export async function pushBackupRing(): Promise<void> {
  const ring = (await getMeta<number>('backup_ring_cursor')) ?? 0;
  const snapshot = await exportBackup();
  await setMeta(`backup-${ring}`, snapshot);
  await setMeta('backup_ring_cursor', (ring + 1) % BACKUP_RING_SIZE);
}

/** 读取全部环形快照（按新→旧） */
export async function listBackupRing(): Promise<Array<{ key: string; ts: string; shape: BackupShape }>> {
  const rows = await db.meta.filter(r => r.key.startsWith('backup-')).toArray();
  return rows
    .filter(r => r.key !== 'backup_ring_cursor' && r.value)
    .map(r => {
      const shape = r.value as BackupShape;
      return { key: r.key, ts: shape.exported_at, shape };
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

/** 导入备份：先自动快照当前库，再整体替换 */
export async function importBackup(shape: BackupShape): Promise<void> {
  await pushBackupRing();
  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates, db.docs],
    async () => {
      await Promise.all([
        db.members.clear(),
        db.seatMaps.clear(),
        db.calEvents.clear(),
        db.devStages.clear(),
        db.feeRecords.clear(),
        db.talks.clear(),
        db.docTemplates.clear(),
        db.docs.clear()
      ]);
      await Promise.all([
        db.members.bulkPut(shape.members ?? []),
        db.seatMaps.bulkPut(shape.seat_maps ?? []),
        db.calEvents.bulkPut(shape.cal_events ?? []),
        db.devStages.bulkPut(shape.dev_stages ?? []),
        db.feeRecords.bulkPut(shape.fee_records ?? []),
        db.talks.bulkPut(shape.talks ?? []),
        db.docTemplates.bulkPut(shape.doc_templates ?? []),
        db.docs.bulkPut(shape.docs ?? [])
      ]);
    }
  );
  if (shape.branch_name && typeof shape.branch_name === 'string') {
    await setMeta('branch-name', shape.branch_name.trim());
  }
}

/** 清空全部业务数据（保留 meta 备份） */
export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates, db.docs],
    async () => {
      await Promise.all([
        db.members.clear(),
        db.seatMaps.clear(),
        db.calEvents.clear(),
        db.devStages.clear(),
        db.feeRecords.clear(),
        db.talks.clear(),
        db.docTemplates.clear(),
        db.docs.clear()
      ]);
    }
  );
}
