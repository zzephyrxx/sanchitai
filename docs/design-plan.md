# 三尺台 · 设计规划 v1（综合设计文档）

> 2026-11-18。综合四份调研产出（base-analysis / sp-borrow-notes / seatmap-port-plan / domain-party-knowledge + user-requirements / case-data-plan / dependency-plan）形成，是三轮实施的执行蓝本。
> 验收基准：`docs/research/user-requirements.md` 第 6 节验收清单 A1-A20。

---

## 1. 信息架构（IA）

```
三尺台（浏览器打开即用，离线）
├─ 顶部栏：字标（候选C横排·小章）｜当前身份徽章（党支部书记·红）｜主题设置
├─ 侧边栏（浅色窄栏）
│   ├─ 台历        /calendar          ← 默认首页（周视图，可切月视图）
│   ├─ 人员        /members           ← 座位图 + 列表 双视图
│   ├─ 三会一课    /meetings          ← 排期规则 + 会议列表 + 纪要
│   ├─ 发展台账    /development       ← 五阶段泳道 + 个人时间线
│   ├─ 党费台账    /fees              ← 人×月矩阵 + 月度收缴
│   ├─ 谈心谈话    /talks             ← 覆盖矩阵 + 记录本
│   ├─ 材料库      /docs              ← 模板区 + 归档区
│   └─ 统计与设置  /dashboard, /settings
└─ 底部：版本与致谢（借鉴致谢 classroom-workbench / super-productivity）
```

- **身份切换**：顶部徽章点开 → 身份列表。v1 仅「党支部书记」可用，其余（班长/社团负责人/辅导员）显示「规划中」。切换后菜单与数据按 identity 过滤（数据行带 `identity` 字段，默认 `secretary`）。铁律：身份间不打通、不合并展示。
- **路由**：elegant-router 约定式（`src/views/<模块>/index.vue` 自动生成），改 `VITE_ROUTER_HISTORY_MODE=hash` 以支持离线/任意托管/Tauri。

## 2. 数据模型（Dexie，库 `sanchitai-db` v1）

统一约定：主键自增或业务 id；`identity` 字段随行存储；导出 JSON 带 `schemaVersion`。借鉴 SP：`dueWithTime/dueDay` 互斥语义、重复规则投影不落实体、备份环形缓冲 5 份、加法演进 schema。

```ts
// src/db/schema.ts
member        { id, code, name, type: 正式党员|预备党员|发展对象|积极分子|申请人,
                role: 书记|副书记|组织委员|宣传委员|纪检委员|党员,
                group, grade, level, major, advisor, join_date?, full_date?,
                seat?: {map_id,x,y}, phone?, note?, identity }
seat_map      { map_id, name, grid: {cols,rows}, identity }
cal_event     { id, title, date: 'YYYY-MM-DD', start_time?, end_time?, location?,
                category: 组织生活|党务常规|发展党员|品牌活动|服务实践|工作例会|理论学习,
                kind?: 支委会|党员大会|党小组会|党课|主题党日|组织生活会|民主评议|…,
                owner?, helper?, agenda?: string[], recurrence?: {freq, by, range}|null,
                status: 计划|已完成|已取消, merged_into?: id, note?, identity }
attendance    { id, event_id, member_id, status: 到会|请假|未到会|迟到, identity }   // R2
dev_stage     { member_id, stage, stage_date, next_node?, next_due?,
                materials?: [{no,name,status,date}], timeline?: [{node,date,note}], identity }
fee_record    { id, member_id, year_month, amount, status: 已缴|欠缴|减免|未在校,
                paid_date?, note?, identity }
talk          { id, date, location?, type: 日常谈话|思想动态|发展节点|转正征求意见,
                member_ids[], initiator?, recorder?, content, follow_up?, event_id?, identity }
doc_template  { id, name, category, placeholders[], body, identity }
doc           { id, template_id?, event_id?, member_id?, title, body, created_at, identity }
meta          { key, value }   // 种子导入标记、备份环形缓冲 backup-0..4、学期参数
```

种子数据：`docs/research/seed-data-draft.json`（22 人 / 27 事项 / 22 发展阶段 / 90 党费 / 4 谈话 / 6 模板 / 3 座位图）随构建打包，首次启动无数据时自动导入（meta 标记，导入前自动快照）。

## 3. 关键技术决策（照抄不误）

| 决策 | 内容 | 出处 |
| --- | --- | --- |
| 存储引擎 | Dexie 4（liveQuery 驱动视图）+ pinia setup store 包装 | sp-borrow-notes §2、dependency-plan |
| 去登录化 | 本地假用户（roles=['R_SUPER']）+ 守卫删 token 分支 + 删 login/service 层 | base-analysis §3 #1-#5 |
| 台历引擎 | FullCalendar 6.1.22 整组（timeGridWeek 默认 + dayGridMonth），interaction 拖拽 | dependency-plan 红线 |
| 重复规则 | 移植 SP recurrence 算法为纯函数 `src/utils/recurrence/`（MIT），渲染期投影 | sp-borrow-notes §4 |
| 人员可视化 | RosterBoard 系列组件原创实现：CSS Grid + pointer 三段式拖拽 + 5px 阈值二分点击/拖拽 + undo 快照 | seatmap-port-plan §2 |
| 备份 | IndexedDB meta 表环形 5 份自动快照；导出 BackupShape { schemaVersion, …tables }；导入前强制快照 | sp-borrow-notes §2.3 |
| 路由模式 | hash（file:// / PWA / Tauri 三态通吃） | base-analysis 坑#6 |
| 离线图标 | 沿用 @iconify/json 本地全集 | base-analysis §4.3 |
| Tauri | 后置：tauri.conf v2 按 dependency-plan §4 模板，identifier `cn.sanchitai.app`，devUrl 9527 | dependency-plan §4 |

## 4. 视觉规范

- **主色** 党建红 `#A81C24`（themeColor 一处改全局）；`isInfoFollowPrimary: false`，info 用中性蓝 `#2080f0`；error `#d43030`（与主色拉开）；success `#52c41a`、warning `#faad14`。
- **浅色纸感**：layout 底 `rgb(250,248,244)`，容器纯白，墨字 `rgb(43,43,43)`；投影减弱。
- **红色克制**：红 ≤ 界面用色 10%——只给「今日/预警/书记徽标/关键按钮」；类别色标用低饱和色系。
- **布局开关**：tab.visible=false、multilingual=false、globalSearch=false（R3 可再开）、面包屑保留。
- **品牌**：应用图标/侧栏 Logo = 候选 A 朱红方印（白文三尺台）；页眉字标 = 候选 C 横排（Songti 900 + 学工小章）；标题气质字 Songti SC，正文 PingFang SC/system-ui。文件见 `docs/brand/`。
- **类别色标（台历/台账）**：组织生活=#A81C24（唯一红）、党务常规=#64748b、发展党员=#d97706、品牌活动=#b8860b、服务实践=#3f9d63、工作例会=#2080f0、理论学习=#7c5cd6。

## 5. 三轮实施路线（验收项映射）

**轮1 · 骨架与台历**（对应 A1/A2/A6/A9 部分/A19）
1. 品牌：名称/图标/字标/标题，主题换红 + 纸感 tokens + 布局开关
2. 去登录化 + hash 路由 + 删演示页；VITE_AUTOMATICALLY_DETECT_UPDATE=N、HTTP_PROXY=N
3. Dexie 层 + 种子导入 + liveQuery store
4. 台历页：周/月切换、事件 CRUD（点空白快速新建弹层、详情抽屉编辑/删除/完成）、类别色标、今日高亮、周/月同数据（A1/A2）
5. 身份切换徽章（A6）：党支部书记可用，其余占位
6. 台历侧挂「今日/本周速览」条

**轮2 · 党支部书记场景全量**（A3-A5、A7-A17）
1. 三会一课：学期排期生成（按条例频次预览→确认写入，A3/A10 幂等）、会议详情（议程+参会勾选+自动到会率 A11）、并入党员大会合并计数（A4/A5）
2. 人员：座位图（RosterBoard：拖拽/点选互换、undo、统计条、角标）+ 列表 + 人员卡（6 项信息 A8）、多布区（A7）
3. 发展台账：五阶段泳道 + 节点时间线（27 项材料编号库）+ 下一步卡片（A13/A14）+ 预备期满自动生成转正大会候选（A12）
4. 党费：本月名单生成 + 人×月矩阵 + 欠缴角标联动（A15/A16）
5. 谈心谈话：覆盖矩阵 + 三步录入（A17）
6. 材料库：6 模板 + 从模板新建 + 占位符替换（A18 主体）

**轮3 · 打磨与交付**（A18 收口/A20 + 广度池精选）
1. 统计总览（vue-echarts：阶段分布/缴费率/会议完成率/年度热力）
2. 一键备份/恢复（环形快照 + BackupShape 导入导出，A20）
3. PWA（vite-plugin-pwa，断网全功能 A19 收口）+ Tauri v2 配置落地（不打包出二进制也至少 init 完整配置）
4. 打印套件（签到表/座次表）＋导出对齐学院报表格式（A16）
5. 全量 A1-A20 自测清单跑查 + 评审修复

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| FullCalendar v6 在 Vue3 的 SSR/样式坑 | 纯 CSR 无 SSR；CSS 入口统一引入；锁 ~6.1.22 |
| elegant-router 生成物与手改冲突 | 路由 meta 尽量走 onRouteMetaGen / customRoutes，不直接改生成物 |
| 删 service 层引发类型断链 | auth store 一次性重写，typecheck 把关（pnpm typecheck） |
| 种子数据结构与迭代中模型漂移 | 以 design-plan §2 为准，种子导入层做字段映射与兜底 |
| 红色滥用破坏"简约" | 视觉规范 §4 红色配额约束；评审轮专查 |

## 7. 明确不做（v1）

协同/云同步/推送、学院审批流线上化、积分自动计分、其余身份真实功能、对外平台发布。
