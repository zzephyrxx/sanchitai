/**
 * 三尺台 v0.2.7 高校党建工作台配置：
 * - 左下角「模块管理」元数据（除总览 / 花名册 / 设置核心必留外，全部菜单模块与座位图均支持按需启停）
 * - 成员全生命周期状态元数据与判定纯函数
 * - 新转入党员纸质档案标准核查清单
 */

import { ref } from 'vue';

export const DEFAULT_BRANCH_NAME = '高校学生党支部';
export const ONBOARDING_CURRENT_VERSION = '0.2.7';
export const WORKSPACE_CONFIG_STORAGE_KEY = 'sct:workspace-config:v1';

export type WorkshopModuleGroup = 'core_ext' | 'ledger' | 'library';

export interface WorkshopModuleMeta {
  key: Sct.OptionalModuleKey;
  group: WorkshopModuleGroup;
  routeName?: string;
  icon: string;
  color: string;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
  badgeZh?: string;
}

export const WORKSHOP_MODULE_GROUPS: ReadonlyArray<{ key: WorkshopModuleGroup; titleZh: string; titleEn: string }> = [
  { key: 'core_ext', titleZh: '工作台与组织', titleEn: 'Workbench & Org' },
  { key: 'ledger', titleZh: '党务台账', titleEn: 'Party Ledgers' },
  { key: 'library', titleZh: '资料库与工具', titleEn: 'Library & Tools' }
];

export const WORKSHOP_MODULES: readonly WorkshopModuleMeta[] = [
  {
    key: 'calendar',
    group: 'core_ext',
    routeName: 'calendar',
    icon: 'lucide:calendar-days',
    color: '#A81C24',
    titleZh: '工作台历',
    titleEn: 'Work Calendar',
    descZh: '月/周/日日程排期、三会一课联动与台账日程统筹',
    descEn: 'Monthly/weekly schedule & meeting planning'
  },
  {
    key: 'structure',
    group: 'core_ext',
    routeName: 'structure',
    icon: 'lucide:network',
    color: '#7c5cd6',
    titleZh: '组织架构',
    titleEn: 'Org Structure',
    descZh: '支委会脑图指派、党小组分区与 25 步可视化发展流程图',
    descEn: 'Branch committee mind map, party groups & 25-step flowchart'
  },
  {
    key: 'seatmap',
    group: 'core_ext',
    icon: 'lucide:armchair',
    color: '#0f766e',
    titleZh: '人员座位图',
    titleEn: 'Visual Seat Map',
    descZh: '花名册内启用教室/会议室拖拽排座、欠缴红点角标与打印座次表',
    descEn: 'Drag-and-drop seating board & printable seating charts in Members',
    badgeZh: '花名册子视图'
  },
  {
    key: 'meetings',
    group: 'ledger',
    routeName: 'ledger_meetings',
    icon: 'lucide:presentation',
    color: '#2563eb',
    titleZh: '三会一课',
    titleEn: 'Meetings',
    descZh: '党员大会、支委会、党小组会、党课与主题党日考勤台账',
    descEn: 'Branch meetings, semester planner & attendance tracking'
  },
  {
    key: 'development',
    group: 'ledger',
    routeName: 'ledger_development',
    icon: 'lucide:route',
    color: '#b45309',
    titleZh: '党员发展',
    titleEn: 'Development',
    descZh: '五阶段泳道、25 步材料核查清单、S 型时间线与一键归档',
    descEn: '5-stage pipeline, 25-step checklist & S-curve timeline'
  },
  {
    key: 'fees',
    group: 'ledger',
    routeName: 'ledger_fees',
    icon: 'lucide:coins',
    color: '#15803d',
    titleZh: '党费台账',
    titleEn: 'Party Dues',
    descZh: '按月收缴矩阵、批量登记已缴、欠缴提醒与台账导出',
    descEn: 'Monthly dues matrix, batch status updates & unpaid tracking'
  },
  {
    key: 'talks',
    group: 'ledger',
    routeName: 'ledger_talks',
    icon: 'lucide:messages-square',
    color: '#0f766e',
    titleZh: '谈心谈话',
    titleEn: 'Heart-to-Heart Talks',
    descZh: '年度谈话覆盖矩阵、申请人 1 个月谈话提醒与记录留痕',
    descEn: 'Annual coverage matrix & heart-to-heart talk logs'
  },
  {
    key: 'points',
    group: 'ledger',
    routeName: 'ledger_points',
    icon: 'lucide:award',
    color: '#d97706',
    titleZh: '党员积分',
    titleEn: 'Party Points',
    descZh: '高校 60+40 分桶制考核、跨模块一键同步草稿与脱敏导出',
    descEn: 'University 60+40 scoring ledger & cross-module draft sync',
    badgeZh: '60+40 分制'
  },
  {
    key: 'volunteer',
    group: 'ledger',
    routeName: 'ledger_volunteer',
    icon: 'lucide:heart-handshake',
    color: '#16a34a',
    titleZh: '志愿时长',
    titleEn: 'Volunteer Hours',
    descZh: '活动/成员双视角统计、微信接龙识人与双表公示导出',
    descEn: 'Activity & member views, WeChat parser & public exports',
    badgeZh: 'v0.2.7 新增'
  },
  {
    key: 'knowledge',
    group: 'library',
    routeName: 'library_knowledge',
    icon: 'lucide:graduation-cap',
    color: '#0f766e',
    titleZh: '党建知识库',
    titleEn: 'Knowledge Base',
    descZh: '离线党内法规一图读懂、自定义图解与学习笔记归档',
    descEn: 'Offline visual guides & custom markdown study notes'
  },
  {
    key: 'policy',
    group: 'library',
    routeName: 'library_policy',
    icon: 'lucide:landmark',
    color: '#A81C24',
    titleZh: '政策文件库',
    titleEn: 'Policy Library',
    descZh: '高频党建条例要点卡与本单位 PDF / Word 文件本地归档',
    descEn: 'Core regulations & local document archive'
  },
  {
    key: 'docs',
    group: 'library',
    routeName: 'library_docs',
    icon: 'lucide:folder-open',
    color: '#2563eb',
    titleZh: '公文模板库',
    titleEn: 'Doc Templates',
    descZh: '常用支部会议记录、决议与通知模板一键套用起草',
    descEn: 'Standard templates for notices, minutes & resolutions'
  },
  {
    key: 'birthday',
    group: 'library',
    routeName: 'library_birthday',
    icon: 'lucide:gift',
    color: '#A81C24',
    titleZh: '政治生日贺卡',
    titleEn: 'Political Birthday Cards',
    descZh: '近 30/60 天入党周年提醒、定制寄语与高清贺卡批量导出',
    descEn: '30/60-day anniversary reminders & greeting card studio'
  }
];

export const DEFAULT_ENABLED_MODULES: Record<Sct.OptionalModuleKey, boolean> = {
  calendar: true,
  structure: true,
  seatmap: true,
  meetings: true,
  development: true,
  fees: true,
  talks: true,
  points: true,
  volunteer: true,
  knowledge: true,
  policy: true,
  docs: true,
  birthday: true
};

export const DEFAULT_WORKSPACE_CONFIG: Sct.WorkspaceConfig = {
  enabledModules: { ...DEFAULT_ENABLED_MODULES },
  customFields: [],
  onboardingCompleted: false,
  onboardingVersion: ONBOARDING_CURRENT_VERSION
};

export function normalizeWorkspaceConfig(raw: unknown): Sct.WorkspaceConfig {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_WORKSPACE_CONFIG,
      enabledModules: { ...DEFAULT_ENABLED_MODULES },
      customFields: []
    };
  }
  const src = raw as Partial<Sct.WorkspaceConfig>;
  const enabledModules = { ...DEFAULT_ENABLED_MODULES };
  if (src.enabledModules && typeof src.enabledModules === 'object') {
    for (const key of Object.keys(DEFAULT_ENABLED_MODULES) as Sct.OptionalModuleKey[]) {
      if (typeof src.enabledModules[key] === 'boolean') {
        enabledModules[key] = src.enabledModules[key];
      }
    }
  }

  return {
    enabledModules,
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

/** 路由名到可选模块键的映射（总览 dashboard、花名册 ledger_members、设置 settings 常驻必留） */
export const ROUTE_TO_OPTIONAL_MODULE: Record<string, Sct.OptionalModuleKey> = {
  calendar: 'calendar',
  structure: 'structure',
  ledger_meetings: 'meetings',
  ledger_development: 'development',
  ledger_fees: 'fees',
  ledger_talks: 'talks',
  ledger_points: 'points',
  ledger_volunteer: 'volunteer',
  library_knowledge: 'knowledge',
  library_policy: 'policy',
  library_docs: 'docs',
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
