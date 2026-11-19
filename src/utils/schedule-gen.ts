/**
 * 三会一课学期排期生成（依据《中国共产党支部工作条例（试行）》默认频次，可自定义参数）
 *
 * 幂等约束（A10）：以学期 meta 标记 + 同学期已生成事项去重。
 */
import dayjs from 'dayjs';

export interface GenParams {
  semesterLabel: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  /** 支委会：每月第 N 个星期 W（默认第二个周三）14:00-16:00 */
  committeeNth: number;
  committeeWeekday: number; // 0=周日
  /** 主题党日：每月第 N 个星期 W（默认第三个周五）14:00-15:00 */
  partyDayNth: number;
  partyDayWeekday: number;
  /** 党员大会：每季度末月（默认 12/3/6/9 月）第 N 个星期 W 16:30-18:00 */
  assemblyNth: number;
  assemblyWeekday: number;
  /** 党课并入党员大会（默认 true，A4 合并计数） */
  lessonMergedIntoAssembly: boolean;
}

export interface GenDraftEvent {
  id: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  category: Sct.EventCategory;
  kind: string;
  agenda: string[];
  merged_into?: string;
  note?: string;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 求某月第 n 个 weekday（n 从 1 起） */
export function nthWeekdayOf(y: number, m: number, weekday: number, nth: number): string | null {
  let d = dayjs(new Date(y, m, 1));
  let count = 0;
  while (d.month() === m) {
    if (d.day() === weekday) {
      count += 1;
      if (count === nth) return d.format('YYYY-MM-DD');
    }
    d = d.add(1, 'day');
  }
  return null;
}

function eachMonth(start: string, end: string, cb: (y: number, m: number) => void) {
  let cursor = dayjs(start).startOf('month');
  const endD = dayjs(end);
  while (cursor.isBefore(endD) || cursor.isSame(endD, 'month')) {
    cb(cursor.year(), cursor.month());
    cursor = cursor.add(1, 'month').startOf('month');
  }
}

function inRange(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

/** 生成学期排期草稿 */
export function generateSemesterDrafts(p: GenParams): GenDraftEvent[] {
  const drafts: GenDraftEvent[] = [];
  const committeeLabel = `每月第${p.committeeNth}个${WEEKDAY_CN[p.committeeWeekday]}`;
  const partyDayLabel = `每月第${p.partyDayNth}个${WEEKDAY_CN[p.partyDayWeekday]}`;
  const assemblyLabel = `每季度末月第${p.assemblyNth}个${WEEKDAY_CN[p.assemblyWeekday]}`;

  eachMonth(p.start, p.end, (y, m) => {
    // 支委会（每月 1 次）
    const cDate = nthWeekdayOf(y, m, p.committeeWeekday, p.committeeNth);
    if (cDate && inRange(cDate, p.start, p.end)) {
      drafts.push({
        id: `gen-${cDate}-committee`,
        title: `支部委员会（${dayjs(cDate).format('M月')}）`,
        date: cDate,
        start_time: '14:00',
        end_time: '16:00',
        location: '研究生楼508',
        category: '组织生活',
        kind: '支委会',
        agenda: ['审议本月工作安排', '上月任务销号'],
        note: `学期排期（${p.semesterLabel}）规则：${committeeLabel}`
      });
    }

    // 主题党日（每月 1 天）
    const pdDate = nthWeekdayOf(y, m, p.partyDayWeekday, p.partyDayNth);
    if (pdDate && inRange(pdDate, p.start, p.end)) {
      drafts.push({
        id: `gen-${pdDate}-partyday`,
        title: `主题党日（${dayjs(pdDate).format('M月')}）`,
        date: pdDate,
        start_time: '14:00',
        end_time: '15:00',
        location: '教六1115',
        category: '组织生活',
        kind: '主题党日',
        agenda: ['主题学习', '交流研讨'],
        note: `学期排期（${p.semesterLabel}）规则：${partyDayLabel}`
      });
    }

    // 党员大会（每季度末月）+ 党课并入
    if ([2, 5, 8, 11].includes(m)) {
      const aDate = nthWeekdayOf(y, m, p.assemblyWeekday, p.assemblyNth);
      if (aDate && inRange(aDate, p.start, p.end)) {
        const assemblyId = `gen-${aDate}-assembly`;
        drafts.push({
          id: assemblyId,
          title: `支部党员大会（${dayjs(aDate).format('M月')}）`,
          date: aDate,
          start_time: '16:30',
          end_time: '18:00',
          location: '教六1115',
          category: '组织生活',
          kind: '党员大会',
          agenda: ['传达上级精神', '审议支部事项'],
          note: `学期排期（${p.semesterLabel}）规则：${assemblyLabel}`
        });
        if (p.lessonMergedIntoAssembly) {
          drafts.push({
            id: `gen-${aDate}-lesson`,
            title: `党课（并入本月党员大会）`,
            date: aDate,
            start_time: '17:10',
            end_time: '18:00',
            location: '教六1115',
            category: '组织生活',
            kind: '党课',
            agenda: ['专题党课'],
            merged_into: assemblyId,
            note: `学期排期（${p.semesterLabel}）：并入党员大会，不计入当月线下会议次数`
          });
        }
      }
    }
  });

  return drafts;
}

/** 草稿事件 → 落库事件（id 已在草稿中稳定分配，保证幂等） */
export function draftToEvent(draft: GenDraftEvent, identity: string): Sct.CalEvent {
  return {
    id: draft.id,
    title: draft.title,
    date: draft.date,
    start_time: draft.start_time,
    end_time: draft.end_time,
    location: draft.location,
    category: draft.category,
    kind: draft.kind,
    agenda: draft.agenda,
    recurrence: null,
    status: '计划',
    merged_into: draft.merged_into,
    note: draft.note,
    identity
  };
}
