# 三尺台 v0.2.0 设计规划

> 分支 `feature/v0.2.0`（基线 tag v0.1.0）。定位：提升管理效率 + 便捷服务模板 + 快速交接 + 可拓展定制。
> 用户决策（2026-11-19 采访）：新功能全做（架构图+流程图 / 知识库 / 政策文件库 / 仪表盘可定制）；日历直接换 schedule-x；纸感主色=朱砂印泥红；交接=一键交接包。

---

## 1. 主题系统重构（2 皮肤 × 深/浅 = 4 组合）

| 组合 | 参考 | 关键参数 |
| --- | --- | --- |
| 默认 · 浅色 | stylekit calendar-schedule | 页面底近白 `#fbfbfc`、白卡、主色墨 `#2B2926`（保留现配色体系，仅换背景质感） |
| 默认 · 深色 | stylekit dashboard-charts | 底 `#0b0e14`、卡 `#12161f`、边 `#1f2430`、主色靛蓝 `#4f6ef7`、文字 `#e8eaf0` |
| 纸感 · 浅色 | stylekit crm-frosted-glass | 暖纸底 `#f5f3ee`、白卡磨砂、细边框 `#e6e3db`、圆角收小、数字等宽、主色朱砂 `#9A2C25` |
| 纸感 · 深色 | 纸感语言×深色 | 暖黑纸 `#161513`、卡 `#201e1b` 磨砂、边 `#33302b`、主色亮朱砂 `#C96A5E` |

实现：
- `themePreset: 'default' | 'paper'` 入 ThemeSetting（持久化）；主色按 (preset, darkMode) 在 theme store 的 themeColors 计算中覆写；tokens（layout/container/base-text）按上表在 settings.ts 默认值中更新（默认浅色背景改近白）。
- 新增自有表面变量层 `--sct-page/--sct-container/--sct-border/--sct-soft/--sct-muted`（src/styles/sct-theme.css，按 `html.dark` × `html[data-preset='paper']` 四态定义），**全站硬编码浅色样式（#fff/#faf8f4 等）替换为变量**——这是深色适配修复的根治手段。
- 深浅切换：`document.startViewTransition` + `clip-path circle` 由点击坐标圆形扩散（参考 hjfy.top / art-design-pro 流行做法）；`::view-transition-old/new(root)` 关闭默认动画；不支持时即时切换降级。
- 纸感附加：数字 mono 字体类 `.font-ledger`；naive radius 纸感下调（naiveThemeOverrides borderRadius）。

## 2. 专业性呈现（去开源信息）

- 页脚启用：居中「学工工作平台」。
- 设置 → 关于：去掉底座/致谢大段，仅一行"第三方开源组件：Vue 3 · Naive UI · Schedule-X · ECharts · Dexie · Tauri 等（MIT/Apache）"。
- README：去除"基于 soybean-admin"等表述，改为产品化说明（文档保留在 docs/ 内部）。

## 3. 信息架构（菜单分组，二级）

```
台历 /calendar          统计总览 /dashboard
党务台账                 党务资源
├ 人员 /ledger/members   ├ 知识库 /library/knowledge
├ 三会一课 /ledger/meetings  ├ 政策文件 /library/policy
├ 发展台账 /ledger/development  └ 材料库 /library/docs
├ 党费台账 /ledger/fees
└ 谈心谈话 /ledger/talks
组织与流程 /structure    设置 /settings
├ 组织架构 tab
└ 发展流程图 tab（标准重绘版 / 学院自建版）
```
- 旧路由 /members 等迁移到 /ledger/*（本地应用无外链风险）；elegant-router 目录嵌套自动生成二级菜单。

## 4. 日历迁移：schedule-x（用户点名）

- 包：`@schedule-x/calendar` + `@schedule-x/vue` + `@schedule-x/time-grid` + `@schedule-x/day-grid`（月网格）+ `@schedule-x/current-time` + `@schedule-x/drag-and-drop`（如 Vue 侧可用）+ `@schedule-x/theme-default`。
- 保留交互：空白点击新建、事件点击详情、拖拽改期（插件）、重复日程投影（沿用自研 expandRecurrence，按可视范围喂具体事件）、今日/本周速览、类别色标。
- 自绘月视图：sx 的 month-grid 若交互不足，用自研月网格（dayjs + 事件投影，点击格新建）——保证中式信息密度。
- 主题：CSS 变量对齐 --sct-* 四态。

## 5. 党务图示 /structure

- 组织架构图：数据驱动（member.role），书记→副书记→委员树形卡 + 连接线；岗位槽位可指派/清空（写回 member.role）；空槽提示。
- 发展流程图（标准重绘）：5 阶段纵向带 + 25 节点卡（编号+名称），点击右侧抽屉看 对象/要求/方法/注意 + 材料（数据源自 domain-party-knowledge §2，来源中央组织部流程图+细则）。
- 学院版流程：可编辑线性节点列表（名称/时间窗/责任/备注，Dexie 表 academy_flow），前端渲染为流程带。

## 6. 知识库 /library/knowledge

- 内容源：`支部工作教程（图解）`21 张图 → sips 压缩（宽 1400，jpeg q72，≤300KB/张）入 `src/assets/knowledge/`，import.meta.glob 打包。
- 页面：分类（发展党员/三会一课/组织生活/谈心谈话/综合）+ 标题检索 + 卡片网格 + 点击大图查看（NImage preview）。
- 扩展：运行时可再导入本地图片（IndexedDB blob + 元数据表 knowledge_items）。

## 7. 政策文件库 /library/policy

- 内置政策要点卡（结构化）：支部工作条例（三会一课/组织生活/谈心谈话/换届）、发展党员细则（25 步/材料）、党费规定（标准/比例表）——要点 + 条款出处链接（12371.cn 等）。
- 用户文件：导入 PDF/docx/图片 → IndexedDB blob + 元数据（名称/分类/关联模块/日期），支持预览（PDF blob URL）与下载。
- 与模块联动标注（如"党费规定"关联党费台账）。

## 8. 仪表盘可定制组件

- 组件注册表：statGrid / reminders / feeRing / heatmap / stageBars / categoryBars / feeTrend / weekOverview。
- 编辑模式：移除/拖拽排序（原生 DnD）+「添加组件」抽屉；配置 `sct-dash-widgets` 按身份持久化；默认布局预设一键还原。

## 9. 一键交接包（设置页）

- 交接数据包：全量 JSON（复用 exportBackup）。
- 交接文档：自动生成可打印 HTML——任期大事记（已完成事项）/ 待办（计划事项+发展下一步+欠缴）/ 台账摘要 / 应用锁重置与数据导入指引；落款"学工工作平台"。

## 10. 质量流程

自检（typecheck/build/冒烟）→ 新 agent 全功能用户测试（功能逻辑+UI）→ 修复 → `@alibaba-group/open-code-review` 审查（npm 全局已装 1.13.9；本地 git 仓库可用性实测，若需远端则以等效人工 code review 顶替并说明）→ 修复 → 新一轮全量回归测试。

## 风险

- schedule-x API 与预期差异 → 开发前先查官方 docs（Vue 用法/插件/事件点击），必要时保留旧实现文件以便快速回退。
- 主题重构波及面大 → 以 --sct-* 变量灰度替换，逐页验证深色。
- 图片打包体积 → 压缩后预计 +5MB，Tauri 本地应用可接受。
