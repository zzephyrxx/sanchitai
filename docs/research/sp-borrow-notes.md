# Super Productivity 借鉴笔记（MIT，可安全借鉴代码模式）

> 调研日期：2026-11-18。源码：`_refs/super-productivity/`（Angular + NgRx，v17+ 架构）。
> 本文档所有引用路径均相对 `_refs/super-productivity/`。SP 为 MIT 协议，**可以借鉴代码结构与算法**（与 classroom-workbench 的非商用许可不同），但三尺台是 Vue3 栈，只搬"概念与算法"，不搬 Angular/NgRx 实现。

## 0. SP 总体画像（v17+，与旧教程差异大）

- 存储已从"单库多 store"演进为 **操作日志（operation log）事件溯源** 架构：IndexedDB 库 `SUP_OPS`，通过 `idb`（npm 包）访问，所有实体变更记为 operation，可回放/同步（vector clock 向量时钟）。
- 规模参考：`src/app/features/` 下 45+ 特性模块；`ARCHITECTURE-DECISIONS.md` 是一份高质量 ADR 索引，**强烈建议实施前通读**（10 条决策，多数直接适用于三尺台）。
- 对三尺台有用的子集：任务数据模型、重复规则引擎、planner/schedule 时间轴、实体状态扁平化、JSON 备份环形缓冲、i18n 中文支持。**同步/加密/向量时钟一律不借**（无账号、单机）。

---

## 1. 任务/项目/标签数据模型

### 1.1 Task：扁平实体 + 互斥日期字段

证据：`src/app/features/tasks/task.model.ts`
- 实体形态：`interface TaskCopy` + `type Task = Readonly<TaskCopy>`，`TaskState extends EntityState<Task>`（NgRx entity：`{ ids: string[], entities: { [id]: Task }, ... }`）。**扁平 id 映射 + id 数组** 是 SP 全仓库统一的实体存法。
- 关键日期字段（ADR #1）：

```ts
dueWithTime?: number | null;   // 有具体时间的日程：Unix 毫秒
dueDay?: string | null;        // 全天日程：'YYYY-MM-DD'（ISO 日期字符串）
// 两者互斥：设置 dueWithTime 必须清空 dueDay；读取时 dueWithTime 优先
deadlineDay?: string | null;   // 截止日（同样互斥对 deadlineWithTime）
```

- 其他值得抄的字段语义：
  - `timeSpentOnDay: { 'YYYY-MM-DD': ms }`（按日拆分的时间统计）
  - `priority?: 1|2|3`（undefined 表示无优先级，排序过滤统一处理）
  - `wontDoOn?: number`（"不做"与"完成"区分，见 task.model.ts 注释：仅当等于 doneOn 且 isDone 时生效）
  - `parentId/subTaskIds`（父子任务）、`repeatCfgId`（引用重复配置）、`tagIds: string[]`
  - `DEFAULT_TASK` 常量给出全字段的"零值模板"

**三尺台落法**：党务"事项/日程"实体直接采用 `dueWithTime/dueDay` 互斥对设计。例如"周三 14:00-16:00 支委会"存 `dueWithTime`；"某日交党费"存 `dueDay`。Dexie 表存扁平记录，`ids` 顺序用单独的排序表或 order 字段。

### 1.2 Project / Tag：工作上下文（WorkContext）

证据：`src/app/features/project/project.model.ts`、`src/app/features/work-context/work-context.model.ts`
- Project 与 Tag 都实现 `WorkContextCommon`（统一接口：taskIds、theme、advancedCfg…），即**"项目"和"标签"都是任务的容器上下文**。
- Project 字段含 `taskIds/backlogTaskIds/noteIds`（容器持有任务顺序）、`isDone/isArchived` 分离（完成≠归档，ADR #5/#7）。

**三尺台落法（project→身份映射）**：SP 的 Project ≈ 三尺台的"身份/工作面"（党支部书记/班长/社团负责人）。每个身份是一个 work-context，持有自己的日程/事项顺序；切换身份=切换上下文过滤器。Tag ≈ 党务标签（"三会一课""发展党员""党费"），同一事项可挂多标签。v1 只做"身份"单层 + 标签，不做 SP 的 backlog/多面板。

### 1.3 虚拟标签 TODAY（ADR #2）

证据：`src/app/features/tag/tag.const.ts` 第 9-28 行
- `TODAY_TAG` 是虚拟标签：成员资格由 `task.dueDay/dueWithTime` 推导，**绝不写进 task.tagIds**；`TODAY_TAG.taskIds` 只存"今天的排序"。
- 好处：移动/排序操作统一（虚拟标签与普通标签走同一 reducer），成员关系自愈（过期 id 自动被过滤）。

**三尺台落法**：台历"今天"列同理——今日事项列表由日期字段推导 + 单独存排序，不要把"今日"做成普通标签。

---

## 2. IndexedDB 存储封装

### 2.1 现状（v17+）：`idb` + 操作日志

证据：`src/app/op-log/persistence/operation-log-store.service.ts`、`db-upgrade.ts`
- 用 npm 包 **`idb`**（Promise 化 IndexedDB 封装，非 Dexie），库名 `SUP_OPS`，常量集中在 `db-keys.const.ts`（`STORE_NAMES/OPS_INDEXES/DB_VERSION`）。
- `db-upgrade.ts` 头部注释是关键经验：**"IndexedDB 每个版本迁移只跑一次 upgrade 回调——最先打开库的服务必须创建全部 store"**，所以 SP 把 upgrade 逻辑抽成共享函数 `runDbUpgrade()`，所有打开该库的服务统一调用。

### 2.2 兼容旧数据的迁移思路

证据：`src/app/core/persistence/legacy-sup-db.service.ts`
- 旧库 `SUP`（v12 KV 式单 store）只读不写，读到旧数据后**转成标准备份格式走统一导入管线**（`migrateLegacyBackup`），而不是为旧格式写专用迁移代码。

**三尺台落法（Vue3 + Dexie 等价实现）**：
- 库版本/schema 定义集中到一个 `db.const.ts`（库名、版本号、表名、索引），**所有 Dexie 实例化点共用一个 `new Dexie()` 工厂**，避免多处 upgrade 冲突——这是 SP `runDbUpgrade` 注释的直接教训。
- 版本演进采用 **加字段优先、不轻易 bump schema**（SP ADR #8 "Additive Data-Model Evolution over Schema Bumps"）：Dexie 索引变更才需要 `db.version(n).upgrade()`，纯加字段不需要。
- 三尺台的 JSON 导入导出可借 SP `legacy-sup-db.service.ts` 的思路：**导入管线与备份格式统一**（任何来源——手动备份/导入文件/旧版本——都转成同一份 `BackupShape` 再入库），导出格式自带 `schemaVersion` 字段。

### 2.3 备份环形缓冲（local-backup）

证据：`src/app/imex/local-backup/backup-ring.util.ts`、`local-backup.service.ts`
- 自动备份按"环"保留最近 N 份（环形缓冲淘汰），导入前先抓一份导入前备份（`import-backup-ring.util.ts`），防导入毁数据。

**三尺台落法**：IndexedDB 里建 `meta` 表存 `{ key: 'backup-<n>', ts, json }` 环形 5 份；每次 JSON 导入前自动快照一次。

---

## 3. Planner / Schedule 概念（时间轴核心）

### 3.1 三层概念模型

| SP 概念 | 含义 | 证据 |
| --- | --- | --- |
| **PlannerDay** | "规划视图"的一天：tasks（待排）+ deadlineTasks + noStartTimeRepeatProjections（无时刻的重复投影）+ allDayEvents + scheduledIItems（已入槽项）+ timeEstimate/timeLimit（当天容量预算） | `src/app/features/planner/planner.model.ts` |
| **ScheduleItem** | 已排入时间轴的项，判别联合：`Task / CalEvent / RepeatProjection`，统一 `{ id, type, start, end }` | 同上 |
| **ScheduleDay / SVE** | "时间轴网格视图"的一天：entries: SVE[]（网格事件），带 `overlap {count,offset}`（重叠布局）、`isBeyondBudget`（超容量）、tray（无时刻任务的"托盘"） | `src/app/features/schedule/schedule.model.ts` |
| **SVEType 枚举** | 任务/全天任务/已排任务/重复投影/跨天拆分(SplitTask…Continued)/日历事件/工作日起止/午休，共 16 类，配 `SCHEDULE_VIEW_TYPE_ORDER` 排序表 | `src/app/features/schedule/schedule.const.ts` |

- **RepeatProjection（重复投影）** 是 SP 的精髓：重复配置本身不生成实体，只在"未来某天"投影出一个虚拟 occurrence，被拖入时间轴/完成后才落成真任务。
- **Tray（托盘）**：`untimedTaskPlacement === 'tray'` 时无时刻任务放在日期列顶部托盘，不占网格；`freeMs` 实时显示当天剩余容量。

**三尺台落法**：台历主视图直接对应 SP 的 ScheduleWeek：一周 7 列网格（24h×5 分钟一行）+ 每日"托盘"（全天/无固定时刻事项）。三尺台的"固定例会"（每周三支委会）= SP 的 RepeatProjection；完成/调整后可固化为实体日程。判别联合 `ScheduleItem {type, start, end}` 的类型设计原样搬进 TS。

### 3.2 网格数学与拖拽

证据：`src/app/features/schedule/schedule.const.ts`（`FH = 12`）、`schedule-utils.ts`、`schedule-week/schedule-week-drag.service.ts`
- 网格行粒度：`FH = 12`，即 **每小时 12 行、每行 5 分钟**，全天 `24 * 12 = 288` 行。
- 指针→时间换算：

```ts
// schedule-utils.ts
const totalRows = 24 * FH;
const rowHeight = gridRect.height / totalRows;
const rowIndex = Math.round(relativeY / rowHeight) + 1;
// → 时间 = rowIndex / FH 小时
```

- 拖拽：Angular CDK DragDrop + 自研 `schedule-week-drag.service.ts`；拖动克隆节点（`DRAG_CLONE_CLASS`）、悬停高亮（`drag-over`）、`calculateTimeFromYPosition()` 实时计算落点、`SCHEDULE_TASK_MIN_DURATION_IN_MS = 10min+1`（最小块高）；触摸端有 dragDelay 与 `isTouchActive` 判定。
- 最小任务块 10 分钟 + 重叠计数布局（`overlap: {count, offset}`）值得照抄算法。

**三尺台落法（Vue3 等价）**：不用 CDK，用原生 pointer events（pointerdown/move/up）+ `@vueuse/core` 的 `useDraggable` 或直接手写（SP 的换算函数是纯函数，可 1:1 移植）；`vue-draggable-plus` 只适合列表排序，时间轴网格建议 pointer 方案。落点吸附到 5 分钟（或 15 分钟）栅格。

---

## 4. 重复（Recurrence）规则设计

### 4.1 配置模型（`TaskRepeatCfg`）

证据：`src/app/features/task-repeat-cfg/task-repeat-cfg.model.ts`（全文关键）
- 周期类型：`repeatCycle: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'` + `repeatEvery: number`（间隔数）。
- 快捷预设：`RepeatQuickSetting`（DAILY / WEEKLY_CURRENT_WEEKDAY / MONTHLY_FIRST_DAY / MONTHLY_LAST_DAY / MONTHLY_NTH_WEEKDAY / MONDAY_TO_FRIDAY / YEARLY_CURRENT_DATE / CUSTOM）——**UI 提供快捷项，底层统一 CUSTOM**。
- 周内哪几天：`monday...sunday?: boolean` 七个布尔（WEEKLY 用）。
- 月度锚点三选一（版本演进的典型范例）：
  - `monthlyWeekOfMonth?: 1|2|3|4|-1` + `monthlyWeekday?: 0-6`（"第 N 个星期X"，-1=最后一个）；两字段齐备即 Nth-weekday 锚点，**"锚点字段存在"本身是判别器，无需额外 mode 字段**
  - `monthlyLastDay?: boolean`（每月最后一天）
  - 都没有则回退 `startDate` 的日号
- 结束条件：`repeatUntilDay?: 'YYYY-MM-DD'`（含当天，unset=永久）。
- 行为开关：`waitForCompletion`（完成才生成下一个，防堆积）、`skipOverdue`（错过的静默跳过）、`repeatFromCompletionDate`（从完成日起算）、`deletedInstanceDates?: string[]`（单次例外删除）、`subTaskTemplates`（子任务模板）、`isPaused`。

### 4.2 求下一次发生（算法）

证据：`src/app/features/task-repeat-cfg/store/get-next-repeat-occurrence.util.ts`
- 纯函数 `getNextRepeatOccurrence(cfg, fromDate, {inclusive})`：先按 `lastTaskCreationDay` 起扫（编辑既有实例时用 inclusive 模式允许落回今天），DAILY/WEEKLY/MONTHLY/YEARLY 分支逐候选日扫描，上限 `365*2` 天防死循环；`isAfterRepeatUntilDay()` 做截止判断；MONTHLY 的 Nth-weekday 由 `get-nth-weekday-of-month.util.ts` 的 `findMonthlyNthWeekdayOccurrence()` 计算。
- 配套：`get-first-repeat-occurrence.util.ts`、`get-task-repeat-cfgs-for-exact-day-cached.util.ts`（按天查询带缓存）、`repeat-cfg-preview` 目录（编辑对话框里预览未来 N 次发生）。

**三尺台落法**：
- 党务场景映射：`WEEKLY + wednesday` → 每周三支委会；`MONTHLY + monthlyWeekOfMonth` → 每月第一周主题党日；`YEARLY + startDate` → 七一活动；`DAILY + MONDAY_TO_FRIDAY` → 值班。SP 的模型几乎无需增删字段。
- 用 Vue3 实现：把 SP 这套 util（纯 TS 函数族，~几百行）**按 MIT 直接翻译成 `src/utils/recurrence/` 纯函数模块**（getNextOccurrence / occurrencesBetween(cfg, from, to)），台历渲染时对每个 repeatCfg 调 `occurrencesBetween(weekStart, weekEnd)` 展开投影；Dexie 存 cfg，`deletedInstanceDates` 存例外。改动点仅是 dayjs 化 SP 自写的日期工具。

---

## 5. i18n（确认含简体中文）

- 证据：`src/assets/i18n/zh.json`（31 个顶层 key：APP/G/GCF/GLOBAL/MH/T/F…）与 `zh-tw.json` 并存——**SP 支持简体中文**。
- 机制：`@ngx-translate/core` + `src/app/core/language/language.service.ts`（浏览器语言探测 `getBrowserCultureLang()`，`isSupported()` 白名单）+ `locale-registration.service.ts`（注册 ISO 文本标签的 locale fallback）+ `t.const.ts`（全量翻译 key 的类型化常量，防 key 拼错）。
- 值得借的是**key 类型化**思路（`T = 'G.tasks'`…全部枚举）——三尺台沿用底座 vue-i18n，可在 `src/typings` 里对 `route.*` 等命名空间做类似约束；底座已有 `App.I18n.I18nKey` 类型，够用。

---

## 6. 借鉴总结：概念→三尺台落法对照表

| SP 概念 | 证据文件 | 三尺台落法（Vue3 + Dexie） |
| --- | --- | --- |
| 实体扁平存储 `{ids, entities}` | tasks/task.model.ts (TaskState) | Dexie 表存记录本体 + 单独 `ordering` 表存顺序（或 order 字段）；内存态用 `computed Map` |
| dueDay/dueWithTime 互斥 | ADR #1，task.model.ts | Schedule 实体直接采用；写时清另一个字段，读时优先 withTime |
| TODAY 虚拟标签 | tag/tag.const.ts | "今天"列表按日期推导，排序单独存 |
| Project=工作上下文 | project.model.ts + work-context.model.ts | 身份（书记/班长/社团）= workContext，切换身份过滤数据 |
| RepeatProjection 投影 | planner.model.ts (ScheduleItemType) | 例会不落实体，渲染期投影；接受/完成后固化 |
| RepeatCfg + 4 周期 + Nth weekday + until + 例外 | task-repeat-cfg.model.ts + store/get-next-repeat-occurrence.util.ts | `src/utils/recurrence/` 纯函数模块，MIT 移植算法 |
| 5 分钟网格 + FH=12 + Y→时间换算 | schedule.const.ts + schedule-utils.ts | 台历周视图网格参数与换算函数直接移植 |
| Tray 托盘 + freeMs 容量 | schedule.model.ts (ScheduleDayTray) | 每日"全天/无时刻事项"托盘；容量=可用时间段，可选实现 |
| overlap 重叠布局 | schedule.model.ts (ScheduleEvent.overlap) | 同时段重叠事件的 count/offset 横向分栏算法 |
| 共享 upgrade 函数 | op-log/persistence/db-upgrade.ts | Dexie 单一 DB 工厂 + 集中 version/upgrade |
| 加法演进 schema（ADR #8） | ARCHITECTURE-DECISIONS.md #8 | 优先加字段；导出 JSON 带 schemaVersion |
| 备份环形缓冲 | imex/local-backup/backup-ring.util.ts | IndexedDB meta 表存最近 5 份自动快照；导入前强制快照 |
| 统一备份格式导入管线 | core/persistence/legacy-sup-db.service.ts | 导入/备份/旧版本数据 → 同一 BackupShape → 入库 |
| 翻译 key 类型化 | t.const.ts | 底座 App.I18n.I18nKey 已覆盖，沿用 |

## 7. 不借鉴清单（明确放弃）

- 操作日志/向量时钟/同步（`src/app/op-log/`、`@sp/sync-core`）——单机无账号，复杂度不成比例。
- 议题集成（GitHub/GitLab/Jira）、日历 OAuth 插件、Electron/Capacitor 桥接、metric/simple-counter/note 等外围特性。
- NgRx 全家桶——用 Pinia setup store + computed 即可达到同等 selectors 语义。
- SP 的 angular-material-css-vars 主题——沿用底座 naive-ui 主题链路。
