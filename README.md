# 三尺台 · 学工个人离线工作台

> 「三尺」取自三尺讲台、三尺案头——给兼任学生工作的你，一方干净的案头。
> 主视图是一本台历：周与月的工作安排一眼可见，随手可改。

三尺台是面向高校学工身份（党支部书记 / 班长 / 社团负责人 / 辅导员）的**纯本地、离线优先**个人工作台。v1 聚焦「党支部书记」场景，多身份互不打通（切换器中其余身份为"规划中"占位）。

![技术栈](https://img.shields.io/badge/Vue3-Vite--plus-NaiveUI-+-UnoCSS-+-Dexie-+-FullCalendar-+-Tauri2-A81C24)

## 功能（v1）

| 模块 | 说明 |
| --- | --- |
| 台历（首页） | 周/月视图（FullCalendar），点空白时段快速新建、拖拽改期、类别色标（党建红仅用于组织生活与预警）、重复规则投影（每周几 / 每月第 N 个星期 X / 每月 N 日）、今日与本周速览 |
| 三会一课 | 按《支部工作条例》频次一键生成学期排期（幂等不重复）、会议列表、参会考勤勾选与自动到会率、党课并入党员大会（不计入"每月线下会议 ≤3 次"） |
| 人员 | 教室/工位座位图（拖拽换座、点选互换、撤销快照）、多布区、欠缴角标、人员卡（发展阶段/缴费/谈话次数六项信息）、列表筛选 |
| 发展台账 | 五阶段泳道（申请人→正式党员）、25 节点材料编号体系、下一步窗口期高亮、一键流转阶段、预备期满前 7 天自动生成转正大会候选事项 |
| 党费台账 | 生成本月名单（学生党员 0.2 元/月）、人×月矩阵点格记缴、连续欠缴标红、导出对齐学院报表的逐月矩阵 CSV |
| 谈心谈话 | 年度覆盖矩阵、申请人 1 个月内谈话硬提醒、三步录入 |
| 材料库 | 6 类公文模板（纪要/议程/方案/总结/请示/谈话表）、占位符自动填充、导出 Word(.doc)/Markdown、归档区 |
| 统计总览 | 阶段分布、缴费率、三会一课计数、类别分布（ECharts） |
| 设置 | 一键备份/恢复 JSON、环形快照（5 份）、重置演示数据、致谢与隐私声明 |
| 打印套件 | 会议签到表、座次表一键打印 |
| 桌面形态 | Tauri v2 配置就绪（见下），浏览器/PWA 形态默认可用 |

## 快速开始

```bash
pnpm install      # 首次安装
pnpm dev          # 开发模式 → http://localhost:9527（hash 路由）
pnpm build        # 生产构建（含 PWA：Service Worker + manifest）
pnpm preview      # 预览生产构建 → http://localhost:9725
```

要求：Node ≥ 20.19、pnpm ≥ 10.5（本仓库锁 pnpm@12）。

## 桌面打包（Win / Mac，Tauri v2）

```bash
pnpm add -D @tauri-apps/cli   # 已在 devDependencies
pnpm tauri dev                # 联调（复用 vite dev server 9527）
pnpm tauri build              # 出包：Win→NSIS(.exe) / Mac→.dmg
```

- 配置：`src-tauri/tauri.conf.json`（identifier `cn.sanchitai.app`，devUrl 9527，frontendDist `../dist`）
- 本机 Rust ≥ 1.90（MSRV）即可；正式分发 Mac 包需 Apple 开发者签名+公证
- 图标再生成：`pnpm tauri icon <1024 源图>`

## 数据与隐私

- **纯本地**：所有数据存于浏览器 IndexedDB（Dexie），无账号、无网络请求、不上报任何数据
- **备份**：设置页一键导出/导入 JSON（导入前自动快照）；本地环形快照保留最近 5 份
- **隐私**：默认不采集身份证号；手机号为选填敏感字段；导出报表不含敏感列
- **演示数据**：首次启动自动导入一套虚构种子数据（22 名成员等，全部化名脱敏），可在设置页重置/清空

## 工程要点

- 底座：[soybean-admin](https://github.com/soybeanjs/soybean-admin) v2.3.0（MIT），已做去登录化（本地单机用户）、hash 路由、党建红主题（`src/theme/settings.ts` 一处改全局色阶）
- 台历：FullCalendar v6（整组锁 ~6.1.22）；重复日程为**渲染期投影**（借鉴 super-productivity 的 RepeatProjection 思路，MIT，`src/utils/recurrence.ts`）
- 存储：Dexie 4 单工厂 + liveQuery → Pinia；schema 集中在 `src/db/db.ts`（v1→v3 迁移示例）
- 已知底座修复：`src/layouts/modules/global-content/index.vue` 关闭页面动画时的路由视图卡死问题（Transition 条件渲染）

## 文档

- 设计规划：[docs/design-plan.md](docs/design-plan.md)（信息架构 / 数据模型 / 视觉规范 / 三轮路线）
- 调研产出：`docs/research/`（底座分析 / SP 借鉴笔记 / 座位图移植方案 / 党务领域知识 / 依赖与 Tauri 备忘 / 用户需求书与验收清单 / 种子数据说明 / 广度功能池）
- 评审记录：`docs/reviews/`（三轮"实施→评审→修复"的用户代表评审报告）
- 决策记录：[docs/PROJECT.md](docs/PROJECT.md)

## 致谢

- [soybean-admin](https://github.com/soybeanjs/soybean-admin)（MIT）—— 工程底座
- [super-productivity](https://github.com/super-productivity/super-productivity)（MIT）—— 数据模型 / 重复日程 / 备份环形缓冲思路来源
- [classroom-workbench](https://github.com/chan1988lee/classroom-workbench) —— 座位图交互模式的灵感来源（其代码为非商用许可，本项目未复制其代码，交互规格为原创 Vue3 实现，仅个人学习用途）

## License

本项目代码 MIT（继承底座协议）。演示种子数据为虚构内容，请勿反向录入真实个人信息。
