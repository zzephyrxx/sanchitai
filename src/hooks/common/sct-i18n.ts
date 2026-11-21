/**
 * 三尺台全站双语映射与辅助工具（响应式跟随 appStore.locale）
 */
import { computed } from 'vue';
import { useAppStore } from '@/store/modules/app';

const MEMBER_TYPE_EN: Record<string, string> = {
  正式党员: 'Full Member',
  预备党员: 'Probationary',
  发展对象: 'Candidate',
  入党积极分子: 'Activist',
  申请人: 'Applicant'
};

const EVENT_CATEGORY_EN: Record<string, string> = {
  组织生活: 'Org Life',
  党务常规: 'Routine',
  发展党员: 'Development',
  品牌活动: 'Brand Event',
  服务实践: 'Service',
  工作例会: 'Meeting',
  理论学习: 'Study'
};

const EVENT_STATUS_EN: Record<string, string> = {
  计划: 'Planned',
  进行中: 'In Progress',
  已完成: 'Completed',
  已取消: 'Cancelled'
};

const FEE_STATUS_EN: Record<string, string> = {
  已缴: 'Paid',
  欠缴: 'Overdue',
  减免: 'Exempt',
  未在校: 'Off-campus'
};

const FEE_CATEGORY_EN: Record<string, string> = {
  学生党员: 'Student',
  在职党员: 'In-service'
};

const KNOWLEDGE_CAT_EN: Record<string, string> = {
  全部: 'All',
  支部建设: 'Branch Building',
  组织生活: 'Org Life',
  发展党员: 'Development',
  党员教育管理: 'Member Education',
  党费与党务公开: 'Dues & Disclosure',
  纪律与处分: 'Discipline'
};

const MEETING_KIND_EN: Record<string, string> = {
  党员大会: 'General Assembly',
  支委会: 'Committee Meeting',
  党小组会: 'Group Meeting',
  党课: 'Party Lecture',
  主题党日: 'Theme Party Day',
  组织生活会: 'Org Life Meeting',
  民主评议: 'Democratic Review'
};

const TALK_TYPE_EN: Record<string, string> = {
  日常谈心: 'Regular Talk',
  入党申请谈话: 'Applicant Talk',
  积极分子考察谈话: 'Activist Review',
  发展对象政治审查谈话: 'Candidate Vetting',
  预备党员接收谈话: 'Probation Intake',
  预备党员转正谈话: 'Full Member Intake',
  关怀帮扶谈话: 'Care & Support',
  提醒诫勉谈话: 'Reminder Talk'
};

export function useSctI18n() {
  const appStore = useAppStore();
  const isEn = computed(() => appStore.locale === 'en-US');

  /** 中英双语快捷切换 */
  function bi(zh: string, en: string): string {
    return isEn.value ? en : zh;
  }

  function tMemberType(type: string): string {
    return isEn.value ? (MEMBER_TYPE_EN[type] ?? type) : type;
  }

  function tCategory(cat: string): string {
    return isEn.value ? (EVENT_CATEGORY_EN[cat] ?? cat) : cat;
  }

  function tEventStatus(status: string): string {
    return isEn.value ? (EVENT_STATUS_EN[status] ?? status) : status;
  }

  function tFeeStatus(status: string): string {
    return isEn.value ? (FEE_STATUS_EN[status] ?? status) : status;
  }

  function tFeeCategory(cat?: string): string {
    const key = cat ?? '学生党员';
    return isEn.value ? (FEE_CATEGORY_EN[key] ?? key) : key;
  }

  function tKnowledgeCat(cat: string): string {
    return isEn.value ? (KNOWLEDGE_CAT_EN[cat] ?? cat) : cat;
  }

  function tMeetingKind(kind?: string): string {
    if (!kind) return '';
    return isEn.value ? (MEETING_KIND_EN[kind] ?? kind) : kind;
  }

  function tTalkType(type?: string): string {
    if (!type) return '';
    return isEn.value ? (TALK_TYPE_EN[type] ?? type) : type;
  }

  return {
    isEn,
    bi,
    tMemberType,
    tCategory,
    tEventStatus,
    tFeeStatus,
    tFeeCategory,
    tKnowledgeCat,
    tMeetingKind,
    tTalkType
  };
}
