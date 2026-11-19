/**
 * 种子数据导入：首次启动（库为空）时自动写入 docs/research/seed-data-draft.json 的内置副本。
 * 内容为纯虚构演示数据（见 docs/research/case-data-plan.md 脱敏声明）。
 */
import seedJson from './seed/seed-data.json';
import { db, getMeta, setMeta } from './db';

const SEED_FLAG = 'seed_v1';

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

/** 启动时调用：库空则导入种子，并打标记 */
export async function ensureSeeded(): Promise<void> {
  const flag = await getMeta<string>(SEED_FLAG);
  if (flag) return;

  const memberCount = await db.members.count();
  if (memberCount > 0) {
    // 已有数据但无标记（老库）：跳过导入，避免覆盖
    await setMeta(SEED_FLAG, 'skipped-existing');
    return;
  }

  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates],
    async () => {
      await db.members.bulkPut(withIdentity(SEED.members));
      await db.seatMaps.bulkPut(withIdentity(SEED.seat_maps));
      await db.calEvents.bulkPut(withIdentity(SEED.calendarEvents));
      await db.devStages.bulkPut(withIdentity(SEED.developmentStages));
      await db.feeRecords.bulkPut(withIdentity(SEED.feeRecords));
      await db.talks.bulkPut(withIdentity(SEED.talks));
      await db.docTemplates.bulkPut(withIdentity(SEED.docTemplates));
    }
  );

  await setMeta(SEED_FLAG, new Date().toISOString());
}

/** 重置为种子数据（设置页"重置演示数据"用） */
export async function resetToSeed(): Promise<void> {
  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates],
    async () => {
      await Promise.all([
        db.members.clear(),
        db.seatMaps.clear(),
        db.calEvents.clear(),
        db.devStages.clear(),
        db.feeRecords.clear(),
        db.talks.clear(),
        db.docTemplates.clear()
      ]);
    }
  );
  await db.meta.delete(SEED_FLAG);
  await ensureSeeded();
}
