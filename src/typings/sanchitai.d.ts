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
    body: string;
    created_at: string;
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

  interface IdentityOption {
    id: string;
    name: string;
    available: boolean;
    desc: string;
  }
}
