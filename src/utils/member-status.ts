/**
 * 党员身份自动计算工具（纯函数）
 *
 * 规则：
 * - 入党时间（join_date）为接收为预备党员之日；默认预备期满日（转正时间）为入党时间 + 1 年。
 * - 当存在转正时间（full_date）或入党时间（join_date）时，自动按当前日期判定身份：
 *   - 有效转正时间 <= 今日 → 正式党员（无需手动确认）
 *   - 有效转正时间 > 今日  → 预备党员
 * - 若均未填写，则保留用户选择的非党员/发展阶段类型（申请人 / 入党积极分子 / 发展对象等）。
 */
import dayjs from 'dayjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value?: string | null): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return DATE_RE.test(trimmed) && dayjs(trimmed).isValid();
}

/** 根据入党时间推算默认转正时间（满 1 年） */
export function computeDefaultFullDate(joinDate?: string | null): string {
  if (!isValidIsoDate(joinDate)) return '';
  return dayjs(joinDate.trim()).add(1, 'year').format('YYYY-MM-DD');
}

/** 解析有效转正时间：优先显式 full_date，其次历史 probation_end，最后按入党时间 + 1 年推算 */
export function resolveEffectiveFullDate(
  joinDate?: string | null,
  fullDate?: string | null,
  probationEnd?: string | null
): string {
  if (isValidIsoDate(fullDate)) return fullDate.trim();
  if (isValidIsoDate(probationEnd)) return probationEnd.trim();
  return computeDefaultFullDate(joinDate);
}

/** 是否已具备自动计算党员身份的日期条件 */
export function isPartyStatusAutoComputed(joinDate?: string | null, fullDate?: string | null): boolean {
  return isValidIsoDate(joinDate) || isValidIsoDate(fullDate);
}

/** 根据入党时间与转正时间自动计算成员身份 */
export function resolveMemberTypeByDates(
  baseType: Sct.MemberType,
  joinDate?: string | null,
  fullDate?: string | null,
  today: string = dayjs().format('YYYY-MM-DD')
): Sct.MemberType {
  const hasJoin = isValidIsoDate(joinDate);
  const hasFull = isValidIsoDate(fullDate);
  if (!hasJoin && !hasFull) return baseType;

  const effectiveFull = hasFull ? fullDate.trim() : computeDefaultFullDate(joinDate);
  if (effectiveFull && effectiveFull <= today) {
    return '正式党员';
  }
  return '预备党员';
}

export interface PartyStatusRuleInfo {
  computedType: Sct.MemberType | null;
  effectiveFullDate: string;
  reasonZh: string;
  reasonEn: string;
}

/** 生成表单中的实时身份计算说明 */
export function describePartyStatusRule(
  joinDate?: string | null,
  fullDate?: string | null,
  today: string = dayjs().format('YYYY-MM-DD')
): PartyStatusRuleInfo {
  if (!isPartyStatusAutoComputed(joinDate, fullDate)) {
    return {
      computedType: null,
      effectiveFullDate: '',
      reasonZh: '填写「入党时间」或「转正时间」后，系统将自动判定预备/正式党员身份，无需手动确认',
      reasonEn: 'Fill Join Date or Regularization Date to auto-compute Probationary / Full Member status'
    };
  }
  const effectiveFullDate = resolveEffectiveFullDate(joinDate, fullDate);
  const computedType = resolveMemberTypeByDates('预备党员', joinDate, fullDate, today);
  if (computedType === '正式党员') {
    return {
      computedType,
      effectiveFullDate,
      reasonZh: `转正时间（${effectiveFullDate}）已届满，自动判定为「正式党员」`,
      reasonEn: `Regularization date (${effectiveFullDate}) reached — auto-computed as Full Member`
    };
  }
  return {
    computedType,
    effectiveFullDate,
    reasonZh: `预备期至 ${effectiveFullDate}，当前自动判定为「预备党员」（期满自动转为正式党员）`,
    reasonEn: `Probation until ${effectiveFullDate} — auto-computed as Probationary Member`
  };
}

/** 归一化成员记录：补全转正时间与 key_dates.probation_end，并计算身份 */
export function normalizeMemberRecord(member: Sct.Member, today: string = dayjs().format('YYYY-MM-DD')): Sct.Member {
  const joinDate = isValidIsoDate(member.join_date) ? member.join_date.trim() : '';
  const rawFull = isValidIsoDate(member.full_date) ? member.full_date.trim() : '';
  const probationEnd = member.key_dates?.probation_end;
  const effectiveFull = resolveEffectiveFullDate(joinDate, rawFull, probationEnd);

  if (!joinDate && !rawFull) {
    return {
      ...member,
      join_date: '',
      full_date: ''
    };
  }

  const nextType = resolveMemberTypeByDates(member.type, joinDate, effectiveFull, today);
  const nextKeyDates: Record<string, string> = { ...member.key_dates };
  if (nextType === '预备党员' && effectiveFull) {
    nextKeyDates.probation_end = effectiveFull;
  } else if (nextType === '正式党员' && nextKeyDates.probation_end) {
    delete nextKeyDates.probation_end;
  }

  return {
    ...member,
    type: nextType,
    join_date: joinDate,
    full_date: effectiveFull,
    key_dates: nextKeyDates
  };
}
