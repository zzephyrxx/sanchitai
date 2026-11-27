<div align="center">
  <img src="./public/favicon.svg" alt="三尺台 Logo" width="88" height="88" />
  <h1>三尺台 · SanChiTai</h1>
  <p><strong>面向高校学工与党务工作的纯本地、离线优先个人工作台</strong></p>
  <p><em>「三尺」取自三尺讲台、三尺案头——给兼任学生工作的你，一方干净、趁手、不联网的案头。</em></p>

  <p>
    <img src="https://img.shields.io/badge/version-v0.2.8-A81C24?style=flat-square" alt="Version" />
    <img src="https://img.shields.io/badge/license-Non--Commercial%20Personal%20Only-1F2937?style=flat-square" alt="License" />
    <img src="https://img.shields.io/badge/Vue-3.5-42B883?style=flat-square&logo=vuedotjs&logoColor=white" alt="Vue 3" />
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri v2" />
    <img src="https://img.shields.io/badge/Storage-100%25%20Local%20IndexedDB-0F766E?style=flat-square" alt="Local-First" />
  </p>

  <p>
    <a href="#-核心功能">核心功能</a> •
    <a href="#-隐私与离线保障">隐私与离线</a> •
    <a href="#-快速开始">快速开始</a> •
    <a href="#-桌面端构建">桌面端构建</a> •
    <a href="#-开源许可协议">许可协议</a>
  </p>
</div>

---

## ✨ 项目简介

**三尺台（SanChiTai）** 是一款专为高校学工骨干与党务工作者（班团负责人、学工助理、组织骨干、辅导员等）打造的**纯本地、离线优先**个人效率工作台。当前 `v0.2.8` 聚焦高校日常**学工与党务全周期工作流**，以「台历」为核心主视图，将**三会一课、人员花名册与全生命周期组织关系转接、座位图预设、25 步发展台账与 S 型时间线、党费收缴矩阵、60+40 年度积分台账、志愿时长台账、谈心谈话、14 套标准公文 `.docx` 材料库与政策知识库、组织架构图、政治生日贺卡**收拢在一张干净的桌面上。

- **零服务器 / 零账号 / 零上报**：所有数据均存储在本地（桌面端支持自定义数据存储文件夹），支持专属加密 `.sctpack` 按模块导出/导入与 10+10 环形自动/手动快照，全站表格导出默认脱敏公示。
- **双视觉主题 + 电子纸美学**：内置「中式墨韵」与「电子纸（E-Paper / KONTUR）」高对比护眼纸感主题，支持浅色 / 深色模式、全局字体切换、最高 150% 字号缩放与窄屏自适应排版。
- **多端形态**：支持浏览器直接运行、PWA 离线安装，以及基于 **Tauri v2** 的 Windows（`.exe` / `.msi`）与 macOS（`.dmg`）原生桌面安装包。

---

## 🧩 核心功能

| 模块                      | 核心能力                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **📅 台历工作台**         | FullCalendar 日/周/月视图、点击空白快速新建、拖拽改期与调整时长（二次确认）、重复规则渲染期投影、类别色标筛选、「撕纸」删除撤销动效、右侧今日日程栏（窄屏弹性收起）与本周进度概览                                                         |
| **📊 统计总览**           | 4 项核心指标卡、待办提醒中心（逾期 / 欠缴 / 谈话缺口 / 转出待回执 / 近 7 天节点）、本月党费环形图、近 26 周日程热力图，以及 **6 项创意可视化组件（健康五维雷达 / 积分仪表盘 / 志愿来源环 / 生命周期矩阵 / 谈话温度计 / 小组活力同心环）** |
| **🪑 人员与组织关系转接** | 5 态全生命周期胶囊（在册 / 转出办理中 / 转入待核查 / 流动人员 / 历史归档）、单人 4 步转出与毕业季批量转出、多人转入档案核查矩阵与国标 `.docx` 函件导出、防误删保护、列设置自定义扩展字段与可视化座位图                                    |
| **📋 三会一课**           | 按规范频次一键生成学期排期（幂等去重）、会议考勤勾选与自动计算到会率、按学年 / 按年度筛选、一键打印会议签到表                                                                                                                             |
| **🏅 年度积分（60+40）**  | 聚焦高校 60+40 分桶制考核、经典台账与独立录入弹窗、彩色分段积分构成进度条、跨模块一键同步考勤/党费/志愿草稿、脱敏 Excel 导出与记录表打印                                                                                                  |
| **🤝 志愿时长台账**       | 按活动 / 按成员双视角统计、人头芯片快选 + 台历活动引入 + 粘贴微信群接龙自动识别单人时长与岗位、考核折算预览、双 Sheet 脱敏 Excel 公示表与打印公示单                                                                                       |
| **🌱 发展台账（25 步）**  | 5 阶段泳道管理、跨阶段独立材料翻页轨、**S 型圆点里程碑时间线**、**按阶段一键归档（支持无日期/同页逐条设日期/统一日期）**、本阶段材料齐备色标与一键流转                                                                                    |
| **💰 党费收缴**           | 一键生成本月应缴名单（高校学生默认 0.2 元/月标准）、人 × 月矩阵点击即记缴、**批量设为已缴与单月全员已缴**、连续欠缴标红提醒、导出对齐报表的逐月矩阵 CSV                                                                                   |
| **💬 谈心谈话**           | 年度谈话覆盖矩阵、**点击成员卡片快捷新建谈话**、超期未谈话提醒、三步结构化录入、表格搜索与分页                                                                                                                                            |
| **📚 党务资源库**         | **知识库**（实操图解 + 自定义上传 + 确认删除与恢复内置）、**政策文件**（权威法规要点 + 顶部色条纯净阅读弹窗 + 本单位归档）、**材料库**（**14 套高频公文模板**，双栏预览并导出符合 **GB/T 9704-2012** 标准的原生 `.docx`）                 |
| **🏛️ 组织与流程**         | 组织架构树（支持自定义委员分工）、小组拖拽分组、25 步可视化标准流程图、政治生日贺卡工坊（近 30/60 天快加与 A4 拼版打印）                                                                                                                  |
| **🔍 效率、加密与引导**   | 全局搜索 `⌘K / Ctrl+K`、左下角「模块管理」自由定制左侧菜单、15 模块可检索「使用指南」与跨页新手引导动画、全站默认脱敏导出、**专属 `.sctpack` 加密交接包**、自定义数据目录与 GitHub Releases 自动检查更新                                  |

---

## 🔒 隐私与离线保障

- **100% 本地存储**：所有业务数据存于浏览器/桌面端本地 IndexedDB（Dexie），**无任何后端服务器、无账号登录、无遥测统计、无数据上报**。
- **备份与防误删**：设置页支持一键导出/导入专属加密 `.sctpack` 数据包（支持按模块勾选与可选交接口令，向下兼容旧版 JSON），并内置各 10 份本地环形自动/手动快照及升级前保护快照。
- **隐私脱敏设计**：默认不强制采集身份证号与手机号；导出统计报表默认自动脱敏敏感字段；首次启动加载的演示数据为 22 位全化名虚构成员，可在设置页一键清空或重置。

---

## 🚀 快速开始

### 环境要求

- **Node.js** `>= 20.19.0`
- **pnpm** `>= 10.5.0`（仓库锁定 `pnpm@12.10.1`）

### 直接下载安装包（推荐个人使用）

前往 [**Releases**](https://github.com/zzephyrxx/sanchitai/releases) 页面下载最新版本：

- **macOS（Apple Silicon）**：`sanchitai_0.2.8_MacOS_aarch64.dmg`，拖入「应用程序」即可使用
- **Windows（x64）**：`sanchitai_0.2.8_Windows_x64-setup.exe`，双击向导一键安装
- **源码包**：`sanchitai-v0.2.8-src.zip`（自行编译请参考下方「本地开发」与「桌面端构建」）

> 💡 也可以直接在浏览器中使用：部署 `pnpm build` 产物至任意静态服务器，即得离线 PWA。

### 本地开发与 Web 预览

```bash
# 1. 克隆仓库
git clone https://github.com/zzephyrxx/sanchitai.git
cd sanchitai

# 2. 安装依赖
pnpm install

# 3. 启动开发服务器（默认 http://localhost:9527）
pnpm dev

# 4. 类型检查 & 生产构建（含 PWA）
pnpm typecheck
pnpm build

# 5. 本地预览生产包
pnpm preview
```

---

## 💻 桌面端构建（Windows / macOS）

本项目已完整集成 **Tauri v2** 配置（`src-tauri/`），可直接打包为原生桌面应用：

```bash
# 桌面端开发联调
pnpm tauri dev

# 构建当前平台安装包（macOS → .dmg / Windows → NSIS .exe & .msi）
pnpm tauri build
```

> 📘 **Windows 机器完整编译构建教程**（含 Node / pnpm / Rust / VS C++ Build Tools / WebView2 环境准备与常见问题排查）：请阅读 [**docs/WINDOWS_BUILD.md**](./docs/WINDOWS_BUILD.md)。

---

## 🛠️ 技术栈与项目结构

- **前端框架**：Vue 3.5 + TypeScript + Vite (`vite-plus`) + Pinia 4 + Vue Router 5 (Hash 路由)
- **界面与样式**：Naive UI 2.45 + UnoCSS + 自研电子纸（E-Paper）主题变量系统
- **核心引擎**：FullCalendar v6（台历）+ Dexie 4（本地数据库与 `liveQuery`）+ ECharts 6（统计图表）+ `vue-draggable-plus`（拖拽换座）+ `docx`（标准公文导出）
- **桌面封装**：Tauri v2（Rust）

```text
sanchitai/
├── src/
│   ├── db/            # Dexie v4 数据库 Schema、迁移与演示种子数据
│   ├── views/         # 台历 / 统计总览 / 人员 / 三会一课 / 发展台账 / 党费 / 谈话 / 积分 / 志愿 / 资源库 / 组织 / 设置
│   ├── layouts/       # 导航栏、全局搜索 (⌘K)、主题抽屉、应用锁门禁
│   ├── styles/        # 中式墨韵与电子纸主题全局样式与 CSS 变量
│   └── hooks/         # 双语适配 (sct-i18n)、台历投影、打印套件
├── src-tauri/         # Tauri v2 桌面端配置、Rust 入口与全平台应用图标
├── docs/              # Windows 编译构建指南
└── packages/          # Monorepo 工具包（基于 soybean-admin 底座）
```

---

## 📜 开源许可协议

> ⚠️ **严格非商业个人使用协议（Non-Commercial Personal Use Only）**

本项目代码采用 **[SanChiTai Personal & Non-Commercial Source-Available License v1.0](./LICENSE)** 发布：

- ✅ **允许**：个人学习、科研教学、以及高校个人/基层学生工作的**非商业自用**（允许下载、本地编译运行及个人定制修改）。
- ❌ **严格禁止**：未经著作权人书面授权，严禁用于任何**商业用途**、**二次打包售卖**、**收费代部署/培训**、**企业内部商用**或**对外提供 SaaS / 云端托管服务**；严禁删除或篡改版权声明与许可协议。
- 📦 **第三方组件声明**：本项目所依赖的第三方开源框架与组件（含 `soybean-admin` 等）保留其原有开源协议，详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

---

## 🙏 致谢

- [soybean-admin](https://github.com/soybeanjs/soybean-admin)（MIT）—— 工程底座与 Monorepo 脚手架
- [super-productivity](https://github.com/johannesjo/super-productivity)（MIT）—— 本地优先环形快照与重复日程投影架构灵感
- [classroom-workbench](https://github.com/chan1988lee/classroom-workbench) —— 座位图交互模式灵感（交互规格为原创 Vue 3 独立实现，未复制其源码）
