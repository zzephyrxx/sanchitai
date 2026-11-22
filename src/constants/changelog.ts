/**
 * 应用版本与面向用户的精简更新日志（供右上角「更新内容」小弹窗与设置页复用）
 */
export const APP_VERSION = 'v0.2.4';
export const APP_RELEASE_DATE = '2026-11-22';

export interface ChangelogSection {
  icon: string;
  titleZh: string;
  titleEn: string;
  itemsZh: string[];
  itemsEn: string[];
}

export const LATEST_CHANGELOG: ChangelogSection[] = [
  {
    icon: 'lucide:users',
    titleZh: '人员档案与导入',
    titleEn: 'Members & Import',
    itemsZh: [
      '兼容 19 列花名册，支持 Excel / CSV 智能映射批量导入',
      '填写入党/转正时间自动计算党员身份；统一「支部缩写+3位」编号',
      '支持自定义显示列；身份证号默认自动隐藏并脱敏展示'
    ],
    itemsEn: [
      'Full 19-column roster schema with smart Excel/CSV batch import',
      'Auto-compute party status from join/full dates; branch-abbr + 3-digit codes',
      'Customizable visible columns with auto-hidden & masked ID cards'
    ]
  },
  {
    icon: 'lucide:layout-grid',
    titleZh: '座位图与党员发展',
    titleEn: 'Seat Map & Development',
    itemsZh: [
      '新增 4 套座位图预设，新建与编辑均支持改名与自定义行列',
      '发展泳道支持纵向折叠、内部独立滚动与右上角搜索自动展开'
    ],
    itemsEn: [
      '4 seat map presets with customizable names and row/col dimensions',
      'Collapsible scrollable development lanes with auto-expand search'
    ]
  },
  {
    icon: 'lucide:table-2',
    titleZh: '表格交互与排版',
    titleEn: 'Tables & Layout',
    itemsZh: [
      '列表支持拖拽换列与平滑调列宽（自动记忆 + 重置，不再误触排序）',
      '筛选与搜索同行收拢；层次/年级彩色区分；谈心谈话一行五列'
    ],
    itemsEn: [
      'Drag-to-reorder & smooth resize columns (saved + reset, no sort conflict)',
      'Single-row filter/search toolbars, colored pills & 5-col talk coverage'
    ]
  },
  {
    icon: 'lucide:shield-check',
    titleZh: '切换与数据安全',
    titleEn: 'Bridge & Data Safety',
    itemsZh: [
      '新增桌面端 ⇄ 浏览器一键切换与本机同步，支持设置默认打开方式',
      '导出改为路径选择弹窗；清空/重置加文字确认；快照支持删除'
    ],
    itemsEn: [
      'Desktop ⇄ Browser switch with local sync & default open mode setting',
      'Save-as file picker for exports, text-typed reset guard & snapshot delete'
    ]
  }
];
