/**
 * 党员积分与评定多方案引擎预置库（v0.3.0）
 *
 * 内置 4 套开箱即用方案（并支持空白自定义、克隆改写、按年度快照绑定与 .sctpreset 分享）：
 * 1. scheme-general-100 : 通用百分制（基础分 60 扣分 + 履职加分 40 + 附加分 - 减扣分）
 * 2. scheme-uni-60-40   : 高校学生基础+履职分桶制（基础 5 子项 60 + 专业15/实践10/志愿15≤40 + 附加 - 减扣）
 * 3. scheme-five-star   : 五星党员评定模型（5 维达标赋星，每维达阈值点亮 1 星）
 * 4. scheme-positive-only: 纯正向激励加分制（0 分起累，鼓励先进典型与志愿实事）
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
  base: { label: '基础分（扣分项）', shortLabel: '基础分', color: '#2563eb', tagType: 'info' },
  duty: { label: '履职分（加分项）', shortLabel: '履职分', color: '#16a34a', tagType: 'success' },
  bonus: { label: '附加分（激励项）', shortLabel: '附加分', color: '#d97706', tagType: 'warning' },
  penalty: { label: '减扣分（纪律扣减）', shortLabel: '减扣分', color: '#dc2626', tagType: 'error' }
};

export const POINT_VERIFY_STATUS_OPTIONS: Array<{
  label: string;
  value: Sct.PointVerifyStatus;
  tagType: 'success' | 'warning' | 'error';
}> = [
  { label: '已认定', value: '已认定', tagType: 'success' },
  { label: '待核实', value: '待核实', tagType: 'warning' },
  { label: '未通过', value: '未通过', tagType: 'error' }
];

// ---------------- 保留向下兼容的高校 60+40 分桶与细则 ----------------

export const POINT_BUCKETS: readonly PointBucketMeta[] = [
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
    label: '减扣分（违纪违规等）',
    shortLabel: '减扣分',
    cap: null
  }
];

export const POINT_BUCKET_MAP: Record<string, PointBucketMeta> = Object.fromEntries(POINT_BUCKETS.map(b => [b.key, b]));

export const BASE_BUCKETS = POINT_BUCKETS.filter(b => b.category === 'base');
export const DUTY_BUCKETS = POINT_BUCKETS.filter(b => b.category === 'duty');

export const DEFAULT_POINT_RULES: Sct.PointRuleItem[] = [
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
    label: '参加学术讲座与专题报告',
    description: '0.5 分/次',
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
    label: '参加校级及以上学科竞赛',
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
    label: '科研/工程项目经历',
    description: '参与科研/工程项目 2 分/项',
    default_score: 2,
    calc_mode: 'count',
    unit_label: '项',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-school',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 校级奖',
    description: '校级奖 +2 分（核心 100%，参与 50%）',
    default_score: 2,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-award-province',
    category: 'duty',
    sub_category: 'duty_study',
    label: '竞赛获奖 · 省级奖',
    description: '省级奖 +6 分（核心 100%，参与 50%）',
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
    description: '国家级奖 +10 分（核心 100%，参与 50%）',
    default_score: 10,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-study-research',
    category: 'duty',
    sub_category: 'duty_study',
    label: '科研成果（论文/专利/软著等）',
    description: '2 分/项（核心 100%，参与 50%）',
    default_score: 2,
    calc_mode: 'role_half',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-practice-campus',
    category: 'duty',
    sub_category: 'duty_practice',
    label: '参加文化建设、党建宣传等实践活动',
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
    label: '社会实践立项/红色研学团队',
    description: '2 分/项',
    default_score: 2,
    calc_mode: 'count',
    unit_label: '项',
    builtin: true,
    enabled: true
  },
  {
    id: 'duty-volunteer-hours',
    category: 'duty',
    sub_category: 'duty_volunteer',
    label: '志愿服务时长（每 20 小时记 1 分）',
    description: '参与各类志愿服务，20 小时 = 1 分',
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
    label: '结对帮扶与为群众办实事',
    description: '完成结对帮扶并留痕记录记 5 分',
    default_score: 5,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'bonus-exemplar',
    category: 'bonus',
    sub_category: 'bonus',
    label: '先进典型（重大突出表现/媒体报道）',
    description: '上级党组织认定 +10 分',
    default_score: 10,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'bonus-branch-secretary',
    category: 'bonus',
    sub_category: 'bonus',
    label: '基层党支部书记年度履职附加分',
    description: '党支部书记年度履职尽责 +5 分',
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
    description: '支部委员年度履职尽责 +3 分',
    default_score: 3,
    calc_mode: 'fixed',
    builtin: true,
    enabled: true
  },
  {
    id: 'penalty-discipline',
    category: 'penalty',
    sub_category: 'penalty',
    label: '违反规章制度受通报批评',
    description: '每次通报批评扣 10 分',
    default_score: -10,
    calc_mode: 'count',
    unit_label: '次',
    builtin: true,
    enabled: true
  }
];

// ---------------- 4 套内置通用与专业考核方案 ----------------

export const BUILTIN_POINT_SCHEMES: readonly Sct.PointScheme[] = [
  {
    id: 'scheme-uni-60-40',
    name: '高校学生基础+履职分桶制',
    description: '基础分 60（5 项扣至 0）+ 履职分 ≤40（专业 15 / 实践 10 / 志愿 15）+ 附加分 - 减扣分',
    scheme_mode: 'score',
    pass_line: 60,
    enable_veto: true,
    group_caps: { duty: 40 },
    builtin: true,
    dimensions: [
      {
        id: 'base_politics_study',
        label: '讲政治 · 理论培训学习',
        shortLabel: '理论学习',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 15,
        cap: 15,
        color: '#2563eb'
      },
      {
        id: 'base_politics_task',
        label: '讲政治 · 服从组织安排',
        shortLabel: '组织安排',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 10,
        cap: 10,
        color: '#3b82f6'
      },
      {
        id: 'base_discipline_meeting',
        label: '守纪律 · 党内组织生活',
        shortLabel: '组织生活',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 15,
        cap: 15,
        color: '#1d4ed8'
      },
      {
        id: 'base_discipline_fee',
        label: '守纪律 · 党费缴纳',
        shortLabel: '党费缴纳',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 10,
        cap: 10,
        color: '#0284c7'
      },
      {
        id: 'base_morality',
        label: '有品行 · 道德行为规范',
        shortLabel: '道德规范',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 10,
        cap: 10,
        color: '#0369a1'
      },
      {
        id: 'duty_study',
        label: '履职 · 专业学习',
        shortLabel: '专业学习',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 15,
        color: '#16a34a',
        group_cap_key: 'duty'
      },
      {
        id: 'duty_practice',
        label: '履职 · 实践活动',
        shortLabel: '实践活动',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 10,
        color: '#0f766e',
        group_cap_key: 'duty'
      },
      {
        id: 'duty_volunteer',
        label: '履职 · 志愿服务',
        shortLabel: '志愿服务',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 15,
        color: '#059669',
        group_cap_key: 'duty'
      },
      {
        id: 'bonus',
        label: '附加分（先进典型 / 骨干履职）',
        shortLabel: '附加分',
        category: 'bonus',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#d97706'
      },
      {
        id: 'penalty',
        label: '减扣分（违纪违规等）',
        shortLabel: '减扣分',
        category: 'penalty',
        mode: 'deduct_direct',
        initial_score: 0,
        cap: null,
        color: '#dc2626'
      }
    ],
    rules: DEFAULT_POINT_RULES
  },
  {
    id: 'scheme-general-100',
    name: '通用百分制考核',
    description: '适用于各类基层支部：基础分 60（违纪/缺勤扣减）+ 贡献加分 40 + 荣誉附加分 - 严重扣分',
    scheme_mode: 'score',
    pass_line: 60,
    enable_veto: true,
    builtin: true,
    dimensions: [
      {
        id: 'gen_base',
        label: '基础履职分（初始 60）',
        shortLabel: '基础分',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 60,
        cap: 60,
        color: '#2563eb'
      },
      {
        id: 'gen_duty',
        label: '先锋贡献分（封顶 40）',
        shortLabel: '贡献分',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 40,
        color: '#16a34a'
      },
      {
        id: 'gen_bonus',
        label: '荣誉附加分',
        shortLabel: '附加分',
        category: 'bonus',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#d97706'
      },
      {
        id: 'gen_penalty',
        label: '纪律减扣分',
        shortLabel: '减扣分',
        category: 'penalty',
        mode: 'deduct_direct',
        initial_score: 0,
        cap: null,
        color: '#dc2626'
      }
    ],
    rules: [
      {
        id: 'gen-r1',
        category: 'base',
        sub_category: 'gen_base',
        label: '无故缺席组织生活 / 三会一课',
        description: '缺席 1 次扣 2 分',
        default_score: -2,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r2',
        category: 'base',
        sub_category: 'gen_base',
        label: '无故拖欠党费',
        description: '欠缴 1 次扣 3 分',
        default_score: -3,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r3',
        category: 'duty',
        sub_category: 'gen_duty',
        label: '参加志愿服务 / 公益活动',
        description: '每 20 小时记 2 分',
        default_score: 2,
        calc_mode: 'hours_20',
        unit_label: '小时',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r4',
        category: 'duty',
        sub_category: 'gen_duty',
        label: '担任党课主讲 / 专题领学 / 业务分享',
        description: '每次加 3 分',
        default_score: 3,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r5',
        category: 'duty',
        sub_category: 'gen_duty',
        label: '结对帮扶 / 为群众办实事成效突出',
        description: '每项加 5 分',
        default_score: 5,
        calc_mode: 'count',
        unit_label: '项',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r6',
        category: 'bonus',
        sub_category: 'gen_bonus',
        label: '获评优秀共产党员 / 先进个人',
        description: '校级/单位级 +5 分，省市级及以上 +10 分',
        default_score: 5,
        calc_mode: 'fixed',
        builtin: true,
        enabled: true
      },
      {
        id: 'gen-r7',
        category: 'penalty',
        sub_category: 'gen_penalty',
        label: '受单位通报批评或纪律处分',
        description: '每次扣 10 分',
        default_score: -10,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      }
    ]
  },
  {
    id: 'scheme-five-star',
    name: '五星党员评定模型',
    description: '五维达标赋星：政治信念星 · 专业实干星 · 实践担当星 · 志愿奉献星 · 先锋模范星（达阈值点亮 1 星）',
    scheme_mode: 'star',
    pass_line: 30,
    pass_stars: 3,
    enable_veto: true,
    builtin: true,
    dimensions: [
      {
        id: 'star_politics',
        label: '政治信念星（理论学习与纪律）',
        shortLabel: '政治星',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 20,
        star_threshold: 10,
        color: '#A81C24'
      },
      {
        id: 'star_work',
        label: '专业实干星（学业/科研/业务实绩）',
        shortLabel: '实干星',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 20,
        star_threshold: 10,
        color: '#2563eb'
      },
      {
        id: 'star_practice',
        label: '实践担当星（支部共建与实践任务）',
        shortLabel: '实践星',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 20,
        star_threshold: 10,
        color: '#0f766e'
      },
      {
        id: 'star_volunteer',
        label: '志愿奉献星（志愿服务与结对帮扶）',
        shortLabel: '志愿星',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 20,
        star_threshold: 10,
        color: '#16a34a'
      },
      {
        id: 'star_pioneer',
        label: '先锋模范星（表彰荣誉与骨干履职）',
        shortLabel: '先锋星',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 20,
        star_threshold: 10,
        color: '#d97706'
      }
    ],
    rules: [
      {
        id: 'star-r1',
        category: 'duty',
        sub_category: 'star_politics',
        label: '按时完成年度理论学习与三会一课全勤',
        description: '达标记 10 分（点亮政治信念星）',
        default_score: 10,
        calc_mode: 'fixed',
        builtin: true,
        enabled: true
      },
      {
        id: 'star-r2',
        category: 'duty',
        sub_category: 'star_work',
        label: '学业/业务考核优良或取得科研成果',
        description: '每项记 5 分（满 10 分点亮实干星）',
        default_score: 5,
        calc_mode: 'count',
        unit_label: '项',
        builtin: true,
        enabled: true
      },
      {
        id: 'star-r3',
        category: 'duty',
        sub_category: 'star_practice',
        label: '参与主题实践、支部共建或微讲堂主讲',
        description: '每次记 5 分（满 10 分点亮实践星）',
        default_score: 5,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      },
      {
        id: 'star-r4',
        category: 'duty',
        sub_category: 'star_volunteer',
        label: '志愿服务时长累计（每 20 小时记 5 分）',
        description: '累计 40 小时即满 10 分点亮志愿星',
        default_score: 5,
        calc_mode: 'hours_20',
        unit_label: '小时',
        builtin: true,
        enabled: true
      },
      {
        id: 'star-r5',
        category: 'duty',
        sub_category: 'star_pioneer',
        label: '获评先进典型 / 支委骨干年度履职优秀',
        description: '达标记 10 分（点亮先锋模范星）',
        default_score: 10,
        calc_mode: 'fixed',
        builtin: true,
        enabled: true
      }
    ]
  },
  {
    id: 'scheme-positive-only',
    name: '纯正向激励加分制',
    description: '0 分起累、不设扣分项，纯记录党员在学习赋能、志愿服务、实事攻坚与荣誉表彰中的正向贡献',
    scheme_mode: 'score',
    pass_line: 10,
    enable_veto: false,
    builtin: true,
    dimensions: [
      {
        id: 'pos_study',
        label: '学习赋能',
        shortLabel: '学习赋能',
        category: 'duty',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#2563eb'
      },
      {
        id: 'pos_volunteer',
        label: '志愿服务',
        shortLabel: '志愿服务',
        category: 'duty',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#16a34a'
      },
      {
        id: 'pos_service',
        label: '办实事与攻坚',
        shortLabel: '实事攻坚',
        category: 'duty',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#0f766e'
      },
      {
        id: 'pos_honor',
        label: '荣誉表彰',
        shortLabel: '荣誉表彰',
        category: 'bonus',
        mode: 'add_uncapped',
        initial_score: 0,
        cap: null,
        color: '#d97706'
      }
    ],
    rules: [
      {
        id: 'pos-r1',
        category: 'duty',
        sub_category: 'pos_study',
        label: '领学分享 / 讲微党课 / 撰写优质心得',
        description: '每次 +2 分',
        default_score: 2,
        calc_mode: 'count',
        unit_label: '次',
        builtin: true,
        enabled: true
      },
      {
        id: 'pos-r2',
        category: 'duty',
        sub_category: 'pos_volunteer',
        label: '志愿服务时长（每 20 小时记 2 分）',
        description: '按志愿时长台账自动换算',
        default_score: 2,
        calc_mode: 'hours_20',
        unit_label: '小时',
        builtin: true,
        enabled: true
      },
      {
        id: 'pos-r3',
        category: 'duty',
        sub_category: 'pos_service',
        label: '领办群众实事 / 结对帮扶',
        description: '每项 +5 分',
        default_score: 5,
        calc_mode: 'count',
        unit_label: '项',
        builtin: true,
        enabled: true
      },
      {
        id: 'pos-r4',
        category: 'bonus',
        sub_category: 'pos_honor',
        label: '获评先进典型或重大奖项',
        description: '每次 +5 分',
        default_score: 5,
        calc_mode: 'fixed',
        builtin: true,
        enabled: true
      }
    ]
  }
];

export function clonePointScheme(scheme: Sct.PointScheme): Sct.PointScheme {
  return JSON.parse(JSON.stringify(scheme)) as Sct.PointScheme;
}

export function getBuiltinPointScheme(id?: string): Sct.PointScheme {
  const hit = BUILTIN_POINT_SCHEMES.find(s => s.id === id);
  return clonePointScheme(hit ?? BUILTIN_POINT_SCHEMES[0]);
}

export function createBlankCustomScheme(id: string, name = '自定义积分方案'): Sct.PointScheme {
  return {
    id,
    name,
    description: '由本支部自定义的考核维度与计分细则',
    scheme_mode: 'score',
    pass_line: 60,
    enable_veto: true,
    builtin: false,
    dimensions: [
      {
        id: 'dim_base',
        label: '基础履职（初始 60）',
        shortLabel: '基础分',
        category: 'base',
        mode: 'deduct_from_base',
        initial_score: 60,
        cap: 60,
        color: '#2563eb'
      },
      {
        id: 'dim_gain',
        label: '加分项（封顶 40）',
        shortLabel: '加分项',
        category: 'duty',
        mode: 'add_capped',
        initial_score: 0,
        cap: 40,
        color: '#16a34a'
      }
    ],
    rules: [
      {
        id: `${id}-r1`,
        category: 'duty',
        sub_category: 'dim_gain',
        label: '积极参加支部重点活动',
        description: '每次加 2 分',
        default_score: 2,
        calc_mode: 'count',
        unit_label: '次',
        builtin: false,
        enabled: true
      }
    ]
  };
}
