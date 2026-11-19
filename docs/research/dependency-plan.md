# 三尺台组件与版本清单（对照底座，避免冲突）

> 调研日期：2026-11-18。版本经 npm registry 实时核实（`npm view`），底座版本读自 `package.json`。
> 底座既有（复用，勿重复安装）：vue 3.5.43 / naive-ui **2.45.3** / echarts **6.1.0** / dayjs **1.11.23** / pinia 4.0.3 / vue-router 5.4.0 / vue-i18n 11.4.13 / @vueuse/core 15.0.0 / vue-draggable-plus 0.6.1 / @sa/utils（内含 **localforage 1.10.0**）/ @better-scroll/core 2.5.1。

## 1. 新增依赖逐个核实（2026-11-18 最新版）

| 库 | 最新版本 | 许可 | 三尺台用途 | 与底座兼容性 |
| --- | --- | --- | --- | --- |
| **@fullcalendar/core** | 6.1.22（v7 已出 beta，勿升） | **MIT** | 台历引擎核心（周/月视图调度） | peer 无额外要求；与 vue3 6.x 配套 core ~6.1.22 |
| **@fullcalendar/vue3** | 6.1.22 | MIT | FullCalendar 的 Vue3 包装组件 | deps: `@fullcalendar/core ~6.1.22`、`vue ^3.0.11` → vue 3.5.43 ✓ |
| **@fullcalendar/daygrid** | 6.1.22 | MIT | 月视图/日视图插件 | 无 peer |
| **@fullcalendar/timegrid** | 6.1.22 | MIT | 周视图时间轴（"周三 14:00-16:00 支委会"的主视图） | 无 peer |
| **@fullcalendar/interaction** | 6.1.22 | MIT | 台历拖拽编辑（drag-drop/resize/click） | 无 peer |
| **dexie** | 4.4.7 | Apache-2.0 | IndexedDB 结构化存储（台历/人员/档案/台账主库） | 无 peer；可选 `dexie-export-import`（同版本，JSON 备份导出插件） |
| **vue-echarts** | 8.3.2 | MIT | echarts 的 Vue3 组件包装（统计看板） | peer: `echarts ^6.0.0` ✓（底座 6.1.0）、`vue ^3.3.0` ✓ |
| **file-saver** | 2.0.5 | MIT | JSON 备份导出触发浏览器下载 | 无 peer；TS 需 `@types/file-saver`（dev，2.0.7） |
| **vite-plugin-pwa** | 2.0.0 | MIT | PWA：离线缓存 + manifest（浏览器形态离线可用） | peer: `vite ^3.1..^8.0.0` ✓（底座 vite-plus 兼容 vite 8）；peer 另有 workbox-build ^7.4.1 / workbox-window ^7.4.1（pnpm 10+ auto-install-peers 默认开，会自动装） |

**版本红线**：
- FullCalendar 必须整组锁 `~6.1.22`。**v7（@fullcalendar/vue3@7.1.5）已发布但 daygrid/timegrid/interaction 仍停在 6.1.22**，混装 major 会直接崩；且任务约定用 v6。装时用 `@6` 或精确 `~6.1.22`。
- vue-echarts 必须选 8.x（8.x 才支持 echarts 6；7.x 只到 echarts 5）。
- 不装 `dexie-react-hooks`（React 专用）；Vue 侧用 `useObservable(dexie.liveQuery(...))` 模式（dexie 自带 liveQuery，配 @vueuse/core 的 useSubscription 或自写封装）。
- 不需要单独装 `localforage`（@sa/utils 已带）；若只做 KV 备份可直接用它，但主数据建议 Dexie（schema/索引/事务/liveQuery）。

## 2. 每个库的分工总表

| 层 | 库 | 说明 |
| --- | --- | --- |
| 日历视图 | @fullcalendar/{core,vue3,daygrid,timegrid,interaction} | 台历周/月视图 + 拖拽编辑；repeatCfg 投影以 events 函数接入 |
| 本地存储 | dexie (+dexie-export-import) | 主数据库；liveQuery 驱动视图响应；导入导出 JSON 备份 |
| 图表 | echarts(既有) + vue-echarts | 三会一课完成率、发展进度、党费台账看板 |
| 文件导出 | file-saver | 党员花名册 CSV、全库 JSON、座位表 HTML |
| 离线 | vite-plugin-pwa | 浏览器形态离线可用；Tauri 形态下插件保留无害 |
| 日期 | dayjs(既有) | 底座已配 zh-cn locale（src/locales/dayjs.ts） |
| 拖拽列表 | vue-draggable-plus(既有) | 列表排序类拖拽；时间轴网格拖拽用 pointer 事件（见 seatmap-port-plan.md） |

## 3. 可直接执行的安装命令

```bash
# 数据层
pnpm add dexie dexie-export-import

# 台历
pnpm add @fullcalendar/core@~6.1.22 @fullcalendar/vue3@~6.1.22 @fullcalendar/daygrid@~6.1.22 @fullcalendar/timegrid@~6.1.22 @fullcalendar/interaction@~6.1.22

# 图表包装 + 导出
pnpm add vue-echarts file-saver
pnpm add -D @types/file-saver

# PWA（浏览器离线形态）
pnpm add -D vite-plugin-pwa
```

**潜在 peer 冲突检查结论**：无硬冲突。
- `vite-plugin-pwa` 的 vite peer 覆盖到 ^8，底座 vite-plus（voidzero 分发）按 vite 8 语义接入，workbox 双 peer 由 pnpm 自动补装；若 CI 报 missing peer，手动 `pnpm add -D workbox-build@^7.4.1 workbox-window@^7.4.1`。
- `@sa/uno-preset` 与新库无交集；`shamefullyHoist: true` 会提升新库到根 node_modules，不影响 workspace 子包。
- naive-ui 2.45.3 与 fullcalendar 无样式冲突（后者自带 scoped CSS，v6 引入方式：`import '@fullcalendar/core/index.css'` 等，注意 Vite CSS 引入放在入口）。

---

## 4. Tauri v2 备忘（后续打包 Win/Mac，本阶段不执行）

### 4.1 本机兼容性确认（已做）

- 本机 Rust：**rustc 1.99.1 / cargo 1.99.1**（2026-10 构建）。Tauri 2 当前（@tauri-apps/cli 2.12.5 / @tauri-apps/api 2.12.5）crates.io 标注 MSRV **1.90.0** → **1.99.1 兼容**，无需降级。若后续 Tauri 升 MSRV，以 `cargo build` 报错或 https://v2.tauri.app/start/prerequisites 页为准；锁定旧版 tauri 2.x（≤1.77 MSRV 时代）也可以兜底。
- Webview 差异：Win 用 WebView2（系统自带，Edge 同核），Mac 用 WKWebView；两者都支持 IndexedDB——**Dexie 数据在浏览器形态与 Tauri 形态分属不同 origin，不互通**（见 4.4）。

### 4.2 tauri.conf.json v2 结构要点（v1→v2 关键改名）

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "三尺台",
  "version": "0.1.0",
  "identifier": "cn.sanchitai.app",          // 必填，反向域名；一旦发布勿改（升级校验用）
  "build": {
    "beforeDevCommand": "pnpm dev",           // 拉起 vite dev server
    "devUrl": "http://localhost:9527",        // v1 devPath→v2 devUrl；指向底座 vite 端口
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"                 // v1 distDir→v2 frontendDist
  },
  "app": {
    "windows": [{ "title": "三尺台", "width": 1280, "height": 800 }],
    "security": { "capabilities": [] }        // v2 权限=capabilities，按需启用 fs/dialog
  },
  "bundle": { "active": true, "targets": ["nsis", "dmg"] }
}
```

- identifier 规范：小写字母/数字/连字符/点，**不能用保留词、不能以下划线/数字结尾**，建议 `cn.sanchitai.app` 或 `io.github.zephyrxx.sanchitai`。
- devUrl 必须与底座 vite.config.ts 的 `server.port: 9527` 一致；`server.host: '0.0.0.0'` 已配置，Tauri 加载 http://localhost:9527 无障碍。

### 4.3 浏览器与桌面双形态共存方案

- 推荐单仓双形态：**同一 Vite 产物**，PWA 插件对 Tauri 无害（Tauri 不走 service worker，忽略 sw 注册即可；或用 `import.meta.env.TAURI_PLATFORM` 条件关闭 sw 注册与 PWA 安装提示）。
- 路由模式注意：浏览器离线形态建议 `hash`（file:// 或静态托管均可）；Tauri 对 history/hash 均兼容，统一 hash 最省心（呼应 base-analysis.md 第 4.3 节坑 #6）。
- 数据路径：浏览器形态 = IndexedDB；Tauri 形态默认 webview IndexedDB 仍在（卸载丢失），**v2 可加 tauri-plugin-sql 或 fs 插件把 SQLite/JSON 落到应用数据目录**（appDataDir），导出备份路径用 dialog 插件选择——列为后续增强项，v1 先 webview 存储即可。
- vite 多入口不是必须（单页应用一个入口足够）；若以后做"浏览器版 + 桌面版差异化入口"，用 `build.rollupOptions.input` 多入口 + 环境变量区分。

### 4.4 Win/Mac 打包差异

| 项 | Windows | macOS |
| --- | --- | --- |
| 安装包 | NSIS（.exe）/ MSI | DMG（.app） |
| 签名 | 可选（未签名有 SmartScreen 警告） | 未签名会被 Gatekeeper 拦；**分发需 Apple Developer 账号签名+公证** |
| 依赖 | WebView2（安装器可引导下载） | 系统自带 WKWebView，无额外依赖 |
| 构建 CI | GitHub Actions `windows-latest` | `macos-latest`（签名需导入证书 secrets） |
| 图标 | `icons/icon.ico` | `icons/icon.icns`（`tauri icon` 可从一张 1024 PNG 全量生成） |

### 4.5 后续接入步骤清单（实施阶段执行）

1. `pnpm add -D @tauri-apps/cli@^2` && `pnpm add @tauri-apps/api@^2`（只在需要系统 API 时装）。
2. `pnpm tauri init`（appName 三尺台，windowTitle 三尺台，devUrl http://localhost:9527，frontendDist ../dist）→ 生成 `src-tauri/`（Rust 工程 + tauri.conf.json）。
3. 修改 `tauri.conf.json`：identifier、窗口尺寸、`bundle.targets`；capabilities 按需加。
4. `pnpm tauri dev` 联调（dev 模式数据在 webview IndexedDB）；`pnpm tauri build` 出包。
5. `.gitignore` 加 `src-tauri/target/`、`src-tauri/gen/schemas/`。
6. （可选）`tauri-plugin-dialog`（备份文件保存到磁盘）+ `tauri-plugin-fs`；权限在 `capabilities/*.json` 里声明。
7. 验证点：离线启动（断网双击 exe/app）、IndexedDB 持久化、JSON 导入导出、PWA sw 不干扰桌面版。

来源：
- Tauri v2 官方文档（prerequisites/project-structure/config schema）: https://v2.tauri.app/start/prerequisites 、 https://v2.tauri.app/start/project-structure
- tauri.conf.json v2 schema: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-schema-generator/schemas/config.schema.json
- 版本与 MSRV 以 crates.io tauri 页实时为准（本调研时 MSRV 1.90.0）
