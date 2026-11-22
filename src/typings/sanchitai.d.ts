/**
 * 三尺台 领域类型定义（全局命名空间 Sct）
 *
 * 字段与 docs/research/seed-data-draft.json 及 docs/design-plan.md §2 保持一致。
 */
declare namespace Sct {
  type MemberType = '正式党员' | '预备党员' | '发展对象' | '入党积极分子' | '申请人';

  type EventCategory = '组织生活' | '党务常规' | '发展党员' | '品牌活动' | '服务实践' | '工作例会' | '理论学习';

  type EventStatus = '计划' | '进行中' | '已完成' | '已取消';

  type FeeStatus = '已缴' | '欠缴' | '减免' | '未在校';

  type FeeCategory = '学生党员' | '在职党员';

  interface RecurrenceRule {
    freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
    /** weekly: 'friday'；monthly: 'day_25' | 'second_wednesday' 等编码 */
    by: string;
    range: string[];
    skip?: string[];
    overrides?: Array<{ date: string; [key: string]: unknown }>;
  }

  interface SeatPos {
    map_id: string;
    x: number;
    y: number;
  }

  interface Member {
    id: string;
    /** 支部内统一编号：支部缩写 + 3 位数字（如 ZGSB001） */
    code: string;
    /** 所属支部名称（默认继承当前工作台支部名称） */
    branch_name?: string;
    name: string;
    /** 学号 / 工号 */
    student_id?: string;
    /** 性别 */
    gender?: string;
    /** 民族 */
    ethnicity?: string;
    /** 出生年月（YYYY-MM 或 YYYY-MM-DD） */
    birth_date?: string;
    /** 宿舍楼栋号 */
    dorm_building?: string;
    /** 宿舍号 */
    dorm_room?: string;
    type: MemberType;
    role: string;
    group: string;
    grade: string;
    level: string;
    major: string;
    /** 班级 */
    class_name?: string;
    /** 身份证号（界面默认自动隐藏并脱敏展示） */
    id_card?: string;
    /** 联系电话 */
    phone?: string;
    advisor: string;
    join_date: string;
    full_date: string;
    /** 党费类别：学生党员（默认 0.2 元/月）或 在职党员（自定义月标准） */
    fee_category?: FeeCategory;
    /** 每月应缴党费标准（元），学生默认 0.2，在职可自定义 */
    fee_monthly?: number;
    seat?: SeatPos | null;
    key_dates?: Record<string, string>;
    note?: string;
    identity?: string;
  }

  interface SeatMap {
    map_id: string;
    name: string;
    grid: { cols: number; rows: number };
    identity?: string;
  }

  interface CalEvent {
    id: string;
    title: string;
    date: string;
    start_time: string;
    end_time: string;
    location?: string;
    category: EventCategory;
    kind?: string;
    owner?: string;
    helper?: string;
    agenda?: string[];
    recurrence?: RecurrenceRule | null;
    status: EventStatus;
    /** 并入某会议（如党课并入党员大会）的目标事件 id */
    merged_into?: string;
    /** 被并入的事件 id 列表 */
    merged?: string[];
    note?: string;
    identity?: string;
  }

  interface DevMaterial {
    no: string;
    name: string;
    status: string;
    date: string;
  }

  interface DevStage {
    member_id: string;
    stage: string;
    stage_date: string;
    next_node?: string;
    next_due?: string;
    materials?: DevMaterial[];
    timeline?: Array<{ node: string; date: string; note?: string }>;
    identity?: string;
  }

  interface FeeRecord {
    member_id: string;
    year_month: string;
    amount: number;
    status: FeeStatus;
    paid_date?: string;
    note?: string;
    identity?: string;
  }

  interface Talk {
    id: string;
    date: string;
    location?: string;
    type: string;
    member_ids: string[];
    initiator?: string;
    recorder?: string;
    content: string;
    follow_up?: string;
    event_id?: string;
    identity?: string;
  }

  interface DocTemplate {
    id: string;
    name: string;
    category: string;
    placeholders: string[];
    body: string;
    identity?: string;
  }

  interface Doc {
    id: string;
    template_id?: string;
    event_id?: string;
    member_id?: string;
    title: string;
    category?: string;
    body: string;
    created_at: string;
    updated_at?: string;
    identity?: string;
  }

  /** 会议考勤（到会/请假/未到会/迟到） */
  interface Attendance {
    id: string;
    event_id: string;
    member_id: string;
    status: '到会' | '请假' | '未到会' | '迟到';
    identity?: string;
  }

  /** 党员积分四大类别：基础分（扣分项）/ 履职分（加分项）/ 附加分 / 减扣分 */
  type PointCategory = 'base' | 'duty' | 'bonus' | 'penalty';

  /** 党员积分封顶子项编码 */
  type PointSubCategory =
    | 'base_politics_study'
    | 'base_politics_task'
    | 'base_discipline_meeting'
    | 'base_discipline_fee'
    | 'base_morality'
    | 'duty_study'
    | 'duty_practice'
    | 'duty_volunteer'
    | 'bonus'
    | 'penalty';

  /** 积分条目认定状态（仅「已认定」计入年度总分） */
  type PointVerifyStatus = '已认定' | '待核实' | '未通过';

  /** 积分细则辅助计分模式 */
  type PointCalcMode = 'fixed' | 'count' | 'role_half' | 'hours_20';

  /** 党员积分考核细则项（支持预置计院标准与自定义微调） */
  interface PointRuleItem {
    id: string;
    category: PointCategory;
    sub_category: PointSubCategory;
    label: string;
    description: string;
    /** 默认分值：基础分扣分与减扣分为负数（如 -1、-5），履职分与附加分为正数（如 0.5、2、5） */
    default_score: number;
    calc_mode: PointCalcMode;
    unit_label?: string;
    builtin?: boolean;
    enabled?: boolean;
  }

  /** 单条党员积分记录（对照附件 2 申报表） */
  interface PointRecord {
    id: string;
    member_id: string;
    /** 统计年度，如 2026 */
    year: number;
    /** 活动/事项发生日期 YYYY-MM-DD */
    date: string;
    category: PointCategory;
    sub_category: PointSubCategory;
    rule_id?: string;
    /** 所属细则名称（冗余存储，避免自定义改名后历史记录丢失语境） */
    rule_label: string;
    /** 活动内容/事项说明 */
    content: string;
    /** 最终认定分值（基础扣分与减扣分为负数，履职加分与附加分为正数） */
    score: number;
    status: PointVerifyStatus;
    /** 辅助计算元数据（用于编辑回显） */
    calc_meta?: {
      count?: number;
      role?: 'core' | 'member';
      hours?: number;
      base_score?: number;
    };
    note?: string;
    created_at: string;
    identity?: string;
  }

  /** 年度一票否决记录（开启后基础分归零） */
  interface PointVeto {
    /** 复合主键 `${member_id}::${year}` */
    id: string;
    member_id: string;
    year: number;
    active: boolean;
    reason: string;
    updated_at: string;
    identity?: string;
  }

  /** 自定义青年委员槽位（支持 0..N 个，仅限正式党员担任） */
  interface YouthCommitteeSlot {
    id: string;
    title: string;
    duty?: string;
    member_id?: string | null;
  }

  interface IdentityOption {
    id: string;
    name: string;
    available: boolean;
    desc: string;
  }
}
