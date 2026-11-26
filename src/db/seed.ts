/**
 * 种子数据导入：首次启动（库为空）时自动写入 docs/research/seed-data-draft.json 的内置副本。
 * 内容为纯虚构演示数据（见 docs/research/case-data-plan.md 脱敏声明）。
 */
import dayjs from 'dayjs';
import { DEFAULT_BRANCH_NAME } from '@/constants/workspace-presets';
import { formatMemberCode, getBranchAbbreviation } from '@/utils/member-code';
import { normalizeMemberRecord } from '@/utils/member-status';
import { db, ensureDefaultDocTemplates, getMeta, setMeta } from './db';
import seedJson from './seed/seed-data.json';

const SEED_VERSION = 'v0.2.7';
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

export const DEFAULT_DOC_TEMPLATES: Sct.DocTemplate[] = SEED.docTemplates;

/** 给所有行打上身份域（v1 固定党支部书记） */
function withIdentity<T>(rows: T[]): (T & { identity: string })[] {
  return rows.map(r => ({ ...r, identity: 'secretary' }));
}

/** 启动时调用：仅在全新空白库（无 seed-flag）时播种演示数据；已存在旧版本标记时绝不覆盖或注入演示记录 */
export async function ensureSeeded(): Promise<void> {
  const flag = await getMeta<string>(SEED_FLAG);
  if (flag) {
    await ensureDefaultDocTemplates();
    if (flag !== SEED_VERSION) {
      await setMeta(SEED_FLAG, SEED_VERSION);
    }
    return;
  }

  const today = dayjs().format('YYYY-MM-DD');
  const savedBranch = await getMeta<string>('branch-name');
  const defaultBranch =
    typeof savedBranch === 'string' && savedBranch.trim() ? savedBranch.trim() : DEFAULT_BRANCH_NAME;
  const codePrefix = getBranchAbbreviation(defaultBranch);
  const normalizedMembers = withIdentity(SEED.members).map((m, idx) =>
    normalizeMemberRecord(
      {
        ...m,
        code: formatMemberCode(codePrefix, idx + 1),
        branch_name: m.branch_name || defaultBranch,
        lifecycle_status: m.lifecycle_status ?? '在册正常'
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

  const demoVolunteers: Sct.VolunteerActivity[] = [];
  if (normalizedMembers.length >= 6) {
    demoVolunteers.push(
      {
        id: 'vol-seed-1',
        title: '迎新志愿引导与实验室安全巡查',
        date: `${currentYear}-09-05`,
        source: '支部内部',
        default_hours: 3,
        status: '已认定',
        participants: normalizedMembers.slice(0, 5).map((m, idx) => ({
          member_id: m.id,
          name_snapshot: m.name,
          hours: idx === 0 ? 4 : 3,
          role_note: idx === 0 ? '现场统筹' : '引导服务'
        })),
        note: '秋季迎新党员先锋岗常规志愿服务',
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'vol-seed-2',
        title: '社区数字科普与反诈志愿宣讲',
        date: `${currentYear}-10-18`,
        source: '社会公益',
        default_hours: 2.5,
        status: '已认定',
        participants: normalizedMembers.slice(2, 6).map(m => ({
          member_id: m.id,
          name_snapshot: m.name,
          hours: 2.5,
          role_note: '社区宣讲'
        })),
        note: '支部与社区联合开展公益服务',
        created_at: today,
        identity: 'secretary'
      },
      {
        id: 'vol-seed-3',
        title: '支部档案整理与理论学习资料装订',
        date: `${currentYear}-11-12`,
        source: '校院活动',
        default_hours: 1.5,
        status: '待核实',
        participants: normalizedMembers.slice(4, 7).map(m => ({
          member_id: m.id,
          name_snapshot: m.name,
          hours: 1.5
        })),
        note: '待支书核对签到照片后认定',
        created_at: today,
        identity: 'secretary'
      }
    );
  }

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
      db.pointRecords,
      db.volunteerActivities
    ],
    async () => {
      if ((await db.members.count()) === 0) {
        await db.members.bulkPut(normalizedMembers);
        await db.seatMaps.bulkPut(withIdentity(SEED.seat_maps));
        await db.calEvents.bulkPut(withIdentity(SEED.calendarEvents));
        await db.devStages.bulkPut(withIdentity(SEED.developmentStages));
        await db.feeRecords.bulkPut(withIdentity(SEED.feeRecords));
        await db.talks.bulkPut(withIdentity(SEED.talks));
        if (demoPoints.length && (await db.pointRecords.count()) === 0) {
          await db.pointRecords.bulkPut(demoPoints);
        }
        if (demoVolunteers.length && (await db.volunteerActivities.count()) === 0) {
          await db.volunteerActivities.bulkPut(demoVolunteers);
        }
      }
      if ((await db.docTemplates.count()) === 0) {
        await db.docTemplates.bulkPut(withIdentity(SEED.docTemplates));
      }
    }
  );

  await setMeta(SEED_FLAG, SEED_VERSION);
}

const BUSINESS_META_KEYS = [
  'party-groups',
  'youth-committee-slots',
  'point-rules',
  'point-schemes',
  'point-year-scheme',
  'point-year-snapshots',
  'academy-flow',
  'knowledge-custom-items',
  'policy-cards-v1'
] as const;

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
      await db.meta.bulkDelete([...BUSINESS_META_KEYS, SEED_FLAG, ...policyFileKeys]);
    }
  );
  await ensureSeeded();
}
