# 三尺台技术调研执行摘要

> 调研日期：2026-11-18。六份调研产物：
> ① `base-analysis.md`（底座）② `sp-borrow-notes.md`（Super Productivity 借鉴）③ `seatmap-port-plan.md`（座位图移植）④ `domain-party-knowledge.md`（党务口径）⑤ `dependency-plan.md`（依赖清单 + Tauri v2 备忘）。

## 一、各文档要点

### 1. base-analysis.md（底座 soybean-admin v2.3.0）
1. 底座比预期干净：演示页已裁剪（仅剩 home + _builtin），路由是 elegant-router 约定式自动生成（`src/views/` 建目录即出路由/菜单），菜单文案只需补 locales。
2. 主题换党建红只需改 `src/theme/settings.ts` 一处 `themeColor: '#A81C24'` + 校准 otherColor；`@sa/color` 自动生成 50-950 色阶并写 CSS 变量，暗色模式（light/dark/auto + html.dark）已内置。
3. v1 去登录化改动集中在 5 处：`router/guard`（删 token 拦截）、`store/modules/auth`（本地假用户 roles=['R_SUPER']）、`views/_builtin/login`（删）、`service/`（删请求层）、`.env`（关更新检测/代理）；tab/全局搜索/多语言可用 theme settings 配置关闭。
4. 启动命令 `pnpm dev`（端口 9527），`sa`/`vp` CLI 均随 workspace 自动可用；本机 node 26.13.0 / pnpm 12.21.0 满足 engines；node_modules 尚未安装，首次需 `pnpm install`。
5. 可直接复用：dayjs、echarts 6.1.0、@vueuse/core、vue-draggable-plus、@sa/utils 的 localforage（IndexedDB）封装；建议路由改 hash 模式以支持"双击即用"的离线形态。

### 2. sp-borrow-notes.md（Super Productivity，MIT）
1. SP v17+ 是"操作日志事件溯源 + idb"架构，同步/向量时钟整套放弃；可借的是实体扁平存储（{ids,entities}）、共享 DB upgrade 函数、加法演进 schema（ADR #8）、备份环形缓冲。
2. 任务日期字段 `dueDay/dueWithTime` 互斥设计（ADR #1）与"今天=虚拟标签"模式直接适用于三尺台日程实体。
3. 重复规则模型（4 周期 × 间隔 × 周内日 × 月度 Nth-weekday/最后一天 × repeatUntil × 例外日期 × skipOverdue）几乎是为党务例会量身定做；`getNextRepeatOccurrence` 纯函数族可按 MIT 移植为 `src/utils/recurrence/`。
4. Planner/Schedule 概念（PlannerDay 容量预算、ScheduleItem 判别联合、RepeatProjection 投影、托盘、5 分钟网格 FH=12、Y→时间换算）= 台历周视图的完整蓝本。
5. `zh.json` 确认 SP 支持简体中文；key 类型化思路沿用底座 `App.I18n.I18nKey`。

### 3. seatmap-port-plan.md（classroom-workbench 移植）
1. 原作双视图模式：SVG 场景（日常打卡）+ CSS Grid 编排视图，共享一个 `人员→'行-列'` 坐标映射——三尺台对应"布置图 + 编排视图"双形态。
2. 交互模式已拆解：5px 阈值区分点击/拖拽、幽灵头像 + elementFromPoint 落点高亮、点两座互换兜底、出勤四态循环（出勤→请假→缺勤→迟到）、单级 undo 快照、罚分函数 + 随机重启局部搜索的智能排座。
3. 三尺台改造：布区多态（办公工位/宿舍/党小组）、角色徽标取代性别、"同桌规则"改"党小组聚拢约束"、签到与台历活动联动；组件不落库，全部 emit 给 Pinia store。
4. 状态色方案：红只用于缺勤警示与书记徽标（关键色语义），请假 amber 淡化 0.55，绿=在位，蓝=迟到。
5. 许可红线：原作非商用许可，只取交互/信息设计模式，实现为原创 Vue3 代码。

### 4. domain-party-knowledge.md（党务口径，全部带权威来源 URL）
1. 三会一课频次逐条核实（条例第 11/12/13/16 条）：大会季度≥1、支委会月 1、党小组会月 1、党课季度≥1、主题党日月固定 1 天。
2. 发展党员五阶段 25 步清单完成（含每步材料名与硬时限：考察≥1 年、预备期 1 年、审批≤3 个月、谈话≤1 个月、培训≥3 天/24 学时），可直接建模为 DevNode。
3. 党费：学生党员每月 0.2 元（中组发〔2008〕3 号第六条）核实无误，在职比例 0.5%-2% 四档一并收录。
4. 组织生活会每年≥1 且一般 Q4、民主评议年度 1 次（可合并）、谈心谈话每年≥1 次——构成年度硬日程模板。
5. 交付了 12 个月支部大事时间轴（七一/国庆/两会/毕业季/新生季/民主评议…）供台历示例数据。

### 5. dependency-plan.md（依赖 + Tauri）
1. FullCalendar **整组锁 ~6.1.22**（MIT）：v7 的 vue3 包已出但 daygrid/timegrid/interaction 仍是 6.1.22，混 major 会崩。
2. vue-echarts 必须 8.x（8.x 才 peer echarts ^6，底座 echarts 6.1.0 ✓）；dexie 4.4.7 无 peer；file-saver+@types；vite-plugin-pwa 2.0.0 支持 vite ^8 且 workbox peer 自动补装。
3. pnpm add 命令清单已可直接执行；peer 冲突检查结论：无硬冲突。
4. Tauri v2：本机 Rust 1.99.1 ≥ 最新 Tauri 2 MSRV 1.90.0，兼容；tauri.conf.json v2 结构要点（devUrl 指 9527、identifier 反向域名、frontendDist）与 Win/Mac 打包差异、双形态共存方案已记录。
5. 浏览器/Tauri 数据不互通（不同 origin 的 IndexedDB）——备份导入导出是唯一迁移通道，功能优先级应提升。

## 二、实施阶段 Top 10 建议

1. **先立数据层骨架**：`src/db/` 建 Dexie 单工厂（表：members/zones/placements/schedule/repeatCfg/devNodes/feeLedger/attendance/meta），schema 常量集中一处，版本演进走加法演进（ADR #8），导出 JSON 带 schemaVersion。
2. **去登录化按 base-analysis 清单五处改**，auth store 换本地假用户（roles 含 R_SUPER 即自动绕过角色过滤），守卫删 token 分支——半天工作量。
3. **日程实体用 SP 的 dueDay/dueWithTime 互斥对 + 判别联合 ScheduleItem**；recurrence 引擎按 MIT 移植 SP 纯函数族（ occurrenceBetween + Nth-weekday + until + 例外），配单测覆盖党务场景（周三支委会/月度党日/七一）。
4. **台历主视图先做 FullCalendar timegrid 周视图**（锁定 ~6.1.22），repeatCfg 以投影方式进 events；自定义"中式简约"样式覆盖其默认皮肤，党建红只落在"今天/选中/关键事项"。
5. **主题改造一步到位**：settings.ts 换 #A81C24 + tokens.light 暖白纸感 + info 不随主色；生成一份 `preset/zhongshi.json` 预设。
6. **路由改 hash 模式**（`.env` `VITE_ROUTER_HISTORY_MODE=hash`），保证离线 file:///PWA/桌面三形态一致。
7. **PWA 尽早开启**（vite-plugin-pwa + generateSW），离线图标靠底座已有的 @iconify/json 本地机制；把 VITE_AUTOMATICALLY_DETECT_UPDATE 改 N。
8. **人员布置图分三期**（见 seatmap-port-plan 第 3 节）：先点选互换+统计条，再拖拽+undo+打印，最后智能布点；全程组件 emit / store 落库。
9. **发展党员跟踪器直接落地 domain 文档的 25 节点清单**（DevNode 表），三个硬时限（考察 1 年/预备期 1 年/审批 90 天）接台历倒计时提醒。
10. **JSON 备份导入导出做成第一等功能**（dexie-export-import + file-saver + 导入前自动快照环形缓冲），它是浏览器与 Tauri 双形态的数据迁移通道，也是唯一"防丢"手段。

## 三、风险清单

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 1 | FullCalendar v7/v6 混装（vue3@7 已 latest、插件还 6.x） | 构建崩/视图缺失 | 整组 `~6.1.22` 锁版本；升级 v7 等插件齐发 |
| 2 | classroom-workbench 非商用许可 | 法律风险 | 零代码照搬（文档仅模式级描述）；实现原创；交付前 diff 自查 |
| 3 | vite-plus（voidzero 新栈）生态年轻，部分插件（如 PWA）对 vite 8 兼容面未知 | PWA 插件异常 | vite-plugin-pwa 2.0 已声明支持 ^8；异常时降级方案：手写 manifest + SW precache（产物静态、成本低） |
| 4 | `pnpm install` 触发 prepare（vp config）与 catalog 的 typescript-native-bridge 远端拉取 | 离线环境装不了依赖 | 提前在有网机器装一次并缓存 store；CI 用镜像 |
| 5 | elegant-router 生成物（router/elegant/*）可能被手改后被工具覆盖 | 路由丢失 | meta 定制走 build/plugins/router.ts 的 onRouteMetaGen 或 customRoutes，不改生成文件 |
| 6 | 党务口径有校际差异（评议时点、公示天数、党费细则） | 数据默认值不符 | 频次/时限全部可配置，中央口径仅作默认；文档已标注"惯例"项 |
| 7 | 浏览器存储被用户清缓存清掉 | 数据丢失 | PWA persistent storage 请求 + 备份提醒（首启/每周提示导出 JSON） |
| 8 | macOS 未签名包被 Gatekeeper 拦截 | 桌面版分发困难 | 后续申请 Apple Developer 签名+公证；早期用户走 `右键打开` 引导 |
| 9 | 底座 vue-router 5/pinia 4 较新，社区资料少 | 排错成本 | 以底座内现有用法为模板（home 页、theme store），不引入与版本不符的教程写法 |
| 10 | SP 代码按 MIT 移植未保留版权声明 | 合规瑕疵 | 移植文件头注明 "Recurrence logic ported from Super Productivity (MIT), (c) johannesjo" 并附 LICENSE 引用 |
