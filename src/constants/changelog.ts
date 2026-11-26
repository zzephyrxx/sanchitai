/**
 * 应用版本与面向用户的精简更新日志（供右上角「更新内容」小弹窗支持左右翻阅历史版本）
 */
export interface ChangelogItem {
  /** 总结性小标题（用于新增功能行首加粗展示） */
  titleZh?: string;
  titleEn?: string;
  zh: string;
  en: string;
  /** 每条小功能专属匹配的小图标（如 lucide:git-branch） */
  icon?: string;
  /** 鼠标悬浮在「更多」上时展示的补充说明（面向用户的功能细节，不暴露底层术语） */
  detailZh?: string;
  detailEn?: string;
  badge?: string;
}

export interface ChangelogSection {
  icon?: string;
  titleZh?: string;
  titleEn?: string;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export const CHANGELOG_HISTORY: ChangelogRelease[] = [
  {
    version: 'v0.2.8',
    date: '2026-11-26',
    sections: [
      {
        items: [
          {
            icon: 'lucide:send',
            titleZh: '成员全生命周期与组织关系转接闭环',
            titleEn: 'Member Lifecycle & Organization Transfer',
            zh: '彻底告别「关系转出 = 直接删除」：顶部 5 枚状态胶囊（在册 / 转出办理中 / 转入待核查 / 流动党员 / 历史归档），配套单人 4 步转出抽屉、毕业季批量转出、转入多人档案核查矩阵与《商请核实函》《自提申请书》标准 .docx 导出，历史台账永久留痕防误删',
            en: 'Full member lifecycle pills, 4-step outgoing transfer drawer, batch graduation workbench, incoming audit matrix & standard .docx letter exports'
          },
          {
            icon: 'lucide:heart-handshake',
            titleZh: '志愿时长台账（三合一快录）',
            titleEn: 'Volunteer Hours Ledger',
            zh: '新增志愿时长台账：支持按活动与按成员双视角、人头芯片勾选微调 + 台历活动引入 + 粘贴微信群接龙自动识别单人时长与岗位，支持考核折算预览、双 Sheet Excel 公示表与打印公示单',
            en: 'Dual activity/member views, WeChat list parser with per-member hours & roles, calendar import, Excel & print notice exports'
          },
          {
            icon: 'lucide:award',
            titleZh: '党员积分升级（60+40 分桶制与构成进度条）',
            titleEn: 'Party Points Upgrade (60+40 & Breakdown Bar)',
            zh: '聚焦高校 60+40 分桶制考核，保留经典台账布局与独立录入弹窗，融入彩色分段积分构成进度条，并新增「一键同步草稿」自动扫描三会一课考勤、党费欠缴与志愿时长生成待核实条目',
            en: 'Focused 60+40 university scoring with classic ledger & entry modal, segmented breakdown bar, and one-click cross-module draft sync'
          },
          {
            icon: 'lucide:chart-pie',
            titleZh: '统计总览新增 6 项大尺寸数据可视化组件',
            titleEn: '6 New Dashboard Visualization Widgets',
            zh: '新增支部健康五维雷达、积分 60+40 仪表盘、志愿时长来源环、成员生命周期 10×10 方格矩阵、年度谈话覆盖温度计与党小组活力同心环，全面适配墨韵/电子纸双皮肤与深浅模式',
            en: 'Added 6 spacious theme-aware visual widgets: health radar, points gauge, volunteer donut, lifecycle waffle, talk thermometer & group rings'
          },
          {
            icon: 'lucide:file-text',
            titleZh: '党支部材料库扩充至 14 套并升级国标公文 .docx 导出',
            titleEn: '14 Branch Doc Templates & GB/T 9704 .docx Export',
            zh: '新增「组织建设」分类及换届选举请示/报告/公告、设立支部请示、政审综合报告、发展公示、支部大会决议、年度组织生活会请示等 8 套高校党支部高频公文模板；全面升级为原生标准 .docx 导出',
            en: 'Expanded to 14 university party-branch templates and upgraded Word export to native OOXML .docx following GB/T 9704-2012',
            detailZh:
              '导出的 .docx 严格遵循《党政机关公文格式》GB/T 9704-2012：A4 规范页边距（上37/下35/左28/右26mm）、28 磅固定行距、方正小标宋简体/黑体/楷体_GB2312/仿宋_GB2312 分级字体，以及四号宋体奇偶页公文页码。',
            detailEn:
              'Exports true OOXML .docx matching GB/T 9704-2012 A4 margins, exact 28pt line spacing, hierarchical Chinese official fonts, and odd/even page footers.'
          },
          {
            icon: 'lucide:blocks',
            titleZh: '左下角「模块管理」与花名册「列设置」扩展字段',
            titleEn: 'Sidebar Module Manager & Custom Roster Fields',
            zh: '「模块管理」移至侧栏左下角使用指南上方，随时一键定制左侧菜单功能显隐（隐藏菜单但保留全部数据）；花名册自定义扩展字段整合进人员页「列设置」，随手增删更顺手',
            en: 'Moved Module Manager to the bottom-left sidebar above User Guide, and integrated custom roster fields directly into Members column settings'
          },
          {
            icon: 'lucide:compass',
            titleZh: '2 步支部初始化、跨页引导动画与使用指南',
            titleEn: '2-Step Setup, Spotlight Tour & User Guide',
            zh: '新增精简 2 步高校支部初始化弹窗、15 模块可检索「使用指南」手册与跨页新手引导动画，侧栏左下角随时重温',
            en: '2-step branch setup modal, searchable 15-module user guide & interactive cross-page spotlight tour'
          },
          {
            icon: 'lucide:shield-check',
            titleZh: '全局脱敏导出与界面细节打磨',
            titleEn: 'Privacy Exports & UI Polish',
            zh: '全站表格导出默认「脱敏公示版」，全量报送需二次确认；台历右侧今日日程栏与顶部菜单栏支持窄屏弹性收起；知识库卡片支持二次确认删除与恢复内置；政策阅读弹窗升级党建红顶部胶囊条；精简设置页与统一「关于」排版',
            en: 'Default masked public exports, responsive calendar sidebar & top header, deletable knowledge cards with restore, refined policy modal & unified Settings About layout'
          }
        ]
      }
    ]
  },
  {
    version: 'v0.2.6',
    date: '2026-11-24',
    sections: [
      {
        icon: 'lucide:sparkles',
        titleZh: '新增功能',
        titleEn: 'New Features',
        items: [
          {
            icon: 'lucide:arrow-left-right',
            titleZh: '跨阶段查看材料清单',
            titleEn: 'Cross-Stage Material Checklist',
            zh: '党员发展右侧栏新增五阶段翻页轨，支持随时切换查看上一阶段或下一阶段的独立材料清单',
            en: 'Stage stepper in Party Development sidebar to switch & view independent checklists across all 5 stages',
            detailZh:
              '点击右侧栏顶部的 1~5 阶段轨或「上一阶段 / 下一阶段」，即可单独查看对应阶段的完整材料清单（非拼接展示），并可直接补录或修改历史阶段的归档状态与日期。',
            detailEn:
              'Click the 1–5 stage track or Prev/Next buttons to view and edit that stage’s standalone checklist and archive dates.'
          },
          {
            icon: 'lucide:git-branch',
            titleZh: '党员发展时间线',
            titleEn: 'Party Development Timeline',
            badge: 'Preview',
            zh: '党员发展新增「查看发展时间线」弹窗，以 S 型圆点里程碑轨道展示各阶段关键节点与进度',
            en: 'S-curve milestone timeline modal showing key stages, archive dates & material progress',
            detailZh:
              '支持「精简里程碑（12 节点）」与「完整流程（25 节点）」双视图切换；点击任意节点圆环或下方卡片可在底部展开查看工作要求、对应日期并快捷变更归档状态。',
            detailEn:
              'Switch between 12 key milestones and full 25 steps on an S-curve track; click any node to view details and update status.'
          },
          {
            icon: 'lucide:folder-check',
            titleZh: '按阶段一键归档材料',
            titleEn: 'One-Click Stage Material Archiving',
            zh: '党员发展右侧栏与时间线弹窗均新增「一键归档」，支持单页集中完成整阶段材料的批量归档与日期录入',
            en: 'Batch archive an entire development stage from the sidebar or timeline modal on a single page',
            detailZh:
              '支持「不设置日期（全无）」「同页逐条依次设置」「统一设为同一日期」三种模式，可快捷勾选「同时包含前序未归档阶段」；已归档材料默认保留原日期不覆盖。',
            detailEn:
              'Supports no-date, per-item dates on one page, or uniform date, plus optional prior unarchived stages while preserving existing archive dates by default.'
          },
          {
            icon: 'lucide:calendar-off',
            titleZh: '归档日期支持「无」',
            titleEn: 'Optional Archive Date',
            zh: '党员发展材料变更状态时，归档日期新增「无」选项，方便暂未确定日期的材料先行登记',
            en: 'Added "None" option for archive date when updating material status in Party Development'
          },
          {
            icon: 'lucide:wallet-cards',
            titleZh: '党费批量设为已缴',
            titleEn: 'Batch Mark Dues as Paid',
            zh: '党费收缴新增「批量设为已缴」与表头单月「全员已缴」，支持一键完成多人多月党费登记',
            en: 'Batch mark-as-paid toolbar and single-month header quick action in Party Dues',
            detailZh:
              '可通过顶部工具栏按人员与起止月份批量标记已缴（支持跳过已有记录），也可直接点击表格中任意月份列头的「✓ 全员已缴」一键将该月未缴人员全部设为已缴。',
            detailEn:
              'Batch mark selected members and month ranges as paid from the toolbar, or click the month column header to mark all unpaid members for that month.'
          },
          {
            icon: 'lucide:message-square-plus',
            titleZh: '谈心谈话快捷新建',
            titleEn: 'Quick Talk Creation',
            zh: '谈心谈话支持点击顶部成员卡片快速弹出「新建谈心谈话」窗口，并自动填入该名党员',
            en: 'Click any member card in Heart-to-Heart Talks to immediately open the new talk modal with that member pre-filled'
          },
          {
            icon: 'lucide:cake',
            titleZh: '政治生日近 30/60 天快加',
            titleEn: '30/60-Day Birthday Quick-Add',
            zh: '政治生日提醒范围升级为「近 30 天 / 近 60 天」切换，并支持按需勾选名单快速加入台账',
            en: 'Political Birthday reminder upgraded to 30/60-day toggle with selective quick-add',
            detailZh:
              '点击「快速添加」可自由勾选近期过政治生日的党员（已添加人员自动标识防重复），也可一键直接载入贺卡预览或批量创建纪念事项。',
            detailEn:
              'Selectively check upcoming birthday members to add to the ledger or load directly into the greeting card preview.'
          },
          {
            icon: 'lucide:package-check',
            titleZh: '专属 .sctpack 交接包与按需导入导出',
            titleEn: 'Exclusive .sctpack Selective Import/Export',
            badge: 'Preview',
            zh: '换届交接与数据备份升级为专属「.sctpack」安全封装格式，新增「导入数据包」入口与按模块勾选导出/导入',
            en: 'Exclusive .sctpack package format with selective module export and new Import Data Package entry',
            detailZh:
              '导出的数据包不再暴露为明文文件，支持按需勾选导出模块（如排除个人外观偏好）及设置可选交接口令；导入时可先预览包含的模块与记录数，按需勾选恢复，同时兼容旧版备份文件导入。',
            detailEn:
              'Protected .sctpack format prevents plain-text exposure, supports choosing modules and optional password on export, and previews modules before selective import.'
          },
          {
            icon: 'lucide:folder-cog',
            titleZh: '自定义数据存储路径',
            titleEn: 'Custom Data Storage Directory',
            zh: '桌面端支持自定义数据存储文件夹路径，更改后可将现有全部台账与快照无缝迁移至新目录',
            en: 'Custom data storage directory on desktop with one-click seamless migration of existing data and snapshots'
          },
          {
            icon: 'lucide:cloud-download',
            titleZh: '版本自动检测与一键更新',
            titleEn: 'Auto Update Check & One-Click Install',
            badge: 'Preview',
            zh: '新增版本自动检测更新，发现新版本时在页面右上角弹出提醒卡片，支持一键下载并自动安装更新',
            en: 'Automatic update detection with top-right notification card and one-click download & install',
            detailZh:
              '可在「设置」中开启启动自动检查或手动点击检查更新；执行更新前系统会自动生成一份保护快照，确保跨版本升级时历史台账数据安全无损。',
            detailEn:
              'Auto-check on startup or manually in Settings; automatically creates a safety snapshot before applying updates.'
          },
          {
            icon: 'lucide:sliders',
            titleZh: '界面密度与 150% 字号缩放',
            titleEn: 'UI Density & 150% Font Scale',
            zh: '外观设置新增「界面密度（紧凑 / 舒适 / 宽松）」切换，并将全局字号缩放上限提升至 150%',
            en: 'Added UI Density (Compact / Comfortable / Spacious) setting and raised font scale limit to 150%'
          }
        ]
      },
      {
        icon: 'lucide:sliders-horizontal',
        titleZh: '体验优化',
        titleEn: 'Experience Improvements',
        items: [
          {
            icon: 'lucide:pen-line',
            zh: '政治生日撰写专属寄语旁醒目显示当前寄语对象，并在编辑时实时联动右侧贺卡内页预览',
            en: 'Highlighted current recipient above the Political Birthday wishes editor with live inner-page preview'
          },
          {
            icon: 'lucide:users-round',
            zh: '谈心谈话年度覆盖统计与待办提醒精准聚焦「预备党员 + 正式党员」，不再将申请人等计入未谈话分母',
            en: 'Heart-to-Heart Talks coverage matrix and reminders now accurately target Probationary and Full Party Members'
          },
          {
            icon: 'lucide:columns-3',
            zh: '统一党员发展五泳道顶部卡片在浅色与深色模式下的底色质感，本阶段及前序材料齐备后展示泳道同色系「本阶段材料已备齐」标识，并优化人员档案与党员积分操作列按钮样式',
            en: 'Unified 5 swimlane header cards across light/dark modes, added lane-colored "Stage ready" badges, and enhanced action buttons in Members & Party Points'
          },
          {
            icon: 'lucide:search',
            zh: '拓宽党费收缴搜索框宽度以完整显示提示文字；设置页自动与手动快照均扩充至 10 份；移除无明显效果的主题圆角配置',
            en: 'Widened Party Dues search input, expanded auto/manual snapshots to 10 each, and removed ineffective border-radius setting'
          },
          {
            icon: 'lucide:panel-left',
            zh: '默认布局模式调整为「左侧菜单布局」，浏览器网页标签统一显示为「页面名 · 三尺台」',
            en: 'Set Left Sidebar as default layout and unified browser tab titles to "Page · 三尺台"'
          }
        ]
      },
      {
        icon: 'lucide:wrench',
        titleZh: '问题修复',
        titleEn: 'Bug Fixes',
        items: [
          {
            icon: 'lucide:check-circle-2',
            zh: '修复党员发展中当全部材料已归档后，卡片与详情页仍显示下一步待办「材料归档」的问题',
            en: 'Fixed stale "Archive Materials" next-step todo remaining after all materials are archived'
          },
          {
            icon: 'lucide:file-text',
            zh: '修复材料库缺少内置默认模板，以及清空业务数据后默认模板未能自动保留的问题',
            en: 'Fixed missing built-in document templates in Document Library and preserved them when clearing data'
          },
          {
            icon: 'lucide:hand',
            zh: '修复桌面端在统计总览编排组件、组织与流程划分党小组、党员发展泳道拖放卡片时无法拖拽的问题',
            en: 'Fixed drag-and-drop not working on desktop in Dashboard widgets, Party Group assignment, and Development lanes'
          },
          {
            icon: 'lucide:contrast',
            zh: '修复浅色模式下党员发展阶段切换器选中项文字看不清，以及深色模式下部分泳道顶栏底色不统一的问题',
            en: 'Fixed unreadable text on selected stage in light mode and inconsistent swimlane header backgrounds in dark mode'
          },
          {
            icon: 'lucide:bug',
            zh: '修复其他已知若干问题',
            en: 'Fixed other minor known issues'
          }
        ]
      }
    ]
  },
  {
    version: 'v0.2.5',
    date: '2026-11-22',
    sections: [
      {
        icon: 'lucide:award',
        titleZh: '党员积分与党务资源',
        titleEn: 'Party Points & Library',
        items: [
          {
            zh: '新增「党员积分」：支持年度加减分登记、待核实审批、预警筛选，以及 Excel 导出与《支部记录表》打印',
            en: 'New Party Member Points: annual scoring, review workflow, alerts, Excel export & printable record sheet',
            badge: 'Preview'
          },
          {
            zh: '升级「材料库」：支持自定义新增与导入模板、双栏实时预览，以及归档材料在线编辑与复用',
            en: 'Upgraded Document Library: custom/imported templates, dual-pane preview, archive editing & reuse',
            badge: 'Preview'
          },
          {
            zh: '升级「政策文件」：支持点击卡片弹窗阅读、自定义增删改法规要点，并修复权威原文直达链接',
            en: 'Upgraded Policy Documents: reading modal card, custom policy CRUD & verified official links',
            badge: 'Preview'
          }
        ]
      },
      {
        icon: 'lucide:git-fork',
        titleZh: '组织架构与台账体验',
        titleEn: 'Organization & Workbench UX',
        items: [
          {
            zh: '组织架构全面改用「支部党小组」：支持自定义添加多名青年委员，并可开启编辑模式拖拽人员重新分组',
            en: 'Party Groups in Org Chart: custom Youth Committee roles & drag-and-drop member regrouping'
          },
          {
            zh: '三会一课支持「按学年 / 按年度」筛选；台历新增拖拽改期确认弹窗与撕纸删除撤销动效',
            en: 'Academic/Calendar year filter for Meetings; drag reschedule confirmation & paper-tear delete with undo'
          },
          {
            zh: '统计总览新增数据加载动效与自定义布局摇晃反馈；设置页升级为双栏排版与自动/手动双快照区',
            en: 'Dashboard entrance animations & layout jiggle mode; compact 2-column Settings with dual snapshot rings'
          }
        ]
      }
    ]
  },
  {
    version: 'v0.2.4',
    date: '2026-11-21',
    sections: [
      {
        icon: 'lucide:users',
        titleZh: '人员档案与导入',
        titleEn: 'Members & Import',
        items: [
          {
            zh: '兼容 19 列花名册，支持 Excel / CSV 智能映射批量导入',
            en: 'Full 19-column roster schema with smart Excel/CSV batch import'
          },
          {
            zh: '填写入党/转正时间自动计算党员身份；统一「支部缩写+3位」编号',
            en: 'Auto-compute party status from join/full dates; branch-abbr + 3-digit codes'
          },
          {
            zh: '支持自定义显示列；身份证号默认自动隐藏并脱敏展示',
            en: 'Customizable visible columns with auto-hidden & masked ID cards'
          }
        ]
      },
      {
        icon: 'lucide:layout-grid',
        titleZh: '座位图与党员发展',
        titleEn: 'Seat Map & Development',
        items: [
          {
            zh: '新增 4 套座位图预设，新建与编辑均支持改名与自定义行列',
            en: '4 seat map presets with customizable names and row/col dimensions'
          },
          {
            zh: '发展泳道支持纵向折叠、内部独立滚动与右上角搜索自动展开',
            en: 'Collapsible scrollable development lanes with auto-expand search'
          }
        ]
      },
      {
        icon: 'lucide:table-2',
        titleZh: '表格交互与排版',
        titleEn: 'Tables & Layout',
        items: [
          {
            zh: '列表支持拖拽换列与平滑调列宽（自动记忆 + 重置，不再误触排序）',
            en: 'Drag-to-reorder & smooth resize columns (saved + reset, no sort conflict)'
          },
          {
            zh: '筛选与搜索同行收拢；层次/年级彩色区分；谈心谈话覆盖矩阵升级',
            en: 'Single-row filter/search toolbars, colored pills & talk coverage matrix'
          }
        ]
      },
      {
        icon: 'lucide:shield-check',
        titleZh: '切换与数据安全',
        titleEn: 'Bridge & Data Safety',
        items: [
          {
            zh: '支持桌面端 ⇄ 指定浏览器双向同步切换，及关闭窗口行为控制（后台常驻 / 直接退出）',
            en: 'Desktop ⇄ preferred browser sync switching & window close behavior control'
          },
          {
            zh: '导出改为路径选择弹窗；清空/重置加文字确认；快照支持删除',
            en: 'Save-as file picker for exports, text-typed reset guard & snapshot delete'
          }
        ]
      }
    ]
  },
  {
    version: 'v0.2.3',
    date: '2026-11-18',
    sections: [
      {
        icon: 'lucide:palette',
        titleZh: '双皮肤与台账基础',
        titleEn: 'Dual Themes & Core Ledgers',
        items: [
          {
            zh: '推出默认「中式墨韵」与「电子纸（KONTUR）」两套主题皮肤，支持深浅模式切换',
            en: 'Default Ink and KONTUR E-Paper themes with light/dark mode support'
          },
          {
            zh: '上线台历、三会一课、党员发展、党费收缴、谈心谈话与政治生日贺卡核心工作流',
            en: 'Core workflows for Calendar, Meetings, Development, Dues, Talks & Birthday Cards'
          }
        ]
      }
    ]
  }
];

export const APP_VERSION = CHANGELOG_HISTORY[0].version;
export const APP_RELEASE_DATE = CHANGELOG_HISTORY[0].date;
export const LATEST_CHANGELOG: ChangelogSection[] = CHANGELOG_HISTORY[0].sections;
