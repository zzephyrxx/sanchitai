# 底座分析：soybean-admin v2.3.0（三尺台技术底座）

> 调研日期：2026-11-18。本阶段只读不改底座代码，本文档为实施阶段的"改哪里"地图。
> 所有路径均相对仓库根目录 `./`。

## 0. 底座版本画像

| 项目 | 实际值（读自 package.json） |
| --- | --- |
| 版本 | soybean-admin **2.3.0**（MIT） |
| 核心 | vue **3.5.43** / vue-router **5.4.0** / pinia **4.0.3** / naive-ui **2.45.3** / vue-i18n **11.4.13** |
| 构建 | **vite-plus**（catalog，`vp` 命令行）+ `@elegant-router/vue` **0.3.8** + unocss 66.10.5 + sass + unplugin-icons/unplugin-vue-components |
| 引擎要求 | `node >= 20.19.0`，`pnpm >= 10.5.0`；`packageManager: pnpm@12.10.1` |
| 本机环境 | node **26.13.0** / pnpm **12.21.0**（满足要求，实测可用） |
| workspace | pnpm monorepo：`packages/*` 共 8 个子包（axios、alova、color、hooks、materials、scripts、uno-preset、utils） |

**重要观察**：当前仓库的 `src/views/` 只剩 `home` 与 `_builtin`（403/404/500/iframe-page/login），soybean 官方的 about/manage 等演示页**已被裁剪**，v1 清理负担比原版小很多。但登录/鉴权/请求层/多标签等框架能力仍在。

---

## 1. 新增页面/模块的扩展点

### 1.1 路由：elegant-router 约定式自动生成

- 核心机制：`build/plugins/router.ts` 中 `setupElegantRouter()`（`@elegant-router/vue/vite`）。**在 `src/views/` 下新建目录/文件即可自动生成路由**，Vite dev server 会 watch 并重写三个生成文件：
  - `src/router/elegant/routes.ts`（路由定义数组，含 meta）
  - `src/router/elegant/imports.ts`（视图组件懒加载 import）
  - `src/router/elegant/transform.ts`（路由名↔路径工具）
- 手动触发：`pnpm gen-route`（实际执行 `pnpm sa gen-route`，命令实现在 `packages/scripts/src/commands/router.ts`）。开发时通常不需要，dev server 自动生成；CI/改完 views 后跑一次可保证生成物最新。
- 布局映射：目录首层决定 layout——`layout.base`（后台框架布局）或 `layout.blank`（空白），定义在 `build/plugins/router.ts` 的 `layouts` 字段：
  - `base: 'src/layouts/base-layout/index.vue'`
  - `blank: 'src/layouts/blank-layout/index.vue'`
- `onRouteMetaGen`（同一文件）自动为每个路由生成 `title`、`i18nKey: 'route.<name>'`；`login/403/404/500` 自动标记 `constant: true`（免登录常量路由）。
- 自定义路由：`src/router/routes/index.ts` 顶部 `customRoutes` 数组（当前为空数组），适合"参数路由/嵌套特殊路径"。
- 内置常量路由：`src/router/routes/builtin.ts`（`root` 重定向到 `VITE_ROUTE_HOME`，`not-found`）。
- 路由模式：`.env` 中 `VITE_AUTH_ROUTE_MODE=static`（静态路由），`VITE_ROUTE_HOME=home`。三尺台保持 static 即可，dynamic 模式（后端下发菜单）完全不用管。

### 1.2 菜单：从路由 meta 自动派生

- 菜单**不需要单独配置**：`src/store/modules/route/index.ts` 的 `getGlobalMenus()` → `shared.ts` 的 `getGlobalMenusByAuthRoutes()` 把 authRoutes 转成侧边菜单。
- 控制项写在路由 meta 上（elegant-router 生成或手动在 `routes.ts` 改）：
  - `meta.title` / `meta.i18nKey` → 菜单文案（需在 `src/locales/langs/zh-cn.ts` 的 `route` 段补 key）
  - `meta.icon` → 菜单图标（iconify 名称，如 `mdi:monitor-dashboard`）
  - `meta.order` → 排序（`sortRoutesByOrder`）
  - `meta.hideInMenu` → 隐藏
  - `meta.constant` → 免登录
  - `meta.keepAlive` → 页面缓存（配合 `meta.cache`）
- 多级目录：`src/views/` 里嵌套目录自动成二级菜单；若某目录不想生成"父级页面"，可放一个空的 `index.vue`（或用 elegant-router 的路由目录约定，见官方 README）。

### 1.3 视图文件放哪 + 典型页面接线五步

视图根：`src/views/<模块名>/index.vue`（子页面 `<模块>/<子页>.vue）。

**典型接线步骤（以新增"台历"页为例）**：
1. 建 `src/views/calendar/index.vue`（dev server 自动生成路由 `name: calendar, path: /calendar, layout.base`）。
2. 若需手动刷新生成物：`pnpm gen-route`。
3. 在 `src/locales/langs/zh-cn.ts`（及 en-us.ts）的 `route` 对象里补 `calendar: '台历'`，否则菜单显示 key。
4. 想改菜单图标/排序：在 `src/router/elegant/routes.ts` 给 `calendar` 的 meta 加 `icon: 'xxx', order: 1`（生成文件可被覆盖配置影响，稳妥做法是用 `customRoutes` 或接受默认后修改生成物——注意生成物可能被工具重写，**推荐在页面所在目录加 `meta` 无法直接改时用 customRoutes**）。
   - 更稳的做法：elegant-router 支持视图文件旁的 meta 自定义（`definePage` 或配置 `onRouteMetaGen` 按路由名注入），按当前底座最简单的是改 `build/plugins/router.ts` 的 `onRouteMetaGen` 按 key 注入 icon/order。
5. 页面内组件放 `src/views/calendar/modules/*.vue`（参照现有 `views/home/modules/` 的组织方式）；跨页面复用组件放 `src/components/`（common/custom/advanced 三档）。

> 状态管理：pinia setup store，放 `src/store/modules/<name>/index.ts`，store id 枚举在 `src/enum/index.ts` 的 `SetupStoreId`（Auth/Route/Tab/Theme/App 已占用，新增 `Calendar = 20` 之类追加）。pinia 插件 `src/store/plugins/index.ts` 提供 `$reset` 支持（setup store 默认无 $reset，底座已补）。

### 1.4 一个页面的完整数据流（现状）

```
src/views/**  ←  elegant-router 生成路由/菜单  ←  route store（initStaticAuthRoute）
     ↑                                                ↑
pinia store  ←  service/api（axios 封装）  ←  远端 apifox mock（v1 要替换为本地 IndexedDB）
```

---

## 2. 主题定制点（改为党建红 #A81C24、浅色为主简约风）

### 2.1 主色：一处即可全局生效

**文件：`src/theme/settings.ts`**（第 7 行附近）
- `themeColor: '#646cff'` → `'#A81C24'`
- `otherColor`: 建议同步校准四色（`info #2080f0 / success #52c41a / warning #faad14 / error #f5222d`），红做主色后 `error` 需与主色拉开（可保留 #f5222d，或换偏橙红）；`isInfoFollowPrimary: true` 时 info 会跟随主色，**建议改为 false** 并给 info 一个中性蓝，避免大面积红。
- `themeRadius: 6`：中式简约可降到 4~6 保持克制。

机制说明（为什么只改这一处就行）：
- `src/store/modules/theme/index.ts` 的 `themeColors` computed 把 `themeColor` 作为 primary 传给 naive-ui；`shared.ts` 的 `getNaiveTheme()` 用 `@sa/color` 的 `getColorPalette()` 自动生成 50~950 色阶并写入 naive GlobalThemeOverrides（hover=500、pressed=700、active=alpha 0.1）。
- 同时 `createThemePaletteColors()` 生成 CSS 变量 `--primary-color`、`--primary-50..950-color`（见 `src/theme/vars.ts`），业务代码可用 `rgb(var(--primary-color))` / UnoCSS 主题 token 直接引用。
- 结论：**改 settings.ts 一处 + 校准 otherColor，按钮/菜单高亮/进度条/链接全链路换色**，无需手写色阶。

### 2.2 "浅色为主"的底色/排版

同文件 `themeSettings.tokens.light.colors`：
- `container: 'rgb(255,255,255)'`（卡片底）→ 保持白
- `layout: 'rgb(247,250,252)'`（页面底）→ 可换暖白纸感，如 `rgb(250,248,244)`（宣纸感）或保持
- `inverted: 'rgb(0,20,40)'`（深色反差区，如侧边栏反色）→ 可换 `rgb(26,26,28)` 墨色
- `base-text: 'rgb(31,31,31)'` → 可换 `rgb(43,43,43)` 墨字
- boxShadow 三项（header/sider/tab）可减弱投影做扁平简约。

### 2.3 主题预设 JSON（次要）

`src/theme/preset/{default,azir,compact,dark}.json`：由 `src/layouts/modules/theme-drawer/modules/preset/modules/theme-preset.vue` 用 `import.meta.glob('@/theme/preset/*.json')` 加载，仅作为"主题抽屉"里可一键套用的预设。若保留主题抽屉，应把 4 个 json 的 `themeColor` 同步改为 #A81C24（或删掉 azir/dark 预设只留 default）。

### 2.4 暗色模式如何处理（已内置，无需自研）

- 数据源：`themeSettings.themeScheme: 'light' | 'dark' | 'auto'`；`auto` 跟随系统（`usePreferredColorScheme`）。
- 切换链路：theme store `darkMode` computed → `toggleCssDarkMode()` 给 `<html>` 加 `DARK_CLASS`（`src/constants/app.ts`）→ `addThemeVarsToGlobal()` 把 `tokens.dark` 写进 `html.dark` 作用域 CSS 变量 → `App.vue` 的 `NConfigProvider` 切 naive-ui `darkTheme`。
- 三尺台建议：v1 锁 light（把主题抽屉里暗色切换入口隐藏或 `themeScheme` 固定 `'light'`），但保留 dark tokens 兼容定义，未来打开只改配置。红色 #A81C24 在暗色下建议提供加亮变体（如 #C8343D）写进 `tokens.dark`（可新增自定义 token）。
- 另有灰度/色弱模式（`grayscale`、`colourWeakness`）与水印（`watermark`，默认关），v1 不动。

---

## 3. v1 无登录单机离线：需删除/绕过清单

| # | 项 | 位置 | 现状 | 建议处理 |
| --- | --- | --- | --- | --- |
| 1 | 登录守卫 | `src/router/guard/route.ts` | `beforeEach` 里 `localStg.get('token')` 不存在就跳 `/login`（`initRoute` 与主守卫两处拦截） | **最小侵入方案**：守卫放行——`needLogin` 永远 false 或直接删除 token 判断分支；保留 `initConstantRoute` 逻辑 |
| 2 | 登录页 | `src/views/_builtin/login/`（路由 `login`，constant） | 账密/验证码/注册等模块 | 删除目录 + 删 `elegant/routes.ts` 中 login 项（重新 gen-route 后自然消失）+ 守卫中 login 相关跳转删除 |
| 3 | auth store | `src/store/modules/auth/` | login/getUserInfo/roles/token | 改为"本地假用户"：`userInfo = { userId: 'local', userName: '支部书记', roles: ['R_SUPER'] }`，无 token。`isStaticSuper` 依赖 roles 含 `VITE_STATIC_SUPER_ROLE`，**保持 roles=['R_SUPER'] 可让 static 模式跳过角色过滤**（`route store` 的 `initStaticAuthRoute` 直接放行全部路由） |
| 4 | 请求层 | `src/service/`（api+request）、`packages/axios`、`.env*` 里 `VITE_SERVICE_BASE_URL=https://mock.apifox.cn/...` | axios 封装、token 过期/登出 code 处理、apifox mock 地址 | v1 数据全部本地（IndexedDB），**整目录可删**或保留空壳。`route store` 在 static 模式下只有 dynamic 分支才调 `fetchGetUserRoutes`，static 分支不触网；`auth store.getUserInfo` 是唯一启动期触网点，删掉后即完全无网络依赖 |
| 5 | 权限路由/角色过滤 | `route store initStaticAuthRoute` → `filterAuthRoutesByRoles` | 依赖 userInfo.roles | 用 #3 的本地假用户（R_SUPER）**即自动绕过，无需改代码** |
| 6 | 多标签页 tab | `src/store/modules/tab/` + `layouts/modules/global-tab` | chrome 式多标签 | 保留框架但可关：`src/theme/settings.ts` → `tab.visible: false`（无需删代码）；个人工作台单页切换更简洁 |
| 7 | 全局搜索/多语言/面包屑 | `layouts/modules/global-search`、header 的 `multilingual` | header 组件 | `themeSettings.header.multilingual.visible: false`、`globalSearch.visible: false` 按需关闭；面包屑单级场景可关 |
| 8 | 版本更新提示 | `src/plugins/app.ts` `setupAppVersionNotification()` | 每 3 分钟 fetch `buildTime.html`（仅 PROD 生效） | `.env` 已有开关：`VITE_AUTOMATICALLY_DETECT_UPDATE=N`（离线包必改） |
| 9 | mock/apifox 依赖 | `.env.test` / `.env.prod` 的 `VITE_SERVICE_BASE_URL`、请求头 `apifoxToken`（`src/service/request/index.ts` 硬编码） | 指向外部 mock | 随 #4 一并移除 |
| 10 | i18n | `src/locales/`（zh-cn + en-us，naive/date 语言包齐） | vue-i18n legacy:false | **保留**（框架文案大量走 `$t`），默认 locale 已是 `'zh-CN'`；多语言切换入口关掉即可，成本低 |
| 11 | 加密存储 | `packages/utils`（crypto-js）+ `localStg` | storage 带 crypto | 不涉敏感数据，保留无妨；`src/utils/storage.ts` 已导出 **localforage 实例**（IndexedDB），v1 数据层可直接复用或换 Dexie |
| 12 | 演示首页 | `src/views/home/`（卡片图表 banner） | echarts 演示 | 替换为三尺台"今日/本周"工作台视图；echarts 保留（党务数据看板可用） |
| 13 | 403 页 | `src/views/_builtin/403` + 守卫无权跳转 | — | 假用户 R_SUPER 后永不触发；可留可删 |

**推荐组合（改 files 最少）**：#3 假用户（auth store 重写为本地常量）+ #1 守卫删 token 分支 + #2 删 login + #4 删 service 层 + #8 关更新检测 + #6/#7 关 tab/搜索/多语言。全部集中在 `src/router/guard/`、`src/store/modules/auth/`、`src/service/`、`src/theme/settings.ts`、`.env` 五处。

---

## 4. 启动命令、Node 26 兼容性与坑

### 4.1 命令

```bash
pnpm install          # 首次（当前仓库 node_modules 尚未安装，需先装）
pnpm dev              # = vp dev --mode test（vite dev server, 0.0.0.0:9527, 自动开浏览器）
pnpm dev:prod         # --mode prod
pnpm build            # = vp build --mode prod
pnpm preview          # 端口 9725
pnpm gen-route        # 手动生成路由（= pnpm sa gen-route）
pnpm typecheck        # vue-tsc --noEmit --skipLibCheck
pnpm lint / pnpm fmt  # vp lint/fmt（@soybeanjs/oxc-config）
pnpm commit / commit:zh  # 交互式 conventional commit（sa CLI）
```

### 4.2 Node 26 / pnpm 12 兼容性

- engines 要求 `node>=20.19.0`：node **26.13.0** 满足；vue 3.5.43 / vite-plus 均兼容 node 26。
- `packageManager: pnpm@12.10.1`（corepack 锁定）：本机 pnpm 12.21.0 可用；若 corepack 严格模式开启会自动切 12.10.1，属正常。
- `tsconfig` 的 typescript 用 catalog：`npm:typescript-native-bridge@latest`（voidzero 新分发版），由 `pnpm-workspace.yaml` catalog/overrides 统一，**不要手动改装 typescript**。

### 4.3 可能的坑（按踩坑概率排序）

1. **`prepare` 脚本**：`"prepare": "vp config --no-agent"`——`pnpm install` 时执行，首次安装可能需要网络拉 vite-plus；`--no-agent` 表示不写 env 代理配置。若离线安装需提前缓存依赖。
2. **`sa` CLI**：来自 `packages/scripts`（bin 名 `sa`），子命令 `gen-route/cleanup/update-pkg/git-commit/release`；`vp` 来自 `vite-plus`（catalog: latest），**两者都是 workspace 依赖，pnpm install 后自动可用**，不需要全局安装。`pnpm sa cleanup` 会清理并重装依赖（危险操作，慎跑）。
3. **`allowBuilds`**：pnpm-workspace.yaml 已把 `@parcel/watcher / esbuild / simple-git-hooks / vue-demi` 的构建脚本设为 false——esbuild 不跑 postinstall 说明用 vite-plus 内置二进制；若 install 后 esbuild 报版本不匹配，检查此项。
4. **`shamefullyHoist: true`**：依赖提升模式，后续加 Dexie/fullcalendar 无需担心幽灵依赖，但注意版本冲突会被掩盖，仍以 peer 检查为准。
5. **`VITE_HTTP_PROXY=Y` + dev 代理**：`build/config/proxy.ts` 读 env 生成代理；离线单机删 service 层后应把 `VITE_HTTP_PROXY` 改 N，避免启动时打印无效代理。
6. **router history mode**：`VITE_ROUTER_HISTORY_MODE=history`——浏览器 file:// 打不开（子路径资源 404），PWA/静态托管没问题；**若要"双击 index.html 就能用"，需改 hash 模式**（离线工作台建议直接用 hash，Tauri 亦兼容）。
7. **storage 前缀**：`VITE_STORAGE_PREFIX=SOY_`，localStg 所有 key 带前缀；导出备份时注意还原逻辑也要走同一工具。
8. **iconify 离线**：`setupIconifyOffline()`（`src/plugins/iconify.ts`）+ `@iconify/json` 2.2.541 本地全集——离线图标 OK，这是对 PWA 离线形态有利的关键点。

---

## 5. 已有依赖中可直接复用的清单（实测 package.json 存在）

| 依赖 | 版本 | 三尺台用途 | 备注 |
| --- | --- | --- | --- |
| **dayjs** | 1.11.23 | 台历/周月视图/日程时间计算（底座已配 `src/locales/dayjs.ts` + zh-cn locale） | 直接用，不必再装 date-fns |
| **echarts** | 6.1.0 | 党务统计看板（发展进度、党费台账、三会一课完成率） | 已有；无 vue-echarts 包装，现有 demo 直接用 echarts init（`views/home/modules/line-chart.vue`），可照此封装一次 |
| **@vueuse/core** | 15.0.0 | useStorage/useDraggable/usePreferredColorScheme/PWA 场景工具 | 直接用 |
| **vue-draggable-plus** | 0.6.1 | 台历拖拽排序、座位图换座可用其替代手写 DnD | 已有，座位图可评估复用 |
| **@better-scroll/core** | 2.5.1 | 长列表滚动（可选） | 已有 |
| **naive-ui** | 2.45.3 | 全部 UI 组件 + NDatePicker/NCalendar 可辅助台历 | 已有 |
| **@sa/utils** | workspace | `createStorage`（带过期/加密 localStorage 封装）+ **`createLocalforage`（IndexedDB 封装，localforage 1.10.0）**、nanoid、colord | 数据层可先复用 localforage；若选 Dexie 再评估替换 |
| **@sa/color** | workspace | colord 封装的色阶生成（主题换色已用） | 自定义党旗红辅助色可用 |
| **@sa/hooks** | workspace | useLoading/useBoolean/useRouterPush 等 | 业务页直接用 |
| **@iconify/json** | 2.2.541（dev） | 本地图标全集，离线可用 | 选用 iconify 图标时确认该集合包含 |
| pinia / vue-i18n / vue-router | 4.0.3 / 11.4.13 / 5.4.0 | 框架层 | 正常使用 |

**缺口（底座没有、需要新增的）**：日历组件（FullCalendar）、IndexedDB 结构化存储（Dexie，现有 localforage 是 KV 封装，不适合复杂查询）、文件导出（file-saver）、PWA 插件——见 `dependency-plan.md`。

---

## 附：关键文件索引

```
package.json                    脚本/依赖/engines
pnpm-workspace.yaml             catalog（vite-plus/typescript 特殊分发）+ allowBuilds
.env / .env.test / .env.prod    路由模式/服务地址/存储前缀/更新检测开关
vite.config.ts                  vp defineConfig、端口 9527、scss 注入
build/plugins/router.ts         elegant-router 配置（layouts、meta 生成）
build/plugins/unplugin.ts       naive-ui 自动引入 + 本地 svg 图标
src/router/guard/route.ts       登录守卫（v1 改造点）
src/router/routes/index.ts      customRoutes（静态路由扩展点）
src/theme/settings.ts           主色/圆角/tokens/布局开关（主题改造核心）
src/theme/vars.ts               CSS 变量映射表
src/store/modules/theme/        主题 store（palette 生成/暗色切换）
src/store/modules/auth/         登录与假用户改造点
src/store/modules/route/        静态路由→菜单派生
src/store/modules/tab/          多标签（可配置关闭）
src/utils/storage.ts            localStg/sessionStg/localforage 三件套
src/locales/                    zh-CN 默认、naive 语言包
packages/utils/src/storage.ts   localforage IndexedDB 封装源码
packages/scripts/               sa CLI（gen-route 等）
```
