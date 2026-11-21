/**
 * 重复日程展开（借鉴 Super Productivity 的 RepeatProjection 思路，MIT；dayjs 化重写）
 *
 * 种子编码约定：
 * - weekly  + by: 'friday' | 'monday' ...
 * - monthly + by: 'day_25' | 'second_wednesday' | 'third_tuesday' | 'last_friday'
 * - range: ['YYYY-MM-DD', 'YYYY-MM-DD']；skip: 例外日期；overrides: 按日期覆写字段（含拖拽改期 new_date / start_time / end_time）
 */
import dayjs from 'dayjs';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, last: -1 };

/** 求某月"第 n 个星期x"（n=-1 表示最后一个），返回 ISO 日期或 null */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): string | null {
  if (nth === -1) {
    let d = dayjs(new Date(year, month + 1, 0));
    while (d.day() !== weekday) {
      d = d.subtract(1, 'day');
    }
    return d.format('YYYY-MM-DD');
  }
  let d = dayjs(new Date(year, month, 1));
  let count = 0;
  while (d.month() === month) {
    if (d.day() === weekday) {
      count += 1;
      if (count === nth) return d.format('YYYY-MM-DD');
    }
    d = d.add(1, 'day');
  }
  return null;
}

/** 解析 by 编码，返回该月内的候选日期 */
function monthlyCandidate(year: number, month: number, by: string): string | null {
  const dayMatch = /^day_(\d{1,2})$/.exec(by);
  if (dayMatch) {
    const day = Number(dayMatch[1]);
    const lastDay = dayjs(new Date(year, month + 1, 0)).date();
    return day <= lastDay ? dayjs(new Date(year, month, day)).format('YYYY-MM-DD') : null;
  }

  const nthMatch = new RegExp(`^(${Object.keys(ORDINALS).join('|')})_(${WEEKDAYS.join('|')})$`).exec(by);
  if (nthMatch) {
    return nthWeekdayOfMonth(year, month, WEEKDAYS.indexOf(nthMatch[2] as (typeof WEEKDAYS)[number]), ORDINALS[nthMatch[1]]);
  }

  return null;
}

/**
 * 展开一条重复事件在 [rangeStart, rangeEnd] 的发生实例
 * 返回带实例 id 的 CalEvent 副本（含 overrides 覆写，支持拖拽跨天 new_date 与改时长 start_time/end_time）
 */
export function expandRecurrence(event: Sct.CalEvent, rangeStart: string, rangeEnd: string): Sct.CalEvent[] {
  const rule = event.recurrence;
  if (!rule) return [];

  // 扫描整个规则周期（或前后扩 1 个月以捕获跨周拖拽后的 new_date），最后再按 effectiveDate 过滤到 [rangeStart, rangeEnd]
  const scanStartStr = rule.range[0] || rangeStart;
  const scanEndStr = rule.range[1] || rangeEnd;
  let start = dayjs(scanStartStr).startOf('day');
  let end = dayjs(scanEndStr).endOf('day');

  const qStart = dayjs(rangeStart).subtract(1, 'month').startOf('day');
  const qEnd = dayjs(rangeEnd).add(1, 'month').endOf('day');
  if (qStart.isAfter(start)) start = qStart;
  if (qEnd.isBefore(end)) end = qEnd;

  if (!start.isValid() || !end.isValid() || start.isAfter(end)) return [];

  const dates: string[] = [];
  let cursor = start.startOf('month');

  while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
    const y = cursor.year();
    const m = cursor.month();
    const monthEnd = cursor.endOf('month');

    if (rule.freq === 'monthly') {
      const candidate = monthlyCandidate(y, m, rule.by);
      if (candidate) {
        const c = dayjs(candidate);
        if (!c.isBefore(start) && !c.isAfter(end)) dates.push(candidate);
      }
    } else if (rule.freq === 'weekly') {
      const weekdayIdx = WEEKDAYS.indexOf(rule.by as (typeof WEEKDAYS)[number]);
      if (weekdayIdx >= 0) {
        let d = cursor.startOf('month');
        while (d.isBefore(monthEnd)) {
          if (d.day() === weekdayIdx) {
            const iso = d.format('YYYY-MM-DD');
            if (!d.isBefore(start) && !d.isAfter(end)) dates.push(iso);
          }
          d = d.add(1, 'day');
        }
      }
    } else {
      break;
    }

    cursor = cursor.add(1, 'month').startOf('month');
  }

  const skipSet = new Set(rule.skip ?? []);
  const overrideMap = new Map((rule.overrides ?? []).map(o => [o.date, o]));

  const occurrences: Sct.CalEvent[] = [];
  for (const date of dates) {
    if (skipSet.has(date)) continue;
    const override = overrideMap.get(date) as (Partial<Sct.CalEvent> & { date: string; new_date?: string }) | undefined;
    const effectiveDate = typeof override?.new_date === 'string' && override.new_date ? override.new_date : date;
    if (effectiveDate < rangeStart || effectiveDate > rangeEnd) continue;

    const instance: Sct.CalEvent = {
      ...event,
      ...((override ?? {}) as Partial<Sct.CalEvent>),
      id: `${event.id}-occ-${date}`,
      date: effectiveDate,
      recurrence: null // 投影实例本身不再带规则
    };
    occurrences.push(instance);
  }
  return occurrences;
}
