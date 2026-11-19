/** 三尺台 领域常量：类别色标、身份、成员类型色 */

/** 台历类别 → 色标（党建红仅给组织生活，符合"红只作关键色"约束） */
export const EVENT_CATEGORY_COLORS: Record<Sct.EventCategory, { color: string; soft: string }> = {
  组织生活: { color: '#A81C24', soft: '#F7E3E4' },
  党务常规: { color: '#64748b', soft: '#EEF1F5' },
  发展党员: { color: '#d97706', soft: '#FCEFDC' },
  品牌活动: { color: '#0f766e', soft: '#E0F0EF' },
  服务实践: { color: '#3f9d63', soft: '#E3F2E9' },
  工作例会: { color: '#2080f0', soft: '#E3EEFB' },
  理论学习: { color: '#7c5cd6', soft: '#EFEAF9' }
};

export const EVENT_CATEGORY_OPTIONS = Object.entries(EVENT_CATEGORY_COLORS).map(([value, c]) => ({
  value,
  label: value,
  color: c.color
}));

/** 成员类型色（座位图徽标 / 列表标签） */
export const MEMBER_TYPE_COLORS: Record<Sct.MemberType, string> = {
  正式党员: '#A81C24',
  预备党员: '#c05d63',
  发展对象: '#d97706',
  入党积极分子: '#2080f0',
  申请人: '#8a8f99'
};

export const MEMBER_TYPE_ORDER: Sct.MemberType[] = ['正式党员', '预备党员', '发展对象', '入党积极分子', '申请人'];

/** 身份定义：v1 仅党支部书记可用，其余占位（数据互不打通） */
export const IDENTITIES: Sct.IdentityOption[] = [
  { id: 'secretary', name: '党支部书记', available: true, desc: '三会一课 · 发展台账 · 党费 · 谈话材料' },
  { id: 'classMonitor', name: '班长', available: false, desc: '规划中：班级事务 · 收缴 · 座位' },
  { id: 'clubLeader', name: '社团负责人', available: false, desc: '规划中：活动 · 社员 · 财务' },
  { id: 'counselor', name: '辅导员', available: false, desc: '规划中：年级事务 · 谈心谈话 · 风险台账' }
];

export const ACTIVE_IDENTITY_KEY = 'sct-active-identity';

/** 三会一课默认频次口径（依据《中国共产党支部工作条例（试行）》，允许用户自定义） */
export const MEETING_RULES = [
  { kind: '支委会', label: '支部委员会', freq: '每月 1 次', monthly: 1 },
  { kind: '党员大会', label: '支部党员大会', freq: '每季度 1 次', quarter: 1 },
  { kind: '党课', label: '党课', freq: '每季度 1 次（可并入党员大会）', quarter: 1 },
  { kind: '主题党日', label: '主题党日', freq: '每月 1 天', monthly: 1 },
  { kind: '党小组会', label: '党小组会', freq: '每月 1 次（按需）', monthly: 1, optional: true },
  { kind: '组织生活会', label: '组织生活会暨民主评议', freq: '每年 1 次（一般第四季度）', yearly: 1 }
] as const;

/** 党费默认标准（中组发〔2008〕3 号：学生党员 0.2 元/月） */
export const FEE_STANDARD = { studentMonthly: 0.2 };
