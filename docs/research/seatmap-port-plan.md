# 座位图移植方案：classroom-workbench → 三尺台人员分布图

> 调研日期：2026-11-18。参考源：`_refs/classroom-workbench/index.html`（938KB 单文件，13120 行）。
> **许可约束**：该作品为《班主任工作台非商业许可协议 1.0》，禁止照抄其代码。本文只提取**交互与信息设计模式**（事实性描述），三尺台实现全部为原创 Vue3 代码，且做领域改写（教室→党支部人员布点）。原始 CSS 类名/函数名/文案不搬运。

## 1. 原作座位图的实现机理（模式提取）

### 1.1 两套视图并存

| 视图 | 技术 | 用途 |
| --- | --- | --- |
| 「教室首页」（class 页） | 程序化生成的**俯视 SVG 场景**（`viewBox` + 逐座位 `<g class="seat">`），含讲台、墙报、电子屏等布景 | 课堂现场：点座位标记考勤/点评，hover 弹学生小卡 |
| 「座位图」（seats 页） | **CSS Grid 网格**（`grid-template-columns` 动态拼接，含过道列/门口列占位轨） | 编排座次：行/列配置、固定座、整列轮换、打印 |

关键启发：**同一个人员-位置映射（student.seat = '行-列'）支撑两种视图**——一个"场景化"用于日常交互打卡，一个"表格化"用于编排与打印。三尺台同样应有"布置图（日常）"与"编排视图（调整）"双形态。

### 1.2 数据结构（模式级）

- 人员对象携带位置字段：`{ id, name, no(学号), gender, seat: 'r-c' | null, group, status, tags[] }`；`seat` 是**字符串坐标**（`行-列`），null=未排。
- 布局参数独立存于设置：`{ rows, pairs(同桌组数), door(左/右), ... }`，座位总数 = rows × pairs×2；`allSeats()` 由参数推导而非显式存储。
- 过道位置固定为**第 2/3 列之间、第 6/7 列之间**（`seatAisleAfter`），渲染时作为独立网格轨道插入；座位数据本身不含过道概念。
- 讲台固定座（podium L/R）是**网格外的特殊单元格**，可安排人也可为空。
- 组号不单独存储，由 `autoGroups()` 从座位坐标推导（列号/2）——**派生数据不落库**。

### 1.3 交互机制（模式级）

1. **拖拽换座**（pointerdown/move/up 三段式）：
   - down：记录起点与目标元素，位移阈值 5px 内视为点击、超过判定为拖拽（**拖/点二分**）。
   - move：生成 body 级圆形头像"幽灵"跟随指针（fixed 定位），用 `document.elementFromPoint()` 探测落点座位并加 `drop-on` 高亮（虚线框）；容器 `setPointerCapture` 保证移出元素后仍收事件。
   - up：读取 drop-on 目标 → 执行换座；若未移动则走点击逻辑。
   - 兜底：**"先后点两个座位"等价于拖拽**（pick-first → pick-second → swap），触屏/键盘可达性兜底。
2. **点击标记状态循环**：考勤模式下点座位按 `出勤→请假→缺勤→迟到→出勤` 环形切换（null 之外 3 态循环），状态存 `attendance[date][sid]`。
3. **换座原子操作**：`moveSeat(from,to)`——目标有人则**互换**，无人则移入；操作前快照全量 `[id, seat, group]` 支持一键撤销（单级 undo）。
4. **批量编排**：随机打乱、按成绩优弱同桌、男女同桌、按学号排、整列左右轮换；全部先快照再落库。
5. **AI 排座（约束优化）**：规则 `{ fixed: {sid:'座位'}, same:[对], avoid:[对], front:[sid], mixGender }` → **罚分函数**（同桌加分冲突 40/120、必须分开 140、前排照顾 90、同性别同桌 6）+ **随机重启局部搜索**（4 次重启、每次最多 120×人数 次随机交换、接受不劣解），输出方案与剩余罚分，用户确认后应用。
6. **打印视图**：另写一份极简 HTML（讲台+表格+空位灰字）新窗口打印；`@media print` 处理分页。
7. **底栏统计（dock）**：`应到=总人数，实到=总-请假-缺勤`，分项计数来自当日考勤表 + 与"请假管理"记录**双向同步去重**（教室打的请假自动生成请假单，销假自动回删）。
8. **hover 学生卡**：座位 hover 出 300px 浮动卡（照片/关键信息/快捷操作），延时显示防抖。

### 1.4 性能与实现细节（可借鉴）

- 全量重绘（字符串拼 SVG/HTML）而非增量更新——数据规模 ≤ 60 人时足够快；三尺台用 Vue 响应式天然增量，更省。
- 空座位显示"＋"，hover 才显示"安排学生"提示；`ghost`（未排座人员淡化显示）、`dim`（非当前焦点淡化）是两个有用的视觉层级 class。
- 座位格信息密度：姓名（粗体）+ 学号（小灰字）+ 性别色条/符号 + 状态小标签，**最多四层信息**，可控不挤。

---

## 2. 三尺台 Vue3 组件设计（原创实现规格）

### 2.1 组件拆分

```
src/components/roster/
  RosterBoard.vue          # 布置图容器：网格布局引擎 + 交互分发（对应"座位图"）
  RosterSeatCell.vue       # 单个点位（党员/积极分子/工位/空位）
  RosterToolbar.vue        # 工具条（模式切换/批量操作/打印导出）
  RosterStatsBar.vue       # 底栏实时统计
  MemberCard.vue           # 党员浮卡（hover/点击，独立可复用）
  RosterPrintView.vue      # 打印/导出纯排版视图
```

### 2.2 核心数据结构（props / model）

```ts
// 类型定义建议放 src/typings/roster.d.ts 或 src/models/roster.ts

/** 点位：'工位' | '宿舍' 等布区下的坐标 */
interface RosterPos { row: number; col: number }

/** 布区：三尺台扩展——教室'rows×pairs'概念泛化为多个布区 */
interface RosterZone {
  id: string;                 // 'office' | 'dorm' | 'group-a' ...
  name: string;               // 办公工位 / 宿舍楼 / 党小组
  kind: 'office' | 'dorm' | 'group';
  rows: number;
  cols: number;
  /** 过道/空隙列下标（在该列前插入间隔），如 [2, 6] */
  aislesBefore: number[];
  /** 特殊固定点位（如党小组长位、值班位）：pos -> 标签 */
  landmarks: Array<{ pos: RosterPos; label: string }>;
}

/** 成员：不把位置写死在人身上，而是映射表，便于撤销与多布区 */
interface PartyMember {
  id: string;
  name: string;
  role: '书记' | '副书记' | '组织委员' | '宣传委员' | '纪检委员' | '党员' | '预备党员' | '积极分子';
  groupIds: string[];         // 所属党小组
  tags: string[];
  /** 可选展示字段：入学年份、专业班级 */
  meta?: { grade?: string; major?: string };
}

/** 位置映射：独立实体，支持快照/撤销/历史 */
interface MemberPlacement {
  id: string;
  zoneId: string;
  pos: RosterPos;             // 'r-c' 复合字符串亦可
  memberId: string;
}

/** 日常状态（如活动签到），按日存，出勤循环标记 */
type PresenceStatus = 'present' | 'leave' | 'absent' | 'late';
interface PresenceRecord { [date: string]: { [memberId: string]: PresenceStatus } }
```

**组件 Props/Emits**：

```ts
// RosterBoard.vue
props: {
  zones: RosterZone[];
  members: PartyMember[];
  placements: MemberPlacement[];
  mode: 'view' | 'edit' | 'presence';   // 查看 / 编排 / 签到
  status?: PresenceRecord;              // presence 模式必填
  highlightMemberId?: string;
}
emits: {
  swap: [from: PlacementRef, to: PlacementRef],   // 父级执行互换+快照，组件不直接改库
  place: [memberId: string, to: PlacementRef],    // 空位安排人
  remove: [placementId: string],
  cycleStatus: [memberId: string, current: PresenceStatus | null],
  openMember: [memberId: string],                 // 打开党员卡片
}
```

设计要点：**组件不持久化**——所有变更 emit 给页面级 Pinia store（`store/modules/roster/`），store 负责快照（undo 栈）与 Dexie 落库。这区别于原作"组件里 save()"的过程式写法，是 Vue 单向数据流的自然落法。

### 2.3 布局引擎

- 用 **CSS Grid**：`grid-template-columns` 拼接（照搬模式不照抄代码）：`轨道 = [行号条] + (列 × {若该列前有过道: 间隔轨}) + [行号条]`，间隔轨 20px。行列号轴、门口/入口标记做成独立网格项。
- 每个点位渲染 `RosterSeatCell`：
  - 空位：虚线框 + "＋"，hover 显浅红底提示（呼应党建红关键色但保持低饱和）；
  - 有成员：姓名（13px 粗体）+ 角色徽标（Tag）+ 状态点；预备党员/积极分子给区别于正式党员的徽标色。
- 党小组着色：与原作"小组色标"同思路——每个党小组一个低饱和色块角标（`--primary-50` 系色阶 + 中性色，**不整格大红**），色板从底座 `@sa/color` 色阶生成。
- 布区切换用 `NTabs`（办公工位/宿舍/党小组名单式），或单页内多布区纵向排布（宿舍楼层=布区行）。

### 2.4 交互规格

| 交互 | 规格描述（对应原作模式） |
| --- | --- |
| 拖拽换座 | pointer 事件三段式：5px 位移阈值区分点击/拖拽；拖拽时用 ` Teleport` 生成幽灵头像跟随；`document.elementFromPoint` 探测落点 + `is-over` 虚线高亮；drop 触发 `swap`。空位为合法落点（= place） |
| 点选换座 | edit 模式下先后点两个有成员的点位 → 互换（拖拽的无障碍兜底）；点空位 → 弹出未排成员选择器 |
| 签到循环 | presence 模式点点位：`present → leave → absent → late → present` 环形；状态即时 emit，底栏同步 |
| hover 卡 | 300ms 延时浮出 `MemberCard`（姓名/角色/小组/联系方式/最近事项）；点击点位（view 模式）直接打开党员卡 `NModal/NDrawer` |
| 批量操作 | 按姓名排序自动布点、随机布点、按党小组聚拢（把同组成员排到相邻列）、整列轮换、清空；全部先 push undo 快照 |
| 撤销 | undo 栈存 placements 全量快照（成员少，量级无压力），`Ctrl+Z` + 工具按钮 |
| 打印/导出 | `RosterPrintView`：`window.print()` + `@media print` 只渲染该组件（或复用底座导出 JSON + 生成 HTML 两种路径）；建议先做打印，PDF 后置 |

### 2.5 状态色建议（呼应"浅色为主+红色关键色"）

| 状态 | 色建议 | 理由 |
| --- | --- | --- |
| 在位/出勤 | 中性（无色点或 `--success` 绿 #52c41a 的 soft 底） | 默认态不抢眼 |
| 请假 | amber `#faad14` soft 底 `#fdf3df`，点位整体降透明度 0.55 | 沿用原作"请假=amber+淡化"的信息设计 |
| 缺勤 | 红 `#e5483b` / 用主题 error `#f5222d` soft | 红色留作最需关注态，与党建红形成"关键色"一致语义 |
| 迟到 | 蓝 info | 低权重 |
| 布点未定 | 灰虚线框 | 引导补齐 |
| 角色徽标 | 书记=党建红实底白字（全卡唯一红徽标）；委员=红 soft 底红字；预备党员=金/琥珀徽标；积极分子=灰徽标 | 红色只出现在"关键角色"上，符合设计语言约束 |

### 2.6 统计逻辑（RosterStatsBar）

- 输入：members × placements × 当日 presence。
- 输出：`应到（成员总数）· 实到（总数−请假−缺勤）· 请假 N · 缺勤 N · 迟到 N`，按党小组分组小计（对齐原作"小组积分"的分组统计模式，换成小组出勤率）。
- 编辑模式下输出：`已布点 X / 总点位 Y · 未布点成员 Z`。
- 计算**纯函数化**放 `src/utils/roster-stats.ts`，便于单测与跨视图复用（台历页"今日活动签到率"也能调用）。

### 2.7 与原作的关键差异（领域改写清单）

1. 人员从"学生"改为"党员/积极分子"，角色徽标取代性别符号（性别不采集）。
2. 布区多态：教室单布区 → 办公工位/宿舍/党小组多布区；"同桌 pair"概念弱化，党小组"聚拢约束"取代（复用罚分函数思路：同组成员应相邻，分散则 +罚分）。
3. AI 排座改"智能布点"：规则改为 `{ fixed, sameGroup（同组相邻）, apart（需分开人员）, near（如靠近借阅/值班位） }`——同样用"罚分函数 + 随机重启局部搜索"算法（算法思想为通用常识，可独立实现，约 80 行 TS）。
4. 考勤标记语义改为活动/会议签到（与台历活动联动：台历日程点击"签到"跳转布区签到模式）。
5. 增加与党务档案联动：点位点击打开党员卡片（发展阶段进度、党费缴纳状态、"三会一课"参与记录摘要）。

## 3. 实施建议

- 阶段一：`RosterZone/MemberPlacement` 数据模型 + Dexie 表 + RosterBoard 静态渲染 + 点选互换 + 统计条（不拖拽）。
- 阶段二：pointer 拖拽 + 幽灵元素 + undo 栈 + 打印视图。
- 阶段三：智能布点（罚分优化）+ 党员卡联动 + 签到↔台历联动。
- 测试锚点：换座互换正确性（双向占用）、undo 一致性、elementFromPoint 在 SVG/Grid 混合下的落点正确性（原作因 SVG 场景做过 `closest('.seat')` 兜底，Grid 版同样需要 data-pos 属性兜底而非依赖 DOM 结构）。
