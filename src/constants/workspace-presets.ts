/**
 * 三尺台 v0.2.7 高校党建工作台配置：
 * - 工作台模块工坊元数据（座位图 / 党员积分 / 志愿时长 / 政治生日）
 * - 成员全生命周期状态元数据与判定纯函数
 * - 新转入党员纸质档案标准核查清单
 */

import { ref } from 'vue';

export const DEFAULT_BRANCH_NAME = '高校学生党支部';
export const ONBOARDING_CURRENT_VERSION = '0.2.7';
export const WORKSPACE_CONFIG_STORAGE_KEY = 'sct:workspace-config:v1';

export interface WorkshopModuleMeta {
  key: Sct.OptionalModuleKey;
  routeName?: string;
  icon: string;
  color: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  badgeZh?: string;
}

export const WORKSHOP_MODULES: readonly WorkshopModuleMeta[] = [
  {
    key: 'seatmap',
    icon: 'lucide:armchair',
    color: '#0f766e',
    titleZh: '人员座位图',
    titleEn: 'Visual Seat Map',
    descZh: '在人员页启用教室/会议/工位拖拽排座视图、欠缴红点角标与一键打印座次表',
    descEn: 'Drag-and-drop seating board, unpaid badges & printable seating charts in Members',
    badgeZh: '高校/会务常用'
  },
  {
    key: 'points',
    routeName: 'ledger_points',
    icon: 'lucide:award',
    color: '#d97706',
    titleZh: '党员积分与评定',
    titleEn: 'Party Points & Rating',
    descZh: '高校 60+40 分桶制考核，支持自定义细则、跨模块一键同步考勤/党费/志愿草稿与脱敏导出',
    descEn: 'University 60+40 scoring ledger with rule customization, cross-module draft sync & masked export',
    badgeZh: '60+40 分制'
  },
  {
    key: 'volunteer',
    routeName: 'ledger_volunteer',
    icon: 'lucide:heart-handshake',
    color: '#16a34a',
    titleZh: '志愿时长台账',
    titleEn: 'Volunteer Hours Ledger',
    descZh: '按活动与按成员双视角统计志愿时长，支持微信接龙识人、公示导出与积分草稿联动',
    descEn: 'Activity & member views, WeChat list parser, public sheets & points sync',
    badgeZh: 'v0.2.7 新增'
  },
  {
    key: 'birthday',
    routeName: 'library_birthday',
    icon: 'lucide:gift',
    color: '#A81C24',
    titleZh: '政治生日贺卡',
    titleEn: 'Political Birthday Cards',
    descZh: '近 30/60 天入党周年提醒、定制寄语与高清电子贺卡一键导出',
    descEn: '30/60-day party anniversary reminders & custom greeting card studio'
  }
];

export const DEFAULT_WORKSPACE_CONFIG: Sct.WorkspaceConfig = {
  enabledModules: {
    seatmap: true,
    points: true,
    volunteer: true,
    birthday: true
  },
  customFields: [],
  onboardingCompleted: false,
  onboardingVersion: ONBOARDING_CURRENT_VERSION
};

export function normalizeWorkspaceConfig(raw: unknown): Sct.WorkspaceConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      enabledModules: { ...DEFAULT_WORKSPACE_CONFIG.enabledModules },
      customFields: []
    };
  }
  const src = raw as Partial<Sct.WorkspaceConfig>;

  return {
    enabledModules: {
      seatmap: src.enabledModules?.seatmap ?? DEFAULT_WORKSPACE_CONFIG.enabledModules.seatmap,
      points: src.enabledModules?.points ?? DEFAULT_WORKSPACE_CONFIG.enabledModules.points,
      volunteer: src.enabledModules?.volunteer ?? DEFAULT_WORKSPACE_CONFIG.enabledModules.volunteer,
      birthday: src.enabledModules?.birthday ?? DEFAULT_WORKSPACE_CONFIG.enabledModules.birthday
    },
    customFields: Array.isArray(src.customFields)
      ? src.customFields
          .filter(f => f && typeof f.key === 'string' && typeof f.label === 'string' && f.label.trim())
          .map(f => ({
            key: f.key,
            label: f.label.trim(),
            type: f.type === 'select' ? 'select' : 'text',
            options: Array.isArray(f.options) ? f.options.map(s => String(s).trim()).filter(Boolean) : undefined,
            showInTable: Boolean(f.showInTable)
          }))
      : [],
    onboardingCompleted: Boolean(src.onboardingCompleted),
    onboardingVersion: typeof src.onboardingVersion === 'string' ? src.onboardingVersion : ONBOARDING_CURRENT_VERSION,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : undefined
  };
}

export function loadWorkspaceConfigSync(): Sct.WorkspaceConfig {
  if (typeof localStorage === 'undefined') {
    return normalizeWorkspaceConfig(null);
  }
  try {
    const raw = localStorage.getItem(WORKSPACE_CONFIG_STORAGE_KEY);
    if (!raw) return normalizeWorkspaceConfig(null);
    return normalizeWorkspaceConfig(JSON.parse(raw));
  } catch {
    return normalizeWorkspaceConfig(null);
  }
}

export function persistWorkspaceConfigSync(config: Sct.WorkspaceConfig): void {
  reactiveEnabledModules.value = { ...config.enabledModules };
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WORKSPACE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* ignore storage quota errors */
  }
}

/** 全局零循环依赖响应式模块开关（供路由菜单与总览卡片即时隐藏/展示） */
export const reactiveEnabledModules = ref<Record<Sct.OptionalModuleKey, boolean>>({
  ...loadWorkspaceConfigSync().enabledModules
});

/** 路由名到可选模块键的映射 */
export const ROUTE_TO_OPTIONAL_MODULE: Record<string, Sct.OptionalModuleKey> = {
  ledger_points: 'points',
  ledger_volunteer: 'volunteer',
  library_birthday: 'birthday'
};

// ---------------- 成员全生命周期状态辅助纯函数 ----------------

export const MEMBER_LIFECYCLE_META: Record<
  Sct.MemberLifecycleStatus,
  { labelZh: string; labelEn: string; color: string; tagType: 'success' | 'warning' | 'error' | 'info' | 'default' }
> = {
  在册正常: { labelZh: '在册正常', labelEn: 'Active', color: '#16a34a', tagType: 'success' },
  转出办理中: { labelZh: '转出办理中', labelEn: 'Transferring Out', color: '#dc2626', tagType: 'error' },
  转入待核查: { labelZh: '转入待核查', labelEn: 'Incoming Audit', color: '#d97706', tagType: 'warning' },
  流出党员: { labelZh: '流出党员', labelEn: 'Floating Out', color: '#2563eb', tagType: 'info' },
  流入党员: { labelZh: '流入党员', labelEn: 'Floating In', color: '#0f766e', tagType: 'info' },
  已转出: { labelZh: '已转出', labelEn: 'Transferred Out', color: '#64748b', tagType: 'default' },
  停止发展: { labelZh: '停止发展', labelEn: 'Stopped', color: '#64748b', tagType: 'default' }
};

export function getMemberLifecycle(member?: Pick<Sct.Member, 'lifecycle_status'>): Sct.MemberLifecycleStatus {
  return member?.lifecycle_status ?? '在册正常';
}

/** 是否属于当前在册（参与常规座位图、下月党费、常规会议考勤与谈话覆盖） */
export function isMemberActive(member?: Pick<Sct.Member, 'lifecycle_status'>): boolean {
  const status = getMemberLifecycle(member);
  return status === '在册正常' || status === '流出党员' || status === '流入党员';
}

/** 是否参与本支部党费与正式统计（在册正常 + 流出党员；流入党员党费仍在原支部，已转出/停止发展不参与新增） */
export function isMemberInBranchRoster(member?: Pick<Sct.Member, 'lifecycle_status'>): boolean {
  const status = getMemberLifecycle(member);
  return status === '在册正常' || status === '流出党员' || status === '转出办理中';
}

/** 是否已历史归档（已转出 / 停止发展） */
export function isMemberArchived(member?: Pick<Sct.Member, 'lifecycle_status'>): boolean {
  const status = getMemberLifecycle(member);
  return status === '已转出' || status === '停止发展';
}

/** 是否属于流动党员（流出 / 流入） */
export function isMemberFloating(member?: Pick<Sct.Member, 'lifecycle_status'>): boolean {
  const status = getMemberLifecycle(member);
  return status === '流出党员' || status === '流入党员';
}

// ---------------- 新转入人员档案标准核查项（供多人核查矩阵与核实函使用） ----------------

export interface IncomingAuditItemDef {
  key: string;
  shortLabel: string;
  fullLabel: string;
  stageHint: string;
  reqNote: string;
}

export const INCOMING_AUDIT_ITEMS: readonly IncomingAuditItemDef[] = [
  {
    key: 'app_letter',
    shortLabel: '入党申请书',
    fullLabel: '1. 入党申请书',
    stageHint: '申请阶段',
    reqNote: '本人手写，落款日期须年满 18 周岁'
  },
  {
    key: 'app_talk',
    shortLabel: '申请谈话',
    fullLabel: '2. 党组织派人谈话记录',
    stageHint: '申请阶段',
    reqNote: '递交申请书后 1 个月内完成谈话并存档'
  },
  {
    key: 'activist_approval',
    shortLabel: '积极分子批复',
    fullLabel: '3. 确定积极分子支委会记录/备案批复',
    stageHint: '积极分子',
    reqNote: '含推优表、支委会记录及上级党委备案批复'
  },
  {
    key: 'inspection_book',
    shortLabel: '培养考察表',
    fullLabel: '4. 积极分子/发展对象培养教育考察表',
    stageHint: '积极分子',
    reqNote: '每半年填写一次考察意见，连续满 1 年'
  },
  {
    key: 'thought_reports',
    shortLabel: '思想汇报',
    fullLabel: '5. 思想汇报（按季度）',
    stageHint: '积极分子/预备',
    reqNote: '积极分子及预备期每季度至少 1 篇'
  },
  {
    key: 'dev_approval',
    shortLabel: '发展对象批复',
    fullLabel: '6. 确定发展对象公示与党委批复',
    stageHint: '发展对象',
    reqNote: '含群众意见记录、公示材料及备案批复'
  },
  {
    key: 'political_review',
    shortLabel: '政审与培训',
    fullLabel: '7. 综合性政审报告与短期集中培训结业证',
    stageHint: '发展对象',
    reqNote: '含直系亲属外调函/证明、自传、培训结业证'
  },
  {
    key: 'oath_book',
    shortLabel: '入党志愿书',
    fullLabel: '8. 入党志愿书及接收批复',
    stageHint: '预备党员',
    reqNote: '支委会预审、支部大会决议及党委审批完整盖章'
  },
  {
    key: 'full_approval',
    shortLabel: '转正材料',
    fullLabel: '9. 转正申请书、支部大会决议及转正批复',
    stageHint: '正式党员',
    reqNote: '正式党员须含完整转正公示、决议与党委批复'
  }
];
