# 三尺台 · 实施轮 1 评审报告

- 评审时间：2026-11-19
- 评审人：用户代表（依据 `docs/research/user-requirements.md` 第 6 节验收清单）
- 评审范围：轮 1 交付（品牌改造、去登录化、数据层+种子、台历页、身份切换徽章）
- 评审方法：源码走读（`src/views/calendar/`、`src/store/modules/work-data/`、`src/db/`、`src/utils/recurrence.ts`、`src/router/`、`src/theme/`、`src/service/`）+ 浏览器实测（dev server http://localhost:9527，1280×720）。浏览器引擎的坐标点击（cua）在本环境不可靠（对普通按钮也无效），空白格点击等交互改用页面内合成指针事件序列验证——对真实鼠标用户等效。
- 本轮只评：A1、A2、A6、A19（代码级）+ 设计语言 + 交互体验；A3/A4/A5/A7-A18/A20 留待轮 2/3。

---

## 一、验收条目判定

### A1 冷启动 3 秒渲染 —— 通过

- 实测：`reload` → DOMContentLoaded 0.21s → 首个 `.fc-event` 出现 **1.18s**（40 次 100ms 轮询内命中，共 5 次采样 1 次取值）。周视图默认（timeGridWeek），当周（11/16–11/22）事项立即可见：含单次事件（冒烟残留、主题党日、发展对象谈话）与**重复事件投影**（周五 13:50 微讲堂、20 日"一页纸·时政速览"），投影正确落位。
- 数据来自 Dexie 种子（22 人/27 事项/90 党费/4 谈话/6 模板/3 座位图，与 docs/research 草案一致，已脱敏）。
- 备注：dev server 热启动条件下的数字；生产构建预计持平或更好。轮 2 复评时用 `pnpm build` 产物复测一次。

### A2 空白时段新建 → 周/月视图同日出现 —— 通过

- **点空白时段**：合成 pointerdown/mousedown/pointerup/mouseup/click 序列落在 11/19 上午空白格 → 新建弹层打开，日期预填 `2026-11-19`、时间预填 `09:30–10:30`（对点击时段有 ±30 分钟吸附，可用但不精确，见 P2-12）。
- **保存**：填标题"评审测试事项A2"（默认类别=组织生活）→ 保存 → 周视图立即出现"14:00 评审测试事项A2"（watch calEvents.length → refetchEvents 生效）；切月视图 → `td[data-date="2026-11-19"]` 单元格内出现同一事项。**周/月同日期一致**。
- **详情/回收**：点事项 → 抽屉显示类别/类型/状态/日期/时间/主责协助/备注完整；删除有 Popconfirm（"确认删除该事项？"）→ 确认后周视图即时移除。已完成/取消/恢复计划按钮齐备，重复事项实例有蓝色提示条（编辑作用于整条规则），拖拽对重复实例的拦截带警告文案。
- 交互路径实测全程无报错。

### A6 身份切换器仅党支部书记可用 —— 通过

- 页眉下拉 4 项：党支部书记 / 班长（规划中）/ 社团负责人（规划中）/ 辅导员（规划中）。
- 三个占位项均为真禁用（`n-dropdown-option-body--disabled` + `aria-disabled="true"`）；点击"班长"后：徽章仍为"党支部书记"、`localStorage['sct-active-identity']` 未变、无任何数据切换。
- 见 P2-8（禁用项点击无反馈，store 提示文案是死代码）。

### A19 离线（本轮代码级评估）—— 通过

- 路由 `VITE_AUTH_ROUTE_MODE=static`：`initConstantRoute`/`initAuthRoute`/`getIsAuthRouteExist` 三个分支全部走静态路由，`fetchGetConstantRoutes`/`fetchGetUserRoutes`/`fetchIsRouteExist`（axios）**无调用路径**；auth store 本地假用户（支部书记/R_SUPER，isLogin 恒 true，login 为 no-op）→ `#/login` 访问被守卫重定向回 `#/calendar`（实测）。
- 版本检测 `setupAppVersionNotification`：`VITE_AUTOMATICALLY_DETECT_UPDATE=N`（关闭）且仅 PROD，不构成路径；无 WebSocket/EventSource/SendBeacon；`index.html` 无任何外链（favicon 为内联 SVG 文件）。
- 写路径全部为 Dexie/IndexedDB（`src/db/db.ts`），首启种子导入在 `main.ts` 挂载前完成。
- 遗留：`src/service/api` + `src/service/request`（axios 实例仍会构建）与 `.env.test/.env.prod` 的 mock baseURL 为死代码，见 P2-11。

---

## 二、设计语言检查

| 维度 | 结论 |
| --- | --- |
| 红色克制（≤10%） | **达标**。党建红仅出现在：方印 Logo、选中菜单底色（软粉）、主按钮（新建事项/保存）、组织生活类别、周/月激活态。目测占界面用色 <8%。党务常规灰、发展党员橙、品牌活动暗金、服务实践绿、工作例会蓝、理论学习紫，红未泛化。 |
| 中式简约 | **达标**。无渐变/阴影堆砌/花哨动效；卡片直角圆角小、留白充足；"点空白时段快速新建 · 拖拽可改期"的辅助文案克制实用。 |
| 字标/Logo | **基本达标**。朱红方印 + 白色宋体三字，favicon 同源一致；侧栏字标"三尺台 · 学工工作台"红色衬线体协调。细节见 P2-10（"台"字与内框线交叠）。 |
| 信息密度 | **达标**。周视图 + 右侧"今日/本周/类别图例"三卡，单屏一个重点；侧栏不喧宾。 |

## 三、交互体验检查

| 项 | 结论 |
| --- | --- |
| 3 秒可读本周 | 达标（1.2s，A1）。 |
| 新建是否顺手 | 达标：空白格直点、预填时段、必填仅 2 项（标题/类别）、主责/协助人下拉带身份标注（"陈明远（正式党员 · 书记）"）。 |
| 类别色标易辨识 | 基本达标：7 类中 5 类一眼可分；发展党员橙 #d97706 与品牌活动暗金 #b8860b 在月视图小卡片上近似（P2-6）。 |
| 今日/本周速览有效性 | 有效：今日列表按日正确、本周计数与分类计数正确（实测 5→6 项联动）、点击直达详情。遗留过滤问题见 P2-7。 |
| 其他 | 页面切换（hash/菜单）过渡偏慢（实测 >900ms 仍在旧视图，随后完成），见 P2-4；曾观察到一次双实例渲染叠加（未能复现），见 P2-5。 |

---

## 四、发现清单

### P0（必须修）

无。

### P1（应修）

| # | 发现 | 位置 | 修改建议 |
| --- | --- | --- | --- |
| P1-1 | 身份徽章渲染为**中灰药丸底（实测 computed bg `rgb(107,107,107)`）+ 红字**，红字对灰底对比度约 1.8:1，不可读且与浅色纸感页头冲突；样式扫描未找到对应规则（疑似 UnoCSS `hover:bg-gray-100` 编译产物或全局样式污染），属确定存在的视觉缺陷 | `src/layouts/modules/global-header/components/identity-badge.vue`（button 无显式背景色） | 给按钮显式声明背景（透明或 `#F7E3E4` 软红）；推荐方案：软红底 + #A81C24 文字 + 1px 描边 `rgba(168,28,36,.25)`；或纯文字"身份·党支部书记"灰字+红字组合，去掉底色。修复后在浅色/深色两种主题下各验一次 |
| P1-2 | "今天"列高亮是 FullCalendar 默认**黄底**（`--fc-today-bg-color`），与党建红/纸感 token 体系不符，周视图与月视图均可见 | `src/views/calendar/index.vue`（calendarOptions 未覆盖 FC 主题变量） | 在 global.css 或 calendar scoped style 覆盖 `:root{--fc-today-bg-color: rgba(168,28,36,.06)}`（或纸感加深色 #F1EDE6）；同时核对 `--fc-border-color`/`--fc-page-bg-color` 是否与纸感底统一 |
| P1-3 | **全天/节点事项拖拽改期会变成定时事项**：`handleMove` 中 `end` 为空时按 `start+1h` 处理，并把 `start_time` 写成 `'00:00'`——原来 `start_time=''` 的全天语义被破坏（详情抽屉会显示 00:00-01:00） | `src/views/calendar/index.vue` `handleMove`（79-95 行） | 拖拽前记录原事件 `start_time` 是否为空；为空则只 patch `{ date }`，保留 `start_time/end_time` 为空；定时事项才 patch 时间 |

### P2（建议）

| # | 发现 | 位置 | 修改建议 |
| --- | --- | --- | --- |
| P2-4 | hash/菜单切换页面过渡偏慢：实测切到 `#/calendar` 后 >900ms 旧视图仍在（fade-slide + keep-alive） | `src/theme/settings.ts`（page.animate）+ layouts transition | 缩短动画时长或改 `mode: out-in` 轻量动画；保证"点菜单 ≤300ms 出新视图" |
| P2-5 | 观察到一次**页面双实例渲染**（两张台历卡叠加，上张日历区空白），刷新后消失；未能稳定复现，疑似过渡竞态或 HMR 干扰 | layouts 页面过渡 | 轮 2 复测（冷启动直接切周/月/路由）；建议确认 `<router-view>` 过渡为 `out-in` 并断开 devtools 面板再测 |
| P2-6 | 发展党员 #d97706 与品牌活动 #b8860b 色相过近，月视图小卡片难辨 | `src/constants/sanchitai.ts` | 将品牌活动改为冷色系（如青灰 #5B7A99）或深棕 #8C5A2B，拉开与橙的距离 |
| P2-7 | 今日/本周速览未过滤"已取消/已并入"事项，计数虚高 | `src/store/modules/work-data/index.ts` `eventsInRange` + `index.vue` 速览 computed | 速览侧过滤 `status==='已取消'` 与 `merged_into` 非空项（台历上仍显示但带划线） |
| P2-8 | 占位身份点击无任何反馈：Naive UI 禁用项拦截点击，store 里"规划中，敬请期待"提示为死代码 | `identity-badge.vue` + `src/store/modules/identity/index.ts` | 保留禁用态 + 在下拉项 `desc` 里说明；或改为可点击走 `switchTo()` 弹提示（当前代码已支持） |
| P2-9 | 演示库含开发期残留"冒烟测试事项（周四下午）"，影响演示纯净度；`resetToSeed()` 无 UI 入口 | IndexedDB 现场数据 + `src/db/seed.ts` | 清库重发种子；在设置/关于页加"重置演示数据"按钮（代码已备好） |
| P2-10 | 方印 Logo"台"字基线 y=470 越过内框线（y=460），笔画与描边轻微交叠 | `src/components/common/system-logo.vue`、`public/favicon.svg` | 三字整体上移 8–10px 或字号 132→124 |
| P2-11 | 网络层死代码：`src/service/api`+`src/service/request`（axios 实例仍构建）、`.env.test/.env.prod` mock baseURL、演示登录页 | `src/service/`、`.env*` | v1 内移除或加显著 TODO 注释"纯离线应用，禁止接入"，防止后续误用（A19 唯一隐患面） |
| P2-12 | 新建弹窗预填时段吸附有 ±30 分钟偏差（点 10:00 格得到 09:30 起）；编辑弹窗暂无重复规则字段 | `src/views/calendar/index.vue` `openCreate`（15 分钟吸附+槽位换算）；`event-edit-modal.vue` | 对齐 FullCalendar 实际命中时段（用 `info.date` 即可）；重复规则字段随轮 2 A3 学期排期一并实现 |

---

## 五、结论

**修后通过。**

- 验收条目 A1、A2、A6 实测通过，A19 代码级通过（离线承诺成立）；品牌/纸感/信息密度方向正确，红色克制达标。
- 无 P0。3 项 P1（徽章对比度、今日黄色高亮、全天事项拖拽语义）均为小改动，建议在轮 2 开工前修完并在此清单上逐项销号；P2 中 P2-9（演示库残留）优先处理，避免影响后续轮次演示。
- 轮 2 复评入口：A3（学期排期）、A4（并入计数）、A5（主责协助展示）、A7-A9（人员可视化）+ P2-5 双实例复测。
