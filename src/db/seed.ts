/**
 * 种子数据导入：首次启动（库为空）时自动写入 docs/research/seed-data-draft.json 的内置副本。
 * 内容为纯虚构演示数据（见 docs/research/case-data-plan.md 脱敏声明）。
 */
import dayjs from 'dayjs';
import { normalizeMemberRecord } from '@/utils/member-status';
import { db, getMeta, setMeta } from './db';
import seedJson from './seed/seed-data.json';

const SEED_VERSION = 'v0.2.0';
const SEED_FLAG = 'seed-flag';

const SEED = seedJson as unknown as {
  members: Sct.Member[];
  seat_maps: Sct.SeatMap[];
  calendarEvents: Sct.CalEvent[];
  developmentStages: Sct.DevStage[];
  feeRecords: Sct.FeeRecord[];
  talks: Sct.Talk[];
  docTemplates: Sct.DocTemplate[];
};

/** 给所有行打上身份域（v1 固定党支部书记） */
function withIdentity<T>(rows: T[]): (T & { identity: string })[] {
  return rows.map(r => ({ ...r, identity: 'secretary' }));
}

/** 启动时调用：版本不符则 upsert 重播种（保留用户自增数据），打标记 */
export async function ensureSeeded(): Promise<void> {
  const flag = await getMeta<string>(SEED_FLAG);
  if (flag === SEED_VERSION) return;

  const today = dayjs().format('YYYY-MM-DD');
  const normalizedMembers = withIdentity(SEED.members).map(m => normalizeMemberRecord(m, today));

  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates],
    async () => {
      await db.members.bulkPut(normalizedMembers);
      await db.seatMaps.bulkPut(withIdentity(SEED.seat_maps));
      await db.calEvents.bulkPut(withIdentity(SEED.calendarEvents));
      await db.devStages.bulkPut(withIdentity(SEED.developmentStages));
      await db.feeRecords.bulkPut(withIdentity(SEED.feeRecords));
      await db.talks.bulkPut(withIdentity(SEED.talks));
      await db.docTemplates.bulkPut(withIdentity(SEED.docTemplates));
    }
  );

  await setMeta(SEED_FLAG, SEED_VERSION);
}

/** 重置为种子数据（设置页"重置演示数据"用） */
export async function resetToSeed(): Promise<void> {
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
      db.attendance
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
        db.attendance.clear()
      ]);
    }
  );
  await db.meta.delete(SEED_FLAG);
  await ensureSeeded();
}
