/**
 * 种子数据导入：首次启动（库为空）时自动写入 docs/research/seed-data-draft.json 的内置副本。
 * 内容为纯虚构演示数据（见 docs/research/case-data-plan.md 脱敏声明）。
 */
import dayjs from 'dayjs';
import { formatMemberCode, getBranchAbbreviation } from '@/utils/member-code';
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
  const savedBranch = await getMeta<string>('branch-name');
  const defaultBranch = typeof savedBranch === 'string' && savedBranch.trim() ? savedBranch.trim() : '智感硕博党支部';
  const codePrefix = getBranchAbbreviation(defaultBranch);
  const normalizedMembers = withIdentity(SEED.members).map((m, idx) =>
    normalizeMemberRecord(
      {
        ...m,
        code: formatMemberCode(codePrefix, idx + 1),
        branch_name: m.branch_name || defaultBranch
      },
      today
    )
  );

  const currentYear = dayjs().year();
  const partyMembers = normalizedMembers.filter(m => m.type === '正式党员' || m.type === '预备党员');
  const demoPoints: Sct.PointRecord[] = [];
  if (partyMembers[0]) {
    demoPoints.push(
      {
        id: 'pt-seed-1',
        member_id: partyMembers[0].id,
        year: currentYear,
        date: `${currentYear}-03-15`,
        category: 'duty',
        sub_category: 'duty_study',
        rule_id: 'duty-study-gpa',
        rule_label: '学业成绩达标（本科加权≥75 / 研≥80）',
        content: '上学期研究生加权成绩 87.4 分，达到 80 分标准',
        score: 5,
        status: '已认定',
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'pt-seed-2',
        member_id: partyMembers[0].id,
        year: currentYear,
        date: `${currentYear}-04-10`,
        category: 'duty',
        sub_category: 'duty_study',
        rule_id: 'duty-study-award-province',
        rule_label: '竞赛获奖 · 省级奖',
        content: '中国研究生人工智能创新大赛省级二等奖（核心成员）',
        score: 6,
        status: '已认定',
        calc_meta: { role: 'core', base_score: 6 },
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'pt-seed-3',
        member_id: partyMembers[0].id,
        year: currentYear,
        date: `${currentYear}-05-20`,
        category: 'bonus',
        sub_category: 'bonus',
        rule_id: 'bonus-branch-secretary',
        rule_label: '基层党支部书记年度履职附加分',
        content: '担任党支部书记履职尽责，年度任务推进规范',
        score: 5,
        status: '已认定',
        created_at: today,
        identity: 'secretary'
      }
    );
  }
  if (partyMembers[1]) {
    demoPoints.push(
      {
        id: 'pt-seed-4',
        member_id: partyMembers[1].id,
        year: currentYear,
        date: `${currentYear}-03-22`,
        category: 'duty',
        sub_category: 'duty_volunteer',
        rule_id: 'duty-volunteer-hours',
        rule_label: '志愿服务时长（每 20 小时记 1 分）',
        content: '学院迎新与科技节志愿服务累计 40 小时',
        score: 2,
        status: '已认定',
        calc_meta: { hours: 40, base_score: 1 },
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'pt-seed-5',
        member_id: partyMembers[1].id,
        year: currentYear,
        date: `${currentYear}-04-18`,
        category: 'duty',
        sub_category: 'duty_study',
        rule_id: 'duty-study-research',
        rule_label: '科研成果（论文/专利/软著/年会主讲/大创结题等）',
        content: '申请软件著作权 1 项（参与成员，待核验证书）',
        score: 1,
        status: '待核实',
        calc_meta: { role: 'member', base_score: 2 },
        created_at: today,
        identity: 'secretary'
      }
    );
  }
  if (partyMembers[2]) {
    demoPoints.push(
      {
        id: 'pt-seed-6',
        member_id: partyMembers[2].id,
        year: currentYear,
        date: `${currentYear}-04-08`,
        category: 'base',
        sub_category: 'base_discipline_meeting',
        rule_id: 'base-meeting-absent',
        rule_label: '缺席「三会一课」/ 主题党日',
        content: '4 月支部党员大会无故缺席 1 次',
        score: -1,
        status: '已认定',
        calc_meta: { count: 1, base_score: -1 },
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'pt-seed-7',
        member_id: partyMembers[2].id,
        year: currentYear,
        date: `${currentYear}-04-28`,
        category: 'base',
        sub_category: 'base_discipline_fee',
        rule_id: 'base-fee-late',
        rule_label: '无故迟交党费',
        content: '4 月党费催缴后逾期补交',
        score: -3,
        status: '已认定',
        calc_meta: { count: 1, base_score: -3 },
        created_at: today,
        identity: 'secretary'
      }
    );
  }

  await db.transaction(
    'rw',
    [db.members, db.seatMaps, db.calEvents, db.devStages, db.feeRecords, db.talks, db.docTemplates, db.pointRecords],
    async () => {
      await db.members.bulkPut(normalizedMembers);
      await db.seatMaps.bulkPut(withIdentity(SEED.seat_maps));
      await db.calEvents.bulkPut(withIdentity(SEED.calendarEvents));
      await db.devStages.bulkPut(withIdentity(SEED.developmentStages));
      await db.feeRecords.bulkPut(withIdentity(SEED.feeRecords));
      await db.talks.bulkPut(withIdentity(SEED.talks));
      await db.docTemplates.bulkPut(withIdentity(SEED.docTemplates));
      if (demoPoints.length && (await db.pointRecords.count()) === 0) {
        await db.pointRecords.bulkPut(demoPoints);
      }
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
  await db.meta.delete(SEED_FLAG);
  await ensureSeeded();
}
