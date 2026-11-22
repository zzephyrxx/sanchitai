/**
 * 学生党员积分管理考核标准（预置：西安理工大学计算机科学与工程学院 2025/2026 实施方案）
 *
 * 年度总积分 = 基础分（初始 60，按 5 子项各自扣至 0）+ 履职分（按 3 大类 15/10/15 各自封顶，合计 ≤ 40）
 *            + 附加分（不封顶）- 减扣分（直接扣减）
 * 一票否决开启时基础分直接清零；年度积分 < 60 分触发民主评议不合格预警。
 */

export const POINT_PASS_LINE = 60;
export const POINT_BASE_MAX = 60;
export const POINT_DUTY_MAX = 40;

export interface PointBucketMeta {
  key: Sct.PointSubCategory;
  category: Sct.PointCategory;
  groupLabel: string;
  label: string;
  shortLabel: string;
  cap: number | null;
}

export const POINT_CATEGORY_META: Record<
  Sct.PointCategory,
  { label: string; shortLabel: string; color: string; tagType: 'info' | 'success' | 'warning' | 'error' }
> = {
  base: { label: '基础分（60分，扣分项）', shortLabel: '基础分', color: '#2563eb', tagType: 'info' },
  duty: { label: '履职分（40分，加分项）', shortLabel: '履职分', color: '#16a34a', tagType: 'success' },
  bonus: { label: '附加分（加分项）', shortLabel: '附加分', color: '#d97706', tagType: 'warning' },
  penalty: { label: '减扣分（通报批评等）', shortLabel: '减扣分', color: '#dc2626', tagType: 'error' }
};

export const POINT_BUCKETS: readonly PointBucketMeta[] = [
  // 基础分 5 子项（合计 60）
  {
    key: 'base_politics_study',
    category: 'base',
    groupLabel: '讲政治 有信念',
    label: '讲政治有信念 · 理论培训与学习',
    shortLabel: '理论培训学习',
    cap: 15
  },
  {
    key: 'base_politics_task',
    category: 'base',
    groupLabel: '讲政治 有信念',
    label: '讲政治有信念 · 服从组织安排',
    shortLabel: '服从组织安排',
    cap: 10
  },
  {
    key: 'base_discipline_meeting',
    category: 'base',
    groupLabel: '讲规矩 守纪律',
    label: '讲规矩守纪律 · 党内组织生活',
    shortLabel: '党内组织生活',
    cap: 15
  },
  {
    key: 'base_discipline_fee',
    category: 'base',
    groupLabel: '讲规矩 守纪律',
    label: '讲规矩守纪律 · 党费缴纳',
    shortLabel: '党费缴纳',
    cap: 10
  },
  {
    key: 'base_morality',
    category: 'base',
    groupLabel: '讲道德 有品行',
    label: '讲道德有品行 · 行为规范',
    shortLabel: '道德行为规范',
    cap: 10
  },
  // 履职分 3 大类（15 + 10 + 15 = 40）
  {
    key: 'duty_study',
    category: 'duty',
    groupLabel: '履职项',
    label: '专业学习（上限15分）',
    shortLabel: '专业学习',
    cap: 15
  },
  {
    key: 'duty_practice',
    category: 'duty',
    groupLabel: '履职项',
    label: '实践活动（上限10分）',
    shortLabel: '实践活动',
    cap: 10
  },
  {
    key: 'duty_volunteer',
    category: 'duty',
    groupLabel: '履职项',
    label: '志愿服务（上限15分）',
    shortLabel: '志愿服务',
    cap: 15
  },
  // 附加分 & 减扣分
  {
    key: 'bonus',
    category: 'bonus',
    groupLabel: '附加分',
    label: '附加分（先进典型 / 骨干履职）',
    shortLabel: '附加分',
    cap: null
  },
  {
    key: 'penalty',
    category: 'penalty',
    groupLabel: '减扣分',
    label: '减扣分（违反校规校纪等）',
    shortLabel: '减扣分',
    cap: null
  }
];

export const POINT_BUCKET_MAP: Record<Sct.PointSubCategory, PointBucketMeta> = Object.fromEntries(
  POINT_BUCKETS.map(b => [b.key, b])
) as Record<Sct.PointSubCategory, PointBucketMeta>;

export const BASE_BUCKETS = POINT_BUCKETS.filter(b => b.category === 'base');
export const DUTY_BUCKETS = POINT_BUCKETS.filter(b => b.category === 'duty');

export const POINT_VERIFY_STATUS_OPTIONS: Array<{
  label: string;
  value: Sct.PointVerifyStatus;
  tagType: 'success' | 'warning' | 'error';
}> = [
  { label: '已认定', value: '已认定', tagType: 'success' },
  { label: '待核实', value: '待核实', tagType: 'warning' },
  { label: '未通过', value: '未通过', tagType: 'error' }
];

export const DEFAULT_POINT_RULES: Sct.PointRuleItem[] = [
  // ---------------- 基础分（扣分项） ----------------
  {
    id: 'base-study-absent',
    category: 'base',
    sub_category: 'base_politics_study',
    label: '未按要求参加政治理论培训/主题教育/红色实践',
    description: '未按要求参加 1 次扣 5 分',
    default_score: -5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-study-notes',
    category: 'base',
    sub_category: 'base_politics_study',
    label: '未完成学习任务（学习笔记/心得体会）',
    description: '未完成学习任务 1 次扣 8 分',
    default_score: -8,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-study-fail',
    category: 'base',
    sub_category: 'base_politics_study',
    label: '政治理论培训考核不合格',
    description: '培训考核不合格扣 15 分',
    default_score: -15,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-task-refuse',
    category: 'base',
    sub_category: 'base_politics_task',
    label: '无故拒绝党组织安排',
    description: '无故拒绝组织安排扣 5 分',
    default_score: -5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-task-perfunctory',
    category: 'base',
    sub_category: 'base_politics_task',
    label: '敷衍完成党组织交办任务',
    description: '敷衍完成交办任务 1 次扣 3 分',
    default_score: -3,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-meeting-absent',
    category: 'base',
    sub_category: 'base_discipline_meeting',
    label: '缺席「三会一课」/ 主题党日',
    description: '缺席 1 次扣 1 分（迟到早退累计 3 次按缺席 1 次处理）',
    default_score: -1,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-meeting-life-absent',
    category: 'base',
    sub_category: 'base_discipline_meeting',
    label: '缺席组织生活会 / 民主评议党员',
    description: '缺席组织生活会或民主评议党员 1 次扣 5 分',
    default_score: -5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-meeting-late3',
    category: 'base',
    sub_category: 'base_discipline_meeting',
    label: '迟到/早退累计满 3 次折算缺席',
    description: '迟到早退累计 3 次按缺席 1 次扣 1 分',
    default_score: -1,
    calc_mode: 'count',
    unit_label: '次(每3次)',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-fee-late',
    category: 'base',
    sub_category: 'base_discipline_fee',
    label: '无故迟交党费',
    description: '无故迟交党费 1 次扣 3 分',
    default_score: -3,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-fee-unpaid',
    category: 'base',
    sub_category: 'base_discipline_fee',
    label: '少交 / 不交党费',
    description: '少交或不交党费 1 次扣 5 分',
    default_score: -5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-morality-speech',
    category: 'base',
    sub_category: 'base_morality',
    label: '发表不当政治言论',
    description: '发表不当政治言论 1 次扣 5 分',
    default_score: -5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'base-morality-image',
    category: 'base',
    sub_category: 'base_morality',
    label: '故意损害党组织形象',
    description: '故意损害党组织形象扣 10 分',
    default_score: -10,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },

  // ---------------- 履职项 · 专业学习（上限 15） ----------------
  {
    id: 'duty-study-gpa',
    category: 'duty',
    sub_category: 'duty_study',
    label: '学业成绩达标（本科加权≥75 / 研≥80）',
    description: '上学期加权平均分达到标准加 5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-lecture',
    category: 'duty',
    sub_category: 'duty_study',
    label: '参加学院学术讲座和会议',
    description: '0.5 分/次',
    default_score: 0.5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-comp-college',
    category: 'duty',
    sub_category: 'duty_study',
    label: '参加院级竞赛',
    description: '参加院级竞赛 0.5 分/次',
    default_score: 0.5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-comp-school',
    category: 'duty',
    sub_category: 'duty_study',
    label: '参加校级及以上竞赛',
    description: '参加校级及以上竞赛 1 分/次',
    default_score: 1,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-project',
    category: 'duty',
    sub_category: 'duty_study',
    label: '科研/工程项目经历（导师签字证明）',
    description: '有项目经历并注明项目名称由导师签字，2 分/项',
    default_score: 2,
    calc_mode: 'count',
    unit_label: '项',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-college',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 院级奖',
    description: '院级奖 +1 分（集体项核心成员 100%，参与成员 50%）',
    default_score: 1,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-school',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 校级奖',
    description: '校级奖 +2 分（集体项核心成员 100%，参与成员 50%）',
    default_score: 2,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-city',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 市级奖',
    description: '市级奖 +4 分（集体项核心成员 100%，参与成员 50%）',
    default_score: 4,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-province',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 省级奖',
    description: '省级奖 +6 分（集体项核心成员 100%，参与成员 50%）',
    default_score: 6,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-national',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 国家级奖',
    description: '国家级奖 +10 分（集体项核心成员 100%，参与成员 50%）',
    default_score: 10,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-research',
    category: 'duty',
    sub_category: 'duty_study',
    label: '科研成果（论文/专利/软著/年会主讲/大创结题等）',
    description: '不限排名 2 分/项（集体项核心成员 100%，参与成员 50%）',
    default_score: 2,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },

  // ---------------- 履职项 · 实践活动（上限 10） ----------------
  {
    id: 'duty-practice-campus',
    category: 'duty',
    sub_category: 'duty_practice',
    label: '参加校园/学院文化建设、党建宣传等活动',
    description: '0.5 分/次',
    default_score: 0.5,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-practice-summer',
    category: 'duty',
    sub_category: 'duty_practice',
    label: '暑期社会实践（集中组队并立项成功）',
    description: '2 分/项',
    default_score: 2,
    calc_mode: 'count',
    unit_label: '项',
    builtin: true,
    enabled: true
  },

  // ---------------- 履职项 · 志愿服务（上限 15） ----------------
  {
    id: 'duty-volunteer-hours',
    category: 'duty',
    sub_category: 'duty_volunteer',
    label: '志愿服务时长（每 20 小时记 1 分）',
    description: '参与学院/学校/社会各类志愿服务，20 小时 = 1 分',
    default_score: 1,
    calc_mode: 'hours_20',
    unit_label: '小时',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-volunteer-help',
    category: 'duty',
    sub_category: 'duty_volunteer',
    label: '学业帮扶（结对帮扶并有记录，学工办登记）',
    description: '完成结对帮扶记 5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-volunteer-help-bonus',
    category: 'duty',
    sub_category: 'duty_volunteer',
    label: '学业帮扶成效附加（帮扶对象加权每提升 5 分）',
    description: '帮扶对象较上学期加权成绩每提升 5 分额外加 1 分',
    default_score: 1,
    calc_mode: 'count',
    unit_label: '档(每提5分)',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-volunteer-collective',
    category: 'duty',
    sub_category: 'duty_volunteer',
    label: '集体服务（提升到课率/宿舍卫生等，学工办认定）',
    description: '学工办登记且成效明显记 5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },

  // ---------------- 附加分（不封顶） ----------------
  {
    id: 'bonus-exemplar',
    category: 'bonus',
    sub_category: 'bonus',
    label: '先进典型（重大突出表现且获校级以上媒体报道）',
    description: '学院党委认定，+10 分',
    default_score: 10,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'bonus-leader',
    category: 'bonus',
    sub_category: 'bonus',
    label: '勇于担当（班级/支部/学生会主要负责人履职尽责）',
    description: '工作完成较好，+5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'bonus-branch-secretary',
    category: 'bonus',
    sub_category: 'bonus',
    label: '基层党支部书记年度履职附加分',
    description: '方案第三条：基层党支部书记每年可加 5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'bonus-branch-committee',
    category: 'bonus',
    sub_category: 'bonus',
    label: '党支部委员年度履职附加分',
    description: '方案第三条：其他支部委员每年可加 3 分',
    default_score: 3,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },

  // ---------------- 减扣分 ----------------
  {
    id: 'penalty-discipline',
    category: 'penalty',
    sub_category: 'penalty',
    label: '违反校规校纪（宿舍检查/旷课等受通报批评）',
    description: '每次通报批评扣 10 分',
    default_score: -10,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  }
];
