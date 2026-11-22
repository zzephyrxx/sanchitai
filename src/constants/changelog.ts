/**
 * 应用版本与面向用户的精简更新日志（供右上角「更新内容」小弹窗支持左右翻阅历史版本）
 */
export interface ChangelogItem {
  zh: string;
  en: string;
  badge?: string;
}

export interface ChangelogSection {
  icon: string;
  titleZh: string;
  titleEn: string;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

export const CHANGELOG_HISTORY: ChangelogRelease[] = [
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
