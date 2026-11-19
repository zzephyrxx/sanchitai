/**
 * 三尺台 数据中枢 store：IndexedDB（Dexie liveQuery）→ 响应式视图
 *
 * 视图订阅本 store 的 refs；任何写库动作都会实时反映到所有订阅者。
 */
import { computed } from 'vue';
import { defineStore } from 'pinia';
import dayjs from 'dayjs';
import type { EventInput } from '@fullcalendar/core';
import { SetupStoreId } from '@/enum';
import { nanoid } from '@sa/utils';
import { db } from '@/db/db';
import { useDexieLive } from '@/hooks/common/dexie';
import { expandRecurrence } from '@/utils/recurrence';
import { EVENT_CATEGORY_COLORS } from '@/constants/sanchitai';

export const useWorkDataStore = defineStore(SetupStoreId.WorkData, () => {
  /**
   * 深拷贝为纯对象：Pinia/组合式状态读出来的对象都是 reactive proxy，
   * 直接传入 Dexie（structured clone）会抛 DataCloneError（评审轮2 P0-1）。
   * 所有写库入参一律先过 plain()。
   */
  function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  /** 统一写失败提示（评审轮2 P1-3）：禁止静默失败 */
  function guardWrite(promise: Promise<unknown>, what: string): Promise<unknown> {
    return promise.catch(err => {
      // eslint-disable-next-line no-console
      console.error('[sct-write]', what, err);
      window.$message?.error(`保存失败（${what}）：${(err as Error)?.message ?? err}`);
      throw err;
    });
  }

  // ---------------- live 数据 ----------------
  const members = useDexieLive<Sct.Member[]>(() => db.members.toArray(), []);
  const seatMaps = useDexieLive<Sct.SeatMap[]>(() => db.seatMaps.toArray(), []);
  const calEvents = useDexieLive<Sct.CalEvent[]>(() => db.calEvents.toArray(), []);
  const devStages = useDexieLive<Sct.DevStage[]>(() => db.devStages.toArray(), []);
  const feeRecords = useDexieLive<Sct.FeeRecord[]>(() => db.feeRecords.toArray(), []);
  const talks = useDexieLive<Sct.Talk[]>(() => db.talks.toArray(), []);
  const docTemplates = useDexieLive<Sct.DocTemplate[]>(() => db.docTemplates.toArray(), []);
  const docsList = useDexieLive<Sct.Doc[]>(() => db.docs.toArray(), []);
  const attendance = useDexieLive<Sct.Attendance[]>(() => db.attendance.toArray(), []);

  // ---------------- 派生 ----------------
  const memberById = computed(() => new Map(members.value.map(m => [m.id, m])));

  function memberName(id?: string): string {
    if (!id) return '';
    return memberById.value.get(id)?.name ?? id;
  }

  function memberOf(id: string): Sct.Member | undefined {
    return memberById.value.get(id);
  }

  /** 台历事件源：单次事件（范围内）+ 重复事件投影 */
  function eventsInRange(rangeStart: string, rangeEnd: string): Sct.CalEvent[] {
    const singles = calEvents.value.filter(ev => !ev.recurrence && ev.date >= rangeStart && ev.date <= rangeEnd);
    const recurring = calEvents.value.filter(ev => ev.recurrence).flatMap(ev => expandRecurrence(ev, rangeStart, rangeEnd));
    return [...singles, ...recurring];
  }

  /** FullCalendar 事件输入 */
  function fullCalendarEvents(fetchInfo: { start: Date; end: Date }, success: (events: EventInput[]) => void) {
    const start = dayjsOf(fetchInfo.start).format('YYYY-MM-DD');
    const end = dayjsOf(fetchInfo.end).format('YYYY-MM-DD');
    const list: EventInput[] = eventsInRange(start, end).map(ev => ({
      id: ev.id,
      title: displayTitle(ev),
      start: `${ev.date}T${ev.start_time || '00:00'}`,
      end: `${ev.date}T${ev.end_time || ev.start_time || '01:00'}`,
      allDay: !ev.start_time || ev.start_time === ev.end_time,
      backgroundColor: EVENT_CATEGORY_COLORS[ev.category]?.color ?? '#64748b',
      borderColor: 'transparent',
      extendedProps: {
        event: ev,
        recurring: Boolean(calEvents.value.find(base => ev.id.startsWith(`${base.id}-occ-`)))
      }
    }));
    success(list);
  }

  function dayjsOf(d: Date) {
    return dayjs(d);
  }

  function displayTitle(ev: Sct.CalEvent): string {
    const time = ev.start_time && ev.start_time !== ev.end_time ? `${ev.start_time} ` : '';
    const mergedTag = ev.merged_into ? '〔并入〕' : '';
    return `${time}${mergedTag}${ev.title}`;
  }

  // ---------------- 台历 CRUD ----------------
  async function addEvent(input: Partial<Sct.CalEvent> & Pick<Sct.CalEvent, 'title' | 'date' | 'category'>) {
    const id = input.id ?? nanoid(10);
    const row: Sct.CalEvent = {
      status: '计划',
      start_time: '',
      end_time: '',
      ...input,
      id,
      identity: 'secretary'
    };
    await guardWrite(db.calEvents.put(plain(row)), '台历事项');
    return id;
  }

  async function updateEvent(id: string, patch: Partial<Sct.CalEvent>) {
    await guardWrite(db.calEvents.update(id, plain(patch)), '台历事项');
  }

  async function deleteEvent(id: string) {
    await db.calEvents.delete(id);
  }

  async function setEventStatus(id: string, status: Sct.EventStatus) {
    await guardWrite(db.calEvents.update(id, { status }), '事项状态');
  }

  // ---------------- 人员 CRUD ----------------
  async function addMember(input: Partial<Sct.Member> & Pick<Sct.Member, 'name' | 'type'>) {
    const id = input.id ?? `M${nanoid(6)}`;
    const row: Sct.Member = {
      code: id,
      group: '',
      grade: '',
      level: '',
      major: '',
      advisor: '',
      join_date: '',
      full_date: '',
      role: '',
      ...input,
      id,
      identity: 'secretary'
    };
    await guardWrite(db.members.put(plain(row)), '人员');
    return id;
  }

  async function updateMember(id: string, patch: Partial<Sct.Member>) {
    await guardWrite(db.members.update(id, plain(patch)), '人员');
  }

  async function deleteMember(id: string) {
    await db.transaction('rw', [db.members, db.devStages, db.feeRecords], async () => {
      await db.members.delete(id);
      await db.devStages.delete(id);
      await db.feeRecords.where('member_id').equals(id).delete();
    });
  }

  // ---------------- 会议考勤 ----------------
  /** 某会议的考勤行 */
  function attendanceOfEvent(eventId: string): Sct.Attendance[] {
    return attendance.value.filter(a => a.event_id === eventId);
  }

  /** 初始化某会议考勤：正式+预备党员默认"到会" */
  async function initAttendance(eventId: string) {
    const existing = attendanceOfEvent(eventId);
    if (existing.length) return existing;
    const targets = members.value.filter(m => m.type === '正式党员' || m.type === '预备党员');
    const rows: Sct.Attendance[] = targets.map(m => ({
      id: `${eventId}::${m.id}`,
      event_id: eventId,
      member_id: m.id,
      status: '到会',
      identity: 'secretary'
    }));
    await guardWrite(db.attendance.bulkPut(plain(rows)), '会议考勤');
    return rows;
  }

  /** 更新一人考勤状态 */
  async function setAttendance(eventId: string, memberId: string, status: Sct.Attendance['status']) {
    await guardWrite(
      db.attendance.put({
        id: `${eventId}::${memberId}`,
        event_id: eventId,
        member_id: memberId,
        status,
        identity: 'secretary'
      }),
      '会议考勤'
    );
  }

  /** 到会率（应到 = 已记录考勤人数；到会含迟到） */
  function attendanceRate(eventId: string): { present: number; due: number; rate: number } | null {
    const rows = attendanceOfEvent(eventId);
    if (!rows.length) return null;
    const present = rows.filter(r => r.status === '到会' || r.status === '迟到').length;
    return { present, due: rows.length, rate: present / rows.length };
  }

  // ---------------- 发展阶段流转 ----------------
  /** 流转到指定阶段（A13；泳道拖拽与按钮共用） */
  async function moveStageTo(memberId: string, targetStage: string) {
    const member = memberOf(memberId);
    if (!member) return;
    const stage = devStages.value.find(d => d.member_id === memberId);
    const cur = stage?.stage ?? member.type;
    if (cur === targetStage) return;
    const todayStr = new Date().toISOString().slice(0, 10);

    await guardWrite(
      db.transaction('rw', [db.members, db.devStages], async () => {
        await db.members.update(memberId, plain({ type: targetStage as Sct.MemberType }));
        await db.devStages.put(
          plain({
            member_id: memberId,
            stage: targetStage,
            stage_date: todayStr,
            next_node: targetStage === '正式党员' ? '材料归档' : stage?.next_node,
            next_due: stage?.next_due,
            materials: stage?.materials ?? [],
            timeline: [...(stage?.timeline ?? []), { node: `确定为${targetStage}`, date: todayStr, note: '阶段流转' }],
            identity: 'secretary'
          })
        );
      }),
      '阶段流转'
    );
    window.$message?.success(`${member.name} 已流转到「${targetStage}」`);
  }

  /** 流转到下一阶段 */
  async function advanceStage(memberId: string) {
    const member = memberOf(memberId);
    if (!member) return;
    const stage = devStages.value.find(d => d.member_id === memberId);
    const order: string[] = ['申请人', '入党积极分子', '发展对象', '预备党员', '正式党员'];
    const cur = stage?.stage ?? member.type;
    const idx = order.indexOf(cur);
    if (idx < 0 || idx >= order.length - 1) {
      window.$message?.warning('已是最终阶段');
      return;
    }
    await moveStageTo(memberId, order[idx + 1]);
  }

  /** 更新发展台账字段（节点推进等） */
  async function updateDevStage(memberId: string, patch: Partial<Sct.DevStage>) {
    await guardWrite(db.devStages.update(memberId, plain(patch)), '发展台账');
  }

  // ---------------- 谈心谈话 ----------------
  async function addTalk(input: Partial<Sct.Talk> & Pick<Sct.Talk, 'date' | 'member_ids' | 'content'>) {
    const id = input.id ?? `tk-${nanoid(8)}`;
    await guardWrite(db.talks.put(plain({ ...input, id, identity: 'secretary' } as Sct.Talk)), '谈话记录');
    return id;
  }

  async function deleteTalk(id: string) {
    await db.talks.delete(id);
  }

  // ---------------- 文档 ----------------
  async function addDoc(input: Partial<Sct.Doc> & Pick<Sct.Doc, 'title' | 'body' | 'created_at'>) {
    const id = input.id ?? `doc-${nanoid(8)}`;
    await guardWrite(db.docs.put(plain({ ...input, id, identity: 'secretary' } as Sct.Doc)), '文档');
    return id;
  }

  async function deleteDoc(id: string) {
    await db.docs.delete(id);
  }

  return {
    members,
    seatMaps,
    calEvents,
    devStages,
    feeRecords,
    talks,
    docTemplates,
    docsList,
    attendance,
    attendanceOfEvent,
    initAttendance,
    setAttendance,
    attendanceRate,
    advanceStage,
    moveStageTo,
    updateDevStage,
    addTalk,
    deleteTalk,
    addDoc,
    deleteDoc,
    memberById,
    memberName,
    memberOf,
    eventsInRange,
    fullCalendarEvents,
    addEvent,
    updateEvent,
    deleteEvent,
    setEventStatus,
    addMember,
    updateMember,
    deleteMember
  };
});
