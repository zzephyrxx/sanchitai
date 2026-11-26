/**
 * 三尺台 v0.2.8 跨页深度「新手引导动画」引擎（基于 driver.js）
 *
 * 性能与体验优化：
 * - 启动时后台静默预加载后续页面懒加载代码包（消除跨页首次跳转卡顿）
 * - 使用 rAF 即时检测元素挂载，去掉多余固定 sleep 延迟，仅对抽屉/弹窗滑入保留最短过渡等待
 * - 每步文案精炼为 1~2 句核心干货，聚焦真实功能与操作路径
 * - 支持自动展开侧栏子菜单、自动点开抽屉/S型时间线/座位图/规则工坊/微信接龙/25步流程图，退出时自动清理
 */
import { nextTick } from 'vue';
import type { Router } from 'vue-router';
import type { LastLevelRouteKey } from '@elegant-router/types';
import { driver } from 'driver.js';
import type { Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { ONBOARDING_CURRENT_VERSION } from '@/constants/workspace-presets';
import { emitTourCommand, tourForcedExpandedKeys } from '@/utils/onboarding-bus';
import { useAppStore } from '@/store/modules/app';
import { useWorkDataStore } from '@/store/modules/work-data';
import { views as routeViews } from '@/router/elegant/imports';

interface SpotlightStepDef {
  id: string;
  route?: string;
  expandSider?: boolean;
  expandMenuKeys?: string[];
  /** 进入该步骤前按顺序派发的页面 UI 命令（自动展开抽屉/弹窗/切换页签） */
  beforeCommands?: string[];
  /** 抽屉/弹窗滑入动画落位等待（ms），普通步骤无需等待 */
  settleMs?: number;
  /** 若目标元素在当前数据下不存在（如清空演示数据），自动平滑跳过 */
  skipIfMissing?: boolean;
  selector: string;
  fallbackSelector?: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  accent?: string;
  when?: () => boolean;
}

const ROUTE_TO_VIEW_KEY: Record<string, LastLevelRouteKey> = {
  '/calendar': 'calendar',
  '/dashboard': 'dashboard',
  '/ledger/members': 'ledger_members',
  '/ledger/meetings': 'ledger_meetings',
  '/ledger/development': 'ledger_development',
  '/ledger/fees': 'ledger_fees',
  '/ledger/talks': 'ledger_talks',
  '/ledger/points': 'ledger_points',
  '/ledger/volunteer': 'ledger_volunteer',
  '/structure': 'structure',
  '/library/knowledge': 'library_knowledge',
  '/library/policy': 'library_policy',
  '/library/docs': 'library_docs',
  '/library/birthday': 'library_birthday',
  '/settings': 'settings'
};

let activeDriver: Driver | null = null;
let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;
let activeSessionId = 0;
const preloadedKeys = new Set<LastLevelRouteKey>();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, ms);
  });
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    window.requestAnimationFrame(() => resolve());
  });
}

/** 预加载指定路由的懒加载组件，让切页秒开不卡顿 */
function preloadRouteChunk(routePath?: string): void {
  if (!routePath) return;
  const key = ROUTE_TO_VIEW_KEY[routePath];
  if (!key || preloadedKeys.has(key)) return;
  const loader = routeViews[key];
  if (typeof loader !== 'function') return;
  preloadedKeys.add(key);
  try {
    void (loader as () => Promise<unknown>)().catch(() => {
      preloadedKeys.delete(key);
    });
  } catch {
    preloadedKeys.delete(key);
  }
}

/** 启动后分批预热全部引导路由（优先预热接下来的 3 个不同路由，其余后台低优预加载） */
function warmupUpcomingRoutes(steps: SpotlightStepDef[], fromIdx: number): void {
  const orderedRoutes: string[] = [];
  for (let i = fromIdx; i < steps.length; i += 1) {
    const r = steps[i].route;
    if (r && !orderedRoutes.includes(r)) orderedRoutes.push(r);
  }
  // 立即预热前 3 个即将访问的页面
  orderedRoutes.slice(0, 3).forEach(preloadRouteChunk);
  // 其余页面错峰后台静默预热，不阻塞主线程渲染
  const rest = orderedRoutes.slice(3);
  if (rest.length) {
    window.setTimeout(() => {
      rest.forEach(preloadRouteChunk);
    }, 350);
  }
}

function isVisibleEl(el: Element | null): el is Element {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** 基于 requestAnimationFrame 的极速 DOM 等待，元素一出现立刻返回 */
async function waitForElement(selector: string, fallbackSelector?: string, timeoutMs = 1400): Promise<Element | null> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (isVisibleEl(el)) return el;
    await nextFrame();
  }
  if (fallbackSelector) {
    const fb = document.querySelector(fallbackSelector);
    if (isVisibleEl(fb)) return fb;
  }
  const last = document.querySelector(selector);
  return isVisibleEl(last) ? last : null;
}

function isEpaperPreset(): boolean {
  return document.documentElement.getAttribute('data-preset') === 'crm-frosted-glass';
}

export function stopSpotlightTour(): void {
  activeSessionId += 1;
  if (activeKeyHandler) {
    window.removeEventListener('keydown', activeKeyHandler, true);
    activeKeyHandler = null;
  }
  tourForcedExpandedKeys.value = null;
  emitTourCommand('tour:cleanup');
  if (activeDriver) {
    const inst = activeDriver;
    activeDriver = null;
    if (inst.isActive()) inst.destroy();
  }
}

export async function runSpotlightTour(router: Router, startStepId?: string): Promise<void> {
  stopSpotlightTour();
  const sessionId = ++activeSessionId;

  const appStore = useAppStore();
  const workStore = useWorkDataStore();
  const mods = workStore.workspaceConfig.enabledModules;
  const landingRoute = mods.calendar !== false ? '/calendar' : '/dashboard';

  const allSteps: SpotlightStepDef[] = [
    // ==================== 一、侧栏与台历核心 ====================
    {
      id: 'sider',
      route: landingRoute,
      expandSider: true,
      expandMenuKeys: ['ledger', 'library'],
      beforeCommands: ['tour:cleanup'],
      settleMs: 120,
      selector: '[data-tour="sider-nav"]',
      title: '导航菜单',
      description: '已展开「党务台账」与「资料与参考」全部入口；未启用的扩展模块会自动隐藏。',
      side: 'right',
      align: 'start',
      accent: '#A81C24'
    },
    {
      id: 'calendar-topbar',
      route: '/calendar',
      when: () => mods.calendar !== false,
      beforeCommands: ['calendar:close-drawer'],
      selector: '[data-tour="calendar-topbar"]',
      title: '台历顶栏',
      description: '切换<strong>日 / 周 / 月</strong>视图、查看今日与本周待办数，或点「新建事项」快速排期。',
      side: 'bottom',
      align: 'center',
      accent: '#A81C24'
    },
    {
      id: 'calendar-body',
      route: '/calendar',
      when: () => mods.calendar !== false,
      beforeCommands: ['calendar:close-drawer'],
      selector: '[data-tour="calendar-body"]',
      title: '台历主网格',
      description: '<strong>点空白格新建、拖卡片跨天改期</strong>、支持按周/月重复投影；删除带「撕纸」撤回防误删。',
      side: 'top',
      align: 'center',
      accent: '#A81C24'
    },
    {
      id: 'calendar-drawer',
      route: '/calendar',
      when: () => mods.calendar !== false,
      beforeCommands: ['calendar:open-first-event'],
      settleMs: 220,
      skipIfMissing: true,
      selector: '[data-tour="cal-event-drawer"]',
      title: '日程详情抽屉',
      description: '点击任意日程滑出详情，一键标记<strong>进行中 / 已完成</strong>、编辑或删除。',
      side: 'left',
      align: 'start',
      accent: '#A81C24'
    },
    {
      id: 'calendar-sidebar',
      route: '/calendar',
      when: () => mods.calendar !== false,
      beforeCommands: ['calendar:close-drawer'],
      settleMs: 140,
      skipIfMissing: true,
      selector: '[data-tour="calendar-sidebar"]',
      title: '今日日程栏（弹性自适应）',
      description: '速览今日日程、近期提醒与分类图例；窗口较窄时自动收起，可从顶栏右侧抽屉图标随时展开。',
      side: 'left',
      align: 'start',
      accent: '#A81C24'
    },

    // ==================== 二、顶栏与统计总览 ====================
    {
      id: 'header-tools',
      route: landingRoute,
      beforeCommands: ['calendar:close-drawer'],
      selector: '[data-tour="header-tools"]',
      title: '全局工具与 ⌘K 速搜',
      description:
        '按 <code>⌘K</code> / <code>Ctrl+K</code> 全局检索；支持支部身份、双皮肤、字号缩放与 PIN 锁屏，窄屏自动精简排布。',
      side: 'bottom',
      align: 'end',
      accent: '#2563eb'
    },
    {
      id: 'dashboard-grid',
      route: '/dashboard',
      selector: '[data-tour="dashboard-grid"]',
      title: '统计总览与 6 项创意可视化',
      description:
        '汇总待办自动预警与基础指标，并新增<strong>健康五维雷达、积分仪表、志愿来源环、生命周期矩阵、谈话温度计与党小组同心环</strong>。',
      side: 'top',
      align: 'center',
      accent: '#2563eb'
    },
    {
      id: 'dashboard-customize',
      route: '/dashboard',
      selector: '[data-tour="dashboard-customize"]',
      title: '自定义看板布局',
      description: '开启后可像手机桌面一样拖拽重排、增删统计卡片，随时恢复默认。',
      side: 'left',
      align: 'start',
      accent: '#2563eb'
    },

    // ==================== 三、人员花名册 · 生命周期 · 座位图 ====================
    {
      id: 'members-lifecycle',
      route: '/ledger/members',
      beforeCommands: ['members:reset'],
      selector: '[data-tour="members-lifecycle"]',
      title: '人员 5 态全生命周期',
      description:
        '覆盖<strong>在册 / 转出中 / 转入待核查 / 流动党员 / 历史归档</strong>；转入支持多人核查矩阵与导核实函。',
      side: 'bottom',
      align: 'start',
      accent: '#dc2626'
    },
    {
      id: 'members-actions',
      route: '/ledger/members',
      beforeCommands: ['members:reset'],
      selector: '[data-tour="members-actions"]',
      title: '批量转出、列设置与防误删',
      description:
        '支持毕业季批量转出、在「列设置」中增删自定义扩展字段及默认脱敏导出；凡有历史台账的成员拦截物理删除。',
      side: 'bottom',
      align: 'end',
      accent: '#dc2626'
    },
    {
      id: 'members-card-drawer',
      route: '/ledger/members',
      beforeCommands: ['members:open-first-card'],
      settleMs: 220,
      skipIfMissing: true,
      selector: '[data-tour="member-card-drawer"]',
      title: '人员详情档案',
      description: '一键发起「关系转出」或制「生日卡」；身份证默认脱敏（点眼睛临时看 15 秒），自动汇总志愿时长。',
      side: 'left',
      align: 'start',
      accent: '#dc2626'
    },
    {
      id: 'members-seatmap',
      route: '/ledger/members',
      beforeCommands: ['members:show-seatmap'],
      settleMs: 140,
      when: () => mods.seatmap !== false,
      selector: '[data-tour="members-seatmap-area"]',
      fallbackSelector: '[data-tour="members-view-tabs"]',
      title: '可视化座位图',
      description: '内置 4 套布区预设，开「编排模式」支持拖拽换座、撤销与打印座次表，头像红点预警欠缴。',
      side: 'top',
      align: 'center',
      accent: '#0f766e'
    },

    // ==================== 四、三会一课 ====================
    {
      id: 'meetings-actions',
      route: '/ledger/meetings',
      when: () => mods.meetings !== false,
      beforeCommands: ['tour:cleanup'],
      selector: '[data-tour="meetings-actions"]',
      title: '三会一课 · 一键排期',
      description: '按规范一键生成整学期会议排期并同步台历；单月线下会议超 3 次自动减负提醒。',
      side: 'bottom',
      align: 'end',
      accent: '#2563eb'
    },
    {
      id: 'meetings-toolbar',
      route: '/ledger/meetings',
      when: () => mods.meetings !== false,
      selector: '[data-tour="meetings-toolbar"]',
      title: '学年 / 年度周期统计',
      description: '灵活切换学年学期或自然年度；点开会议可记录出勤与纪要，出勤直连党员积分草稿。',
      side: 'bottom',
      align: 'start',
      accent: '#2563eb'
    },

    // ==================== 五、党员发展（深度 5 步演示） ====================
    {
      id: 'development-toolbar',
      route: '/ledger/development',
      when: () => mods.development !== false,
      beforeCommands: ['dev:reset'],
      selector: '[data-tour="development-toolbar"]',
      title: '党员发展 · 搜索与折叠',
      description: '按姓名、编号或待办节点秒搜，支持一键折叠/展开各阶段泳道。',
      side: 'bottom',
      align: 'end',
      accent: '#d97706'
    },
    {
      id: 'development-lanes',
      route: '/ledger/development',
      when: () => mods.development !== false,
      beforeCommands: ['dev:reset'],
      selector: '[data-tour="development-lanes"]',
      title: '五阶段泳道与拖拽流转',
      description: '按 25 步细则分五列展示；拖拽卡片跨阶段流转受二次确认保护，备齐自动亮绿标识。',
      side: 'top',
      align: 'center',
      accent: '#d97706'
    },
    {
      id: 'development-detail-stepper',
      route: '/ledger/development',
      when: () => mods.development !== false,
      beforeCommands: ['dev:open-first-drawer'],
      settleMs: 220,
      skipIfMissing: true,
      selector: '[data-tour="dev-detail-stepper"]',
      title: '1~5 阶段翻页器 & 一键归档',
      description:
        '随时切回历史阶段补录遗漏材料；点<strong>「一键归档」</strong>支持无日期 / 逐条 / 统一日期三种批量归档。',
      side: 'left',
      align: 'center',
      accent: '#d97706'
    },
    {
      id: 'development-detail-timeline-btn',
      route: '/ledger/development',
      when: () => mods.development !== false,
      beforeCommands: ['dev:open-first-drawer'],
      settleMs: 120,
      skipIfMissing: true,
      selector: '[data-tour="dev-detail-header"]',
      title: '打开 S 型发展时间线',
      description: '点此即可全景查看该同志从申请到转正的全链路里程碑。下一步自动为你打开。',
      side: 'left',
      align: 'start',
      accent: '#A81C24'
    },
    {
      id: 'development-timeline-modal',
      route: '/ledger/development',
      when: () => mods.development !== false,
      beforeCommands: ['dev:open-timeline'],
      settleMs: 220,
      skipIfMissing: true,
      selector: '[data-tour="dev-timeline-body"]',
      fallbackSelector: '[data-tour="dev-timeline-header"]',
      title: 'S 型发展时间线（12 / 25 步双视图）',
      description:
        '绿实线为已归档流向，支持<strong>精简 12 步 / 完整 25 步</strong>切换，点击任意圆点可直接改状态与归档日期。',
      side: 'top',
      align: 'center',
      accent: '#16a34a'
    },

    // ==================== 六、党费收缴与谈心谈话 ====================
    {
      id: 'fees-actions',
      route: '/ledger/fees',
      when: () => mods.fees !== false,
      beforeCommands: ['tour:cleanup'],
      selector: '[data-tour="fees-actions"]',
      title: '党费收缴 · 批量操作',
      description: '月初点「生成本月名单」自动排除归档人员；支持批量标记已缴与导出逐月矩阵。',
      side: 'bottom',
      align: 'end',
      accent: '#16a34a'
    },
    {
      id: 'fees-matrix',
      route: '/ledger/fees',
      when: () => mods.fees !== false,
      selector: '[data-tour="fees-matrix"]',
      fallbackSelector: '[data-tour="fees-summary"]',
      title: '党费人×月一击矩阵',
      description:
        '<strong>单击格子循环切「已缴 / 欠缴 / 减免」</strong>，点月份列头全月已缴；支持学生与在职自定义标准。',
      side: 'top',
      align: 'center',
      accent: '#16a34a'
    },
    {
      id: 'talks-coverage',
      route: '/ledger/talks',
      when: () => mods.talks !== false,
      selector: '[data-tour="talks-coverage"]',
      title: '谈心谈话 · 年度覆盖矩阵',
      description: '追踪年度党员谈话覆盖率，一键筛出未覆盖名单；<strong>直接单击人头卡片</strong>秒建谈话记录。',
      side: 'top',
      align: 'center',
      accent: '#0f766e'
    },

    // ==================== 七、党员积分管理 ====================
    {
      id: 'points-actions',
      route: '/ledger/points',
      beforeCommands: ['tour:cleanup'],
      when: () => mods.points !== false,
      selector: '[data-tour="points-actions"]',
      title: '党员积分 · 60+40 与草稿同步',
      description:
        '采用高校 60+40 分桶制；点「一键同步草稿」自动抓取考勤、党费与志愿时长待核实入账，支持细则微调与脱敏导出。',
      side: 'bottom',
      align: 'end',
      accent: '#d97706'
    },
    {
      id: 'points-kpi',
      route: '/ledger/points',
      when: () => mods.points !== false,
      selector: '[data-tour="points-kpi"]',
      title: '预警快筛与积分构成进度条',
      description: '一键筛出低于 60 分预警或待核实条目；列表与抽屉均展示彩色分段构成进度条，操作列支持独立弹窗快录。',
      side: 'bottom',
      align: 'start',
      accent: '#d97706'
    },

    // ==================== 八、志愿时长台账 ====================
    {
      id: 'volunteer-kpi',
      route: '/ledger/volunteer',
      beforeCommands: ['volunteer:reset'],
      when: () => mods.volunteer !== false,
      selector: '[data-tour="volunteer-kpi"]',
      title: '志愿时长 · 双视角汇总',
      description: '统计累计时长、场次与人次；支持「按活动 ⇄ 按成员」双视角、考核折算及双表 Excel 公示。',
      side: 'bottom',
      align: 'start',
      accent: '#16a34a'
    },
    {
      id: 'volunteer-wechat',
      route: '/ledger/volunteer',
      beforeCommands: ['volunteer:open-drawer', 'volunteer:open-wechat'],
      settleMs: 220,
      skipIfMissing: true,
      when: () => mods.volunteer !== false,
      selector: '[data-tour="volunteer-wechat-box"]',
      title: '微信群接龙一键识人',
      description:
        '直接粘贴群接龙（如 <code>1. 张明远 2h（引导）</code>）自动匹配花名册、算时长与岗位；也支持从台历引入。',
      side: 'left',
      align: 'start',
      accent: '#16a34a'
    },

    // ==================== 九、组织架构、25 步程序图与资料工具 ====================
    {
      id: 'structure-tabs',
      route: '/structure',
      when: () => mods.structure !== false,
      beforeCommands: ['tour:cleanup', 'structure:show-org'],
      settleMs: 100,
      selector: '[data-tour="structure-tabs"]',
      title: '组织架构脑图',
      description: '点支委节点直接指派正式党员或增设青年委员（同步人员档案），下方分区管理党小组。',
      side: 'bottom',
      align: 'start',
      accent: '#7c5cd6'
    },
    {
      id: 'structure-flowchart',
      route: '/structure',
      when: () => mods.structure !== false,
      beforeCommands: ['structure:show-flow'],
      settleMs: 140,
      skipIfMissing: true,
      selector: '[data-tour="structure-flow-canvas"]',
      title: '25 步可视化发展流程图',
      description: '提供标准细则详情版与可自定义编辑的 25 步蛇形程序图，新任支委一看即懂。',
      side: 'top',
      align: 'center',
      accent: '#7c5cd6'
    },
    {
      id: 'knowledge-bar',
      route: '/library/knowledge',
      when: () => mods.knowledge !== false,
      beforeCommands: ['tour:cleanup'],
      selector: '[data-tour="knowledge-bar"]',
      title: '知识库 · 高清图解与笔记',
      description: '离线查阅党内法规一图读懂，支持上传自定义图解与 Markdown，点开卡片支持二次确认删除与恢复内置。',
      side: 'bottom',
      align: 'center',
      accent: '#0f766e'
    },
    {
      id: 'policy-header',
      route: '/library/policy',
      when: () => mods.policy !== false,
      selector: '[data-tour="policy-header"]',
      title: '政策文件与本单位归档',
      description: '内置高频条例要点卡（顶部党建红胶囊纯净阅读弹窗）；切至「本单位归档」可本地留档 PDF / Word / 图片。',
      side: 'bottom',
      align: 'start',
      accent: '#A81C24'
    },
    {
      id: 'docs-templates',
      route: '/library/docs',
      when: () => mods.docs !== false,
      selector: '[data-tour="docs-templates"]',
      title: '14 套党支部公文模板 · 国标 .docx',
      description:
        '覆盖组织建设换届、发展政审决议、三会一课等 14 套高频模板，支持一键导出符合 <strong>GB/T 9704</strong> 标准的原生 <code>.docx</code>。',
      side: 'top',
      align: 'center',
      accent: '#2563eb'
    },
    {
      id: 'birthday-studio',
      route: '/library/birthday',
      when: () => mods.birthday !== false,
      selector: '[data-tour="birthday-studio"]',
      title: '政治生日贺卡工作坊',
      description: '6 套中式党建模板，从花名册快选党员或一键筛出<strong>近 30 / 60 天生日名单</strong>批量制卡。',
      side: 'right',
      align: 'start',
      accent: '#A81C24'
    },
    {
      id: 'birthday-preview',
      route: '/library/birthday',
      when: () => mods.birthday !== false,
      selector: '[data-tour="birthday-preview"]',
      title: '实时预览与 A4 拼版',
      description: '实时预览封面、内页与 A4 对折拼版，支持单人高清导出或整批打包 ZIP 下载。',
      side: 'left',
      align: 'center',
      accent: '#A81C24'
    },

    // ==================== 十、设置、模块管理与左下角指南收尾 ====================
    {
      id: 'settings-backup',
      route: '/settings',
      beforeCommands: ['tour:cleanup'],
      selector: '[data-tour="settings-backup"]',
      title: '10+10 快照与换届交接',
      description: '纯本地离线零上报，内置 20 份环形快照防误删，换届用 <code>.sctpack</code> 按模块加密一键移交。',
      side: 'top',
      align: 'start',
      accent: '#1e6b4b'
    },
    {
      id: 'settings-workshop',
      expandSider: true,
      beforeCommands: ['tour:cleanup'],
      settleMs: 120,
      selector: '[data-tour="module-manager"]',
      title: '左下角「模块管理」',
      description: '随时自由开关左侧菜单栏中的台账、资料库与座位图模块（关闭仅隐藏入口，历史数据安全保留）。',
      side: 'right',
      align: 'end',
      accent: '#7c5cd6'
    },
    {
      id: 'guide-entry',
      expandSider: true,
      beforeCommands: ['tour:cleanup'],
      settleMs: 120,
      selector: '[data-tour="guide-entry"]',
      title: '左下角「使用指南」',
      description: '引导完成！日后随时点此查阅 15 模块完整手册、重放新手引导动画或重新运行初始化设置。',
      side: 'right',
      align: 'end',
      accent: '#A81C24'
    }
  ];

  const steps = allSteps.filter(s => !s.when || s.when());
  if (!steps.length) return;

  let currentIdx = 0;
  if (startStepId) {
    const found = steps.findIndex(s => s.id === startStepId);
    if (found >= 0) currentIdx = found;
  }

  // 立即后台预热所有即将访问的页面代码包，避免首次切页卡顿
  warmupUpcomingRoutes(steps, currentIdx);

  const epaper = isEpaperPreset();
  const drv = driver({
    animate: true,
    duration: 240,
    allowClose: true,
    allowKeyboardControl: false,
    overlayColor: '#0f172a',
    overlayOpacity: 0.56,
    stagePadding: 8,
    stageRadius: epaper ? 0 : 10,
    popoverOffset: 12,
    popoverClass: 'sct-driver-popover',
    onDestroyed: () => {
      if (activeKeyHandler) {
        window.removeEventListener('keydown', activeKeyHandler, true);
        activeKeyHandler = null;
      }
      tourForcedExpandedKeys.value = null;
      emitTourCommand('tour:cleanup');
      if (activeDriver === drv) activeDriver = null;
      void workStore.updateWorkspaceConfig({
        onboardingCompleted: true,
        onboardingVersion: ONBOARDING_CURRENT_VERSION
      });
    }
  });
  activeDriver = drv;

  let navigating = false;
  const isStale = () => sessionId !== activeSessionId || activeDriver !== drv;

  async function showStep(idx: number, direction: 1 | -1 = 1) {
    if (navigating || isStale()) return;
    if (idx < 0 || idx >= steps.length) return;
    navigating = true;
    try {
      let targetIdx = idx;
      let targetEl: Element | null = null;
      let chosenStep = steps[targetIdx];

      while (targetIdx >= 0 && targetIdx < steps.length) {
        if (isStale()) return;
        const step = steps[targetIdx];
        chosenStep = step;

        // 顺手提前预热再往后的 2 个路由，保证零等待
        preloadRouteChunk(steps[targetIdx + 1]?.route);
        preloadRouteChunk(steps[targetIdx + 2]?.route);

        const needSiderExpand = Boolean(step.expandSider && !appStore.isMobile && appStore.siderCollapse);
        if (needSiderExpand) {
          appStore.setSiderCollapse(false);
        }

        const menuChanged = Boolean(step.expandMenuKeys);
        if (step.expandMenuKeys) {
          tourForcedExpandedKeys.value = step.expandMenuKeys;
        } else if (targetIdx > 0 && targetIdx < steps.length - 1) {
          tourForcedExpandedKeys.value = null;
        }

        const routeChanged = Boolean(step.route && router.currentRoute.value.path !== step.route);
        if (routeChanged && step.route) {
          emitTourCommand('tour:cleanup');
          await router.push(step.route);
          if (isStale()) return;
          await nextTick();
          if (isStale()) return;
          await nextFrame();
          if (isStale()) return;
        } else if (needSiderExpand || menuChanged) {
          await sleep(160);
          if (isStale()) return;
        }

        if (step.beforeCommands?.length) {
          for (let ci = 0; ci < step.beforeCommands.length; ci += 1) {
            if (isStale()) return;
            emitTourCommand(step.beforeCommands[ci]);
            await nextTick();
            if (isStale()) return;
            if (ci < step.beforeCommands.length - 1) {
              await sleep(45);
              if (isStale()) return;
            }
          }
          if (step.settleMs) {
            await sleep(step.settleMs);
            if (isStale()) return;
          } else {
            await nextFrame();
            if (isStale()) return;
          }
        }

        targetEl = await waitForElement(step.selector, step.fallbackSelector, step.skipIfMissing ? 650 : 1400);
        if (isStale()) return;
        if (targetEl || !step.skipIfMissing) {
          break;
        }
        targetIdx += direction;
      }

      if (isStale()) return;
      if (targetIdx < 0 || targetIdx >= steps.length) {
        drv.destroy();
        return;
      }

      currentIdx = targetIdx;
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const outOfView = rect.top < 8 || rect.bottom > window.innerHeight - 8;
        if (outOfView) {
          targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
          await nextFrame();
          if (isStale()) return;
        }
      }

      const isFirst = currentIdx === 0;
      const isLast = currentIdx === steps.length - 1;
      const accent = chosenStep.accent ?? '#A81C24';

      drv.highlight({
        element: targetEl ?? undefined,
        popover: {
          title: chosenStep.title,
          description: chosenStep.description,
          side: chosenStep.side ?? 'bottom',
          align: chosenStep.align ?? 'center',
          showProgress: true,
          progressText: `${currentIdx + 1} / ${steps.length}`,
          showButtons: isFirst ? ['next', 'close'] : ['previous', 'next', 'close'],
          prevBtnText: '上一步',
          nextBtnText: isLast ? '完成引导' : '下一步 →',
          popoverClass: 'sct-driver-popover',
          onPopoverRender: popover => {
            popover.wrapper.style.setProperty('--sct-tour-accent', accent);
          },
          onPrevClick: () => {
            void showStep(currentIdx - 1, -1);
          },
          onNextClick: () => {
            if (currentIdx >= steps.length - 1) {
              drv.destroy();
              window.$message?.success('新手引导动画已完成');
            } else {
              void showStep(currentIdx + 1, 1);
            }
          },
          onCloseClick: () => {
            drv.destroy();
          }
        }
      });
    } finally {
      navigating = false;
    }
  }

  activeKeyHandler = (e: KeyboardEvent) => {
    if (!drv.isActive()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      drv.destroy();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      if (currentIdx >= steps.length - 1) drv.destroy();
      else void showStep(currentIdx + 1, 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      if (currentIdx > 0) void showStep(currentIdx - 1, -1);
    }
  };
  window.addEventListener('keydown', activeKeyHandler, true);

  await showStep(currentIdx, 1);
}
