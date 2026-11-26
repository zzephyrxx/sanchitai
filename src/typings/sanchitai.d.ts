/**
 * 三尺台 领域类型定义（全局命名空间 Sct）
 *
 * v0.3.0 扩展：成员全生命周期、组织关系转接与转入核查、工作台场景预设与模块开关、
 * 多方案动态党员积分引擎、志愿时长台账、全局隐私脱敏导出。
 */
declare namespace Sct {
  type MemberType = '正式党员' | '预备党员' | '发展对象' | '入党积极分子' | '申请人';

  /** 成员全生命周期状态 */
  type MemberLifecycleStatus =
    | '在册正常'
    | '转出办理中'
    | '转入待核查'
    | '流出党员'
    | '流入党员'
    | '已转出'
    | '停止发展';

  type EventCategory = '组织生活' | '党务常规' | '发展党员' | '品牌活动' | '服务实践' | '工作例会' | '理论学习';

  type EventStatus = '计划' | '进行中' | '已完成' | '已取消';

  type FeeStatus = '已缴' | '欠缴' | '减免' | '未在校';

  type FeeCategory = '学生党员' | '在职党员';

  /** 导出隐私模式：默认脱敏公示版 / 全量报送版 */
  type ExportPrivacyMode = 'masked' | 'full';

  /** 支部场景预设 */
  type BranchSceneKey = 'university_student' | 'university_faculty' | 'gov_enterprise' | 'community_org' | 'minimal';

  /** 模块工坊可开关扩展模块 */
  type OptionalModuleKey = 'seatmap' | 'points' | 'volunteer' | 'birthday';

  /** 花名册场景字段组 */
  type FieldGroupKey = 'university_student' | 'org_workplace' | 'community_grid';

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'text' | 'select';
    options?: string[];
    showInTable?: boolean;
  }

  interface WorkspaceConfig {
    scene: BranchSceneKey;
    enabledModules: Record<OptionalModuleKey, boolean>;
    enabledFieldGroups: Record<FieldGroupKey, boolean>;
    customFields: CustomFieldDef[];
    onboardingCompleted: boolean;
    onboardingVersion: string;
    updatedAt?: string;
  }

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
    /** 支部内统一编号：支部缩写 + 3 位数字 */
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
    /** 宿舍楼栋号（高校学生场景） */
    dorm_building?: string;
    /** 宿舍号（高校学生场景） */
    dorm_room?: string;
    type: MemberType;
    /** 生命周期状态（默认「在册正常」） */
    lifecycle_status?: MemberLifecycleStatus;
    /** 归档/转出生效日期 YYYY-MM-DD */
    archived_at?: string;
    /** 归档原因摘要 */
    archive_reason?: string;
    role: string;
    group: string;
    grade: string;
    level: string;
    major: string;
    /** 班级（高校学生场景） */
    class_name?: string;
    /** 部门 / 科室 / 网格（企事业/教工/社区场景） */
    department?: string;
    /** 岗位 / 职务 / 职称（企事业/教工/社区场景） */
    job_title?: string;
    /** 办公地点 / 居住楼栋（企事业/社区场景） */
    office_location?: string;
    /** 自定义扩展字段值 */
    custom_fields?: Record<string, string>;
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

  /** 组织关系转接 / 转入核查 / 流动党员记录 */
  type TransferDirection = 'out' | 'in' | 'float_out' | 'float_in';
  type TransferStatus = '办理中' | '已完成' | '已取消';
  type TransferMode = '线上系统转接' | '纸质介绍信' | '内部调转';
  type ArchiveDest = '随人事档案' | '个人自提' | '暂存原单位' | '其他';
  type AuditItemState = 'ok' | 'missing' | 'doubt' | 'unchecked';

  interface TransferRecord {
    id: string;
    member_id: string;
    member_name_snapshot?: string;
    direction: TransferDirection;
    status: TransferStatus;
    /** 当前办理步骤（转出 1..4） */
    step?: number;
    initiated_date: string;
    completed_date?: string;
    transfer_mode?: TransferMode;
    /** 接收单位上级组织部门（党委层面） */
    target_committee?: string;
    /** 接收单位具体党支部 */
    target_branch?: string;
    /** 转入来源党组织 / 流动去向地点 */
    source_org?: string;
    /** 是否内部升学/调转 */
    is_internal?: boolean;
    /** 介绍信编号 */
    letter_no?: string;
    /** 党费交至年月 YYYY-MM */
    fee_paid_until?: string;
    /** 党员档案去向 */
    archive_dest?: ArchiveDest;
    /** 回执是否已收回 */
    receipt_received?: boolean;
    receipt_date?: string;
    receipt_no?: string;
    /** 转入档案逐项核查状态 */
    audit_items?: Record<string, AuditItemState>;
    /** 转入档案缺失/存疑备注 */
    audit_notes?: Record<string, string>;
    /** 流动党员定期联系记录 */
    contact_logs?: Array<{ date: string; summary: string }>;
    note?: string;
    updated_at?: string;
    identity?: string;
  }

  /** 志愿时长活动记录 */
  type VolunteerSource = '支部内部' | '校院活动' | '社会公益' | '其他';
  type VolunteerStatus = '已认定' | '待核实';

  interface VolunteerParticipant {
    member_id: string;
    name_snapshot: string;
    hours: number;
    role_note?: string;
  }

  interface VolunteerActivity {
    id: string;
    title: string;
    date: string;
    source: VolunteerSource;
    default_hours: number;
    status: VolunteerStatus;
    /** 可选关联台历/三会一课事件 ID */
    event_id?: string;
    participants: VolunteerParticipant[];
    note?: string;
    created_at: string;
    updated_at?: string;
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

  /** 党员积分四大类别（兼容旧版与新动态引擎） */
  type PointCategory = 'base' | 'duty' | 'bonus' | 'penalty';

  /** 兼容历史 10 个子项编码及任意动态维度 ID */
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
    | 'penalty'
    | (string & {});

  /** 积分条目认定状态（仅「已认定」计入年度总分） */
  type PointVerifyStatus = '已认定' | '待核实' | '未通过';

  /** 积分细则辅助计分模式 */
  type PointCalcMode = 'fixed' | 'count' | 'role_half' | 'hours_20';

  /** 积分/评定方案计分模式：分数制 / 五星评定模型 */
  type PointSchemeMode = 'score' | 'star';

  /** 动态计分维度（大类/分桶） */
  interface PointDimensionDef {
    id: string;
    label: string;
    shortLabel: string;
    /** 兼容归类：base=初始分扣分 / duty=封顶加分 / bonus=不封顶加分 / penalty=直接扣分 */
    category: PointCategory;
    /** 计分方向：deduct_from_base（从初始分扣至0）/ add_capped（0起加至封顶）/ add_uncapped（不封顶加分）/ deduct_direct（直接扣减） */
    mode: 'deduct_from_base' | 'add_capped' | 'add_uncapped' | 'deduct_direct';
    /** 初始分（仅 deduct_from_base 使用） */
    initial_score: number;
    /** 封顶分（deduct_from_base 或 add_capped 使用，null 为不封顶） */
    cap: number | null;
    /** 星级模式下，达到该分值即点亮 1 颗星 */
    star_threshold?: number;
    color: string;
    /** 是否参与全局履职上限封顶 */
    group_cap_key?: string;
  }

  /** 完整积分/评定方案 */
  interface PointScheme {
    id: string;
    name: string;
    description: string;
    scheme_mode: PointSchemeMode;
    pass_line: number;
    /** 星级模式下合格星数（如 3 星） */
    pass_stars?: number;
    enable_veto: boolean;
    /** 可选分组总上限（如履职三大类合计 ≤40） */
    group_caps?: Record<string, number>;
    dimensions: PointDimensionDef[];
    rules: PointRuleItem[];
    builtin?: boolean;
  }

  /** 党员积分考核细则项 */
  interface PointRuleItem {
    id: string;
    category: PointCategory;
    sub_category: PointSubCategory;
    label: string;
    description: string;
    /** 默认分值：扣分项为负数，加分项为正数 */
    default_score: number;
    calc_mode: PointCalcMode;
    unit_label?: string;
    builtin?: boolean;
    enabled?: boolean;
  }

  /** 单条党员积分记录 */
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
    /** 所属细则名称（冗余存储，避免改名后丢失语境） */
    rule_label: string;
    /** 活动内容/事项说明 */
    content: string;
    /** 最终认定分值（扣分为负数，加分为正数） */
    score: number;
    status: PointVerifyStatus;
    /** 来源追踪键（防止从考勤/党费/志愿重复一键导入草稿） */
    source_ref?: string;
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

  /** 年度一票否决记录（开启后基础分归零 / 星级清零） */
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

  /** 单位配置包（.sctpreset）格式 */
  interface UnitPresetPack {
    format: 'sctpreset';
    version: 1;
    exported_at: string;
    name: string;
    description?: string;
    source_branch?: string;
    includes: Array<'scene' | 'point_scheme' | 'custom_fields' | 'doc_templates'>;
    scene?: BranchSceneKey;
    enabled_modules?: Record<OptionalModuleKey, boolean>;
    enabled_field_groups?: Record<FieldGroupKey, boolean>;
    custom_fields?: CustomFieldDef[];
    point_scheme?: PointScheme;
    doc_templates?: DocTemplate[];
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
