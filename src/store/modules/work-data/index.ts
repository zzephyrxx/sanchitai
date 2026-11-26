/**
 * 三尺台 数据中枢 store：IndexedDB（Dexie liveQuery）→ 响应式视图
 *
 * 视图订阅本 store 的 refs；任何写库动作都会实时反映到所有订阅者。
 */
import { computed, watch } from 'vue';
import { defineStore } from 'pinia';
import dayjs from 'dayjs';
import type { EventInput } from '@fullcalendar/core';
import { nanoid } from '@sa/utils';
import { computeNextDevNode, findMatchedMaterial, nodesOfStage } from '@/constants/dev-nodes';
import type { DevNodeDef } from '@/constants/dev-nodes';
import { DEFAULT_POINT_RULES, buildUni6040Scheme } from '@/constants/party-points';
import { EVENT_CATEGORY_COLORS, FEE_STANDARD } from '@/constants/sanchitai';
import {
  DEFAULT_BRANCH_NAME,
  getMemberLifecycle,
  isMemberActive,
  isMemberArchived,
  isMemberFloating,
  isMemberInBranchRoster,
  loadWorkspaceConfigSync,
  normalizeWorkspaceConfig,
  persistWorkspaceConfigSync
} from '@/constants/workspace-presets';
import { formatMemberCode, generateNextMemberCode, getBranchAbbreviation } from '@/utils/member-code';
import type { DuplicateStrategy, ImportPreviewRow } from '@/utils/member-import';
import { computeDefaultFullDate, normalizeMemberRecord } from '@/utils/member-status';
import { expandRecurrence } from '@/utils/recurrence';
import { useDexieLive } from '@/hooks/common/dexie';
import { db, pushBackupRing } from '@/db/db';
import { DEFAULT_DOC_TEMPLATES } from '@/db/seed';
import { SetupStoreId } from '@/enum';

/** 流转到新阶段时，按节点库初始化该阶段材料清单（未开始），保留已有材料状态 */
function buildStageMaterials(targetStage: string, prevMaterials: Sct.DevMaterial[]): Sct.DevMaterial[] {
  const result = [...prevMaterials];
  nodesOfStage(targetStage).forEach((node: DevNodeDef) => {
    node.materials.forEach(m => {
      const exists = result.some(r => r.name.includes(m.slice(0, 5)) || m.includes(r.name.slice(0, 5)));
      if (!exists) {
        result.push({ no: node.no, name: m, status: '未开始', date: '' });
      }
    });
  });
  return result;
}

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
  const pointRecords = useDexieLive<Sct.PointRecord[]>(() => db.pointRecords.toArray(), []);
  const pointVetoes = useDexieLive<Sct.PointVeto[]>(() => db.pointVetoes.toArray(), []);
  const transferRecords = useDexieLive<Sct.TransferRecord[]>(() => db.transferRecords.toArray(), []);
  const volunteerActivities = useDexieLive<Sct.VolunteerActivity[]>(() => db.volunteerActivities.toArray(), []);
  const pointRulesRow = useDexieLive<{ key: string; value: unknown } | undefined>(
    () => db.meta.get('point-rules'),
    undefined
  );
  const workspaceConfigRow = useDexieLive<{ key: string; value: unknown } | undefined>(
    () => db.meta.get('workspace-config'),
    undefined
  );
  const partyGroupsRow = useDexieLive<{ key: string; value: unknown } | undefined>(
    () => db.meta.get('party-groups'),
    undefined
  );
  const youthSlotsRow = useDexieLive<{ key: string; value: unknown } | undefined>(
    () => db.meta.get('youth-committee-slots'),
    undefined
  );
  const branchNameRow = useDexieLive<{ key: string; value: unknown } | undefined>(
    () => db.meta.get('branch-name'),
    undefined
  );

  const workspaceConfig = computed<Sct.WorkspaceConfig>(() => {
    if (workspaceConfigRow.value?.value) {
      return normalizeWorkspaceConfig(workspaceConfigRow.value.value);
    }
    return loadWorkspaceConfigSync();
  });

  watch(
    workspaceConfig,
    cfg => {
      persistWorkspaceConfigSync(cfg);
    },
    { immediate: true, deep: true }
  );

  const pointRules = computed<Sct.PointRuleItem[]>(() => {
    const val = pointRulesRow.value?.value;
    if (Array.isArray(val) && val.length > 0) {
      return val as Sct.PointRuleItem[];
    }
    return DEFAULT_POINT_RULES;
  });

  const activePointScheme = computed<Sct.PointScheme>(() => buildUni6040Scheme(pointRules.value));

  const partyGroupNames = computed<string[]>(() => {
    const saved = Array.isArray(partyGroupsRow.value?.value)
      ? (partyGroupsRow.value.value as string[]).map(s => String(s).trim()).filter(Boolean)
      : [];
    const fromMembers = members.value.map(m => (m.group ?? '').trim()).filter(Boolean);
    const merged = Array.from(new Set([...saved, ...fromMembers]));
    return merged.length > 0 ? merged : ['第一党小组', '第二党小组'];
  });

  const youthCommitteeSlots = computed<Sct.YouthCommitteeSlot[]>(() => {
    const val = youthSlotsRow.value?.value;
    if (Array.isArray(val)) {
      return val as Sct.YouthCommitteeSlot[];
    }
    return [];
  });

  const branchName = computed(() => {
    const val = branchNameRow.value?.value;
    return typeof val === 'string' && val.trim() ? val.trim() : DEFAULT_BRANCH_NAME;
  });

  // ---------------- 生命周期派生名单 ----------------
  const activeMembers = computed(() => members.value.filter(m => isMemberActive(m)));
  const inBranchRosterMembers = computed(() => members.value.filter(m => isMemberInBranchRoster(m)));
  const archivedMembers = computed(() => members.value.filter(m => isMemberArchived(m)));
  const transferringOutMembers = computed(() => members.value.filter(m => getMemberLifecycle(m) === '转出办理中'));
  const incomingAuditMembers = computed(() => members.value.filter(m => getMemberLifecycle(m) === '转入待核查'));
  const floatingMembers = computed(() => members.value.filter(m => isMemberFloating(m)));

  async function setBranchName(name: string) {
    const clean = name.trim();
    if (!clean) {
      window.$message?.warning('支部名称不能为空');
      return;
    }
    const prevName = branchName.value;
    const prevPrefix = getBranchAbbreviation(prevName);
    const nextPrefix = getBranchAbbreviation(clean);
    await guardWrite(db.meta.put({ key: 'branch-name', value: clean }), '支部名称');

    // 同步更新默认支部名称与沿用旧支部缩写的成员编号
    if (prevName !== clean) {
      const prevCodeRe = new RegExp(`^${prevPrefix}(\\d+)$`, 'i');
      const all = await db.members.toArray();
      const updatedRows = all
        .map(m => {
          let changed = false;
          const nextRow = { ...m };
          if (!nextRow.branch_name || nextRow.branch_name === prevName) {
            nextRow.branch_name = clean;
            changed = true;
          }
          const match = (nextRow.code ?? '').trim().match(prevCodeRe);
          if (match && prevPrefix !== nextPrefix) {
            nextRow.code = formatMemberCode(nextPrefix, Number(match[1]));
            changed = true;
          }
          return changed ? nextRow : null;
        })
        .filter((row): row is Sct.Member => row !== null);

      if (updatedRows.length) {
        await guardWrite(db.members.bulkPut(plain(updatedRows)), '支部编号同步');
      }
    }
  }

  function memberMonthlyFee(member?: Sct.Member): number {
    if (!member) return FEE_STANDARD.studentMonthly;
    if (typeof member.fee_monthly === 'number' && !Number.isNaN(member.fee_monthly) && member.fee_monthly >= 0) {
      return member.fee_monthly;
    }
    return FEE_STANDARD.studentMonthly;
  }

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
    const recurring = calEvents.value
      .filter(ev => ev.recurrence)
      .flatMap(ev => expandRecurrence(ev, rangeStart, rangeEnd));
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

  function parseOccurrenceId(id: string): { baseId: string; occDate: string } | null {
    let sep: string | null = null;
    if (id.includes('-occ-')) {
      sep = '-occ-';
    } else if (id.includes('~occ~')) {
      sep = '~occ~';
    }
    if (!sep) return null;
    const [baseId, occDate] = id.split(sep);
    return baseId && occDate ? { baseId, occDate } : null;
  }

  async function updateEvent(id: string, patch: Partial<Sct.CalEvent>) {
    const parsed = parseOccurrenceId(id);
    if (parsed) {
      const { baseId, occDate } = parsed;
      const base = await db.calEvents.get(baseId);
      if (!base || !base.recurrence) return;
      const overrides = [...(base.recurrence.overrides ?? [])];
      const idx = overrides.findIndex(o => o.date === occDate);
      const nextOverride: { date: string; [key: string]: unknown } = {
        ...(idx >= 0 ? overrides[idx] : {}),
        ...plain(patch),
        date: occDate
      };
      if (patch.date) {
        nextOverride.new_date = patch.date;
      }
      if (idx >= 0) {
        overrides[idx] = nextOverride;
      } else {
        overrides.push(nextOverride);
      }
      await guardWrite(
        db.calEvents.put(
          plain({
            ...base,
            recurrence: {
              ...base.recurrence,
              overrides
            }
          })
        ),
        '台历重复事项'
      );
      return;
    }

    const existing = await db.calEvents.get(id);
    if (existing) {
      await guardWrite(db.calEvents.put(plain({ ...existing, ...patch, id })), '台历事项');
    } else {
      await guardWrite(db.calEvents.update(id, plain(patch)), '台历事项');
    }
  }

  async function deleteEvent(id: string) {
    const parsed = parseOccurrenceId(id);
    const baseId = parsed ? parsed.baseId : id;
    await db.calEvents.delete(baseId);
  }

  async function setEventStatus(id: string, status: Sct.EventStatus) {
    await updateEvent(id, { status });
  }

  // ---------------- 人员 CRUD ----------------
  async function addMember(input: Partial<Sct.Member> & Pick<Sct.Member, 'name' | 'type'>) {
    if (!input.name?.trim()) {
      window.$message?.warning('姓名必填');
      throw new Error('姓名必填');
    }
    const id = input.id ?? `M${nanoid(6)}`;
    const todayStr = dayjs().format('YYYY-MM-DD');
    const targetBranch = input.branch_name?.trim() || branchName.value;
    const existingCodes = members.value.map(m => m.code);
    const autoCode = input.code?.trim() || generateNextMemberCode(targetBranch, existingCodes);
    const draft: Sct.Member = {
      student_id: '',
      gender: '',
      ethnicity: '',
      birth_date: '',
      dorm_building: '',
      dorm_room: '',
      class_name: '',
      department: '',
      job_title: '',
      office_location: '',
      custom_fields: {},
      id_card: '',
      phone: '',
      group: '',
      grade: '',
      level: '',
      major: '',
      advisor: '',
      join_date: '',
      full_date: '',
      role: '',
      lifecycle_status: '在册正常',
      fee_category: '学生党员',
      fee_monthly: FEE_STANDARD.studentMonthly,
      ...input,
      id,
      code: autoCode,
      branch_name: targetBranch,
      identity: 'secretary'
    };
    const row = normalizeMemberRecord(draft, todayStr);
    const stageDate =
      row.type === '正式党员'
        ? row.full_date || todayStr
        : row.type === '预备党员'
          ? row.join_date || todayStr
          : todayStr;

    await guardWrite(
      db.transaction('rw', [db.members, db.devStages], async () => {
        await db.members.put(plain(row));
        await db.devStages.put(
          plain({
            member_id: id,
            stage: row.type,
            stage_date: stageDate,
            next_node: row.type === '正式党员' ? '材料归档' : undefined,
            next_due: row.type === '预备党员' ? row.full_date || undefined : undefined,
            materials: buildStageMaterials(row.type, []),
            timeline: [{ node: `录入成员（${row.type}）`, date: stageDate }],
            identity: 'secretary'
          })
        );
      }),
      '人员'
    );
    return id;
  }

  async function updateMember(id: string, patch: Partial<Sct.Member>) {
    const touchesPartyDatesOrType = 'join_date' in patch || 'full_date' in patch || 'type' in patch;
    if (!touchesPartyDatesOrType) {
      await guardWrite(db.members.update(id, plain(patch)), '人员');
      return;
    }

    const existing = await db.members.get(id);
    if (!existing) {
      await guardWrite(db.members.update(id, plain(patch)), '人员');
      return;
    }

    const todayStr = dayjs().format('YYYY-MM-DD');
    const merged: Sct.Member = {
      ...existing,
      ...plain(patch),
      id
    };
    const next = normalizeMemberRecord(merged, todayStr);
    const typeChanged = next.type !== existing.type;

    await guardWrite(
      db.transaction('rw', [db.members, db.devStages], async () => {
        await db.members.put(plain(next));
        if (typeChanged) {
          const prevStage = await db.devStages.get(id);
          const stageDate =
            next.type === '正式党员'
              ? next.full_date || todayStr
              : next.type === '预备党员'
                ? next.join_date || todayStr
                : todayStr;
          await db.devStages.put(
            plain({
              member_id: id,
              stage: next.type,
              stage_date: stageDate,
              next_node: next.type === '正式党员' ? '材料归档' : prevStage?.next_node,
              next_due: next.type === '预备党员' ? next.full_date || prevStage?.next_due : undefined,
              materials: buildStageMaterials(next.type, prevStage?.materials ?? []),
              timeline: [
                ...(prevStage?.timeline ?? []),
                {
                  node: `身份更新为${next.type}`,
                  date: todayStr,
                  note: next.join_date || next.full_date ? '按入党/转正时间自动计算' : '成员信息编辑'
                }
              ],
              identity: 'secretary'
            })
          );
        }
      }),
      '人员'
    );
  }

  /** 检测成员是否存在历史台账记录（有历史记录则拦截物理删除，引导走关系转出/归档） */
  async function canHardDeleteMember(memberId: string): Promise<{ allowed: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const [feeCnt, attCnt, ptCnt, vetoCnt, tfCnt, devRow, allTalks, allVols, allDocs] = await Promise.all([
      db.feeRecords.where('member_id').equals(memberId).count(),
      db.attendance.where('member_id').equals(memberId).count(),
      db.pointRecords.where('member_id').equals(memberId).count(),
      db.pointVetoes.where('member_id').equals(memberId).count(),
      db.transferRecords.where('member_id').equals(memberId).count(),
      db.devStages.get(memberId),
      db.talks.toArray(),
      db.volunteerActivities.toArray(),
      db.docs.toArray()
    ]);
    if (feeCnt > 0) reasons.push(`党费记录 ${feeCnt} 条`);
    if (attCnt > 0) reasons.push(`会议考勤 ${attCnt} 条`);
    if (ptCnt > 0) reasons.push(`积分记录 ${ptCnt} 条`);
    if (vetoCnt > 0) reasons.push(`一票否决记录 ${vetoCnt} 条`);
    if (tfCnt > 0) reasons.push(`组织关系转接记录 ${tfCnt} 条`);
    const talkCnt = allTalks.filter(t => t.member_ids.includes(memberId)).length;
    if (talkCnt > 0) reasons.push(`谈心谈话 ${talkCnt} 条`);
    const volCnt = allVols.filter(v => v.participants.some(p => p.member_id === memberId)).length;
    if (volCnt > 0) reasons.push(`志愿服务 ${volCnt} 场`);
    const docCnt = allDocs.filter(d => d.member_id === memberId).length;
    if (docCnt > 0) reasons.push(`关联公文材料 ${docCnt} 篇`);
    const archivedMats = (devRow?.materials ?? []).filter(m => m.status === '已归档').length;
    if (archivedMats > 0) reasons.push(`已归档发展材料 ${archivedMats} 项`);
    return { allowed: reasons.length === 0, reasons };
  }

  async function deleteMember(id: string, force = false) {
    if (!force) {
      const check = await canHardDeleteMember(id);
      if (!check.allowed) {
        window.$message?.warning(
          `该成员存在历史台账（${check.reasons.join('、')}），为保证账实相符禁止直接删除，请使用「关系转出」或「停止发展归档」`
        );
        return false;
      }
    }
    await guardWrite(
      db.transaction(
        'rw',
        [
          db.members,
          db.devStages,
          db.feeRecords,
          db.attendance,
          db.pointRecords,
          db.pointVetoes,
          db.transferRecords,
          db.meta
        ],
        async () => {
          await db.members.delete(id);
          await db.devStages.delete(id);
          await db.feeRecords.where('member_id').equals(id).delete();
          await db.attendance.where('member_id').equals(id).delete();
          await db.pointRecords.where('member_id').equals(id).delete();
          await db.pointVetoes.where('member_id').equals(id).delete();
          await db.transferRecords.where('member_id').equals(id).delete();
          const youthRow = await db.meta.get('youth-committee-slots');
          if (Array.isArray(youthRow?.value)) {
            const slots = youthRow.value as Sct.YouthCommitteeSlot[];
            if (slots.some(s => s.member_id === id)) {
              await db.meta.put({
                key: 'youth-committee-slots',
                value: slots.map(s => (s.member_id === id ? { ...s, member_id: null } : s))
              });
            }
          }
        }
      ),
      '删除人员'
    );
    return true;
  }

  /** 批量导入成员（导入前自动创建本地快照；支持跳过 / 合并更新 / 追加） */
  async function bulkImportMembers(
    rows: ImportPreviewRow[],
    strategy: DuplicateStrategy,
    options: { hasTypeMapping?: boolean } = {}
  ): Promise<{ inserted: number; updated: number; skipped: number }> {
    const validRows = rows.filter(r => r.errors.length === 0 && r.data.name.trim());
    if (!validRows.length) {
      return { inserted: 0, updated: 0, skipped: 0 };
    }

    await pushBackupRing();
    const todayStr = dayjs().format('YYYY-MM-DD');
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    await guardWrite(
      db.transaction('rw', [db.members, db.devStages], async () => {
        const currentMembers = await db.members.toArray();
        const byStudentId = new Map<string, Sct.Member>();
        const byCode = new Map<string, Sct.Member>();
        const byName = new Map<string, Sct.Member>();
        const usedCodes = new Set<string>();
        currentMembers.forEach(m => {
          if (m.student_id?.trim()) byStudentId.set(m.student_id.trim().toLowerCase(), m);
          if (m.code?.trim()) {
            byCode.set(m.code.trim().toLowerCase(), m);
            usedCodes.add(m.code.trim().toUpperCase());
          }
          if (m.name?.trim()) byName.set(m.name.trim(), m);
        });

        for (const item of validRows) {
          const d = item.data;
          const sidKey = d.student_id.trim().toLowerCase();
          const codeKey = d.code.trim().toLowerCase();
          const matched =
            (sidKey ? byStudentId.get(sidKey) : undefined) ??
            (codeKey ? byCode.get(codeKey) : undefined) ??
            byName.get(d.name.trim());

          if (matched && strategy === 'skip') {
            skipped += 1;
            continue;
          }

          if (matched && strategy === 'merge') {
            const nextNote = d.note
              ? matched.note && !matched.note.includes(d.note)
                ? `${matched.note}；${d.note}`
                : d.note
              : matched.note;

            const mergedRaw: Sct.Member = {
              ...matched,
              code: d.code || matched.code,
              branch_name: d.branch_name || matched.branch_name || branchName.value,
              student_id: d.student_id || matched.student_id,
              gender: d.gender || matched.gender,
              ethnicity: d.ethnicity || matched.ethnicity,
              birth_date: d.birth_date || matched.birth_date,
              dorm_building: d.dorm_building || matched.dorm_building,
              dorm_room: d.dorm_room || matched.dorm_room,
              class_name: d.class_name || matched.class_name,
              id_card: d.id_card || matched.id_card,
              phone: d.phone || matched.phone,
              role: d.role || matched.role,
              group: d.group || matched.group,
              grade: d.grade || matched.grade,
              level: d.level || matched.level,
              major: d.major || matched.major,
              advisor: d.advisor || matched.advisor,
              join_date: d.join_date || matched.join_date,
              full_date: d.full_date || matched.full_date,
              type: item.autoComputedType || options.hasTypeMapping ? d.type : matched.type,
              fee_category: d.fee_category ?? matched.fee_category,
              fee_monthly: d.fee_monthly ?? matched.fee_monthly,
              note: nextNote
            };
            const next = normalizeMemberRecord(mergedRaw, todayStr);
            await db.members.put(plain(next));

            if (next.type !== matched.type) {
              const prevStage = await db.devStages.get(matched.id);
              const stageDate =
                next.type === '正式党员'
                  ? next.full_date || todayStr
                  : next.type === '预备党员'
                    ? next.join_date || todayStr
                    : todayStr;
              await db.devStages.put(
                plain({
                  member_id: matched.id,
                  stage: next.type,
                  stage_date: stageDate,
                  next_node: next.type === '正式党员' ? '材料归档' : prevStage?.next_node,
                  next_due: next.type === '预备党员' ? next.full_date || prevStage?.next_due : undefined,
                  materials: buildStageMaterials(next.type, prevStage?.materials ?? []),
                  timeline: [
                    ...(prevStage?.timeline ?? []),
                    {
                      node: `批量导入更新为${next.type}`,
                      date: todayStr,
                      note: next.join_date || next.full_date ? '按入党/转正时间自动计算' : '批量导入合并更新'
                    }
                  ],
                  identity: 'secretary'
                })
              );
            }

            if (next.student_id?.trim()) byStudentId.set(next.student_id.trim().toLowerCase(), next);
            if (next.code?.trim()) {
              byCode.set(next.code.trim().toLowerCase(), next);
              usedCodes.add(next.code.trim().toUpperCase());
            }
            byName.set(next.name.trim(), next);
            updated += 1;
            continue;
          }

          // 新增成员（或 strategy === 'append'）
          const id = `M${nanoid(6)}`;
          const targetBranch = d.branch_name || branchName.value;
          const assignedCode = d.code || generateNextMemberCode(targetBranch, usedCodes);
          usedCodes.add(assignedCode.toUpperCase());

          const draft: Sct.Member = {
            id,
            code: assignedCode,
            branch_name: targetBranch,
            student_id: d.student_id,
            gender: d.gender,
            ethnicity: d.ethnicity,
            birth_date: d.birth_date,
            dorm_building: d.dorm_building,
            dorm_room: d.dorm_room,
            class_name: d.class_name,
            id_card: d.id_card,
            phone: d.phone,
            name: d.name.trim(),
            type: d.type,
            role: d.role,
            group: d.group,
            grade: d.grade,
            level: d.level,
            major: d.major,
            advisor: d.advisor,
            join_date: d.join_date,
            full_date: d.full_date,
            fee_category: d.fee_category ?? '学生党员',
            fee_monthly: d.fee_monthly ?? FEE_STANDARD.studentMonthly,
            note: d.note || undefined,
            identity: 'secretary'
          };
          const row = normalizeMemberRecord(draft, todayStr);
          const stageDate =
            row.type === '正式党员'
              ? row.full_date || todayStr
              : row.type === '预备党员'
                ? row.join_date || todayStr
                : todayStr;

          await db.members.put(plain(row));
          await db.devStages.put(
            plain({
              member_id: id,
              stage: row.type,
              stage_date: stageDate,
              next_node: row.type === '正式党员' ? '材料归档' : undefined,
              next_due: row.type === '预备党员' ? row.full_date || undefined : undefined,
              materials: buildStageMaterials(row.type, []),
              timeline: [{ node: `批量导入（${row.type}）`, date: stageDate }],
              identity: 'secretary'
            })
          );

          if (row.student_id?.trim()) byStudentId.set(row.student_id.trim().toLowerCase(), row);
          if (row.code?.trim()) byCode.set(row.code.trim().toLowerCase(), row);
          byName.set(row.name.trim(), row);
          inserted += 1;
        }
      }),
      '批量导入成员'
    );

    return { inserted, updated, skipped };
  }

  // ---------------- 座位图布区 ----------------
  async function addSeatMap(input: { name: string; rows: number; cols: number; map_id?: string }) {
    const cleanName = input.name.trim();
    if (!cleanName) {
      window.$message?.warning('请填写布区名称');
      throw new Error('请填写布区名称');
    }
    const mapId = input.map_id?.trim() || `map-${nanoid(6)}`;
    const row: Sct.SeatMap = {
      map_id: mapId,
      name: cleanName,
      grid: {
        rows: Math.max(1, Math.min(20, Math.round(input.rows))),
        cols: Math.max(1, Math.min(20, Math.round(input.cols)))
      },
      identity: 'secretary'
    };
    await guardWrite(db.seatMaps.put(plain(row)), '座位图布区');
    return mapId;
  }

  async function updateSeatMap(
    mapId: string,
    patch: { name: string; rows: number; cols: number }
  ): Promise<{ releasedCount: number }> {
    const cleanName = patch.name.trim();
    if (!cleanName) {
      window.$message?.warning('请填写布区名称');
      throw new Error('请填写布区名称');
    }
    const nextRows = Math.max(1, Math.min(20, Math.round(patch.rows)));
    const nextCols = Math.max(1, Math.min(20, Math.round(patch.cols)));
    let releasedCount = 0;

    await guardWrite(
      db.transaction('rw', [db.seatMaps, db.members], async () => {
        const existing = await db.seatMaps.get(mapId);
        if (!existing) return;
        await db.seatMaps.put(
          plain({
            ...existing,
            name: cleanName,
            grid: { rows: nextRows, cols: nextCols }
          })
        );
        // RosterBoard 坐标为 1-based（x ∈ 1..cols, y ∈ 1..rows），缩小时释放越界座位
        const seated = await db.members.filter(m => m.seat?.map_id === mapId).toArray();
        for (const m of seated) {
          if (m.seat && (m.seat.x > nextCols || m.seat.y > nextRows || m.seat.x < 1 || m.seat.y < 1)) {
            await db.members.update(m.id, { seat: null });
            releasedCount += 1;
          }
        }
      }),
      '更新座位图布区'
    );

    return { releasedCount };
  }

  async function deleteSeatMap(mapId: string) {
    await guardWrite(
      db.transaction('rw', [db.seatMaps, db.members], async () => {
        await db.seatMaps.delete(mapId);
        const seated = await db.members.filter(m => m.seat?.map_id === mapId).toArray();
        for (const m of seated) {
          await db.members.update(m.id, { seat: null });
        }
      }),
      '删除座位图布区'
    );
  }

  // ---------------- 会议考勤 ----------------
  /** 某会议的考勤行 */
  function attendanceOfEvent(eventId: string): Sct.Attendance[] {
    return attendance.value.filter(a => a.event_id === eventId);
  }

  /** 初始化某会议考勤：当前在册正式+预备党员默认"到会" */
  async function initAttendance(eventId: string) {
    const existing = attendanceOfEvent(eventId);
    if (existing.length) return existing;
    const targets = activeMembers.value.filter(m => m.type === '正式党员' || m.type === '预备党员');
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
    const todayStr = dayjs().format('YYYY-MM-DD');
    const datePatch: Partial<Sct.Member> = { type: targetStage as Sct.MemberType };

    if (targetStage === '预备党员') {
      const joinDate = member.join_date || todayStr;
      const fullDate =
        member.full_date && member.full_date > todayStr ? member.full_date : computeDefaultFullDate(joinDate);
      datePatch.join_date = joinDate;
      datePatch.full_date = fullDate;
      datePatch.key_dates = { ...member.key_dates, probation_end: fullDate };
    } else if (targetStage === '正式党员') {
      const fullDate = member.full_date && member.full_date <= todayStr ? member.full_date : todayStr;
      const joinDate = member.join_date || dayjs(fullDate).subtract(1, 'year').format('YYYY-MM-DD');
      const nextKeyDates = { ...member.key_dates };
      delete nextKeyDates.probation_end;
      datePatch.join_date = joinDate;
      datePatch.full_date = fullDate;
      datePatch.key_dates = nextKeyDates;
    } else {
      const nextKeyDates = { ...member.key_dates };
      delete nextKeyDates.probation_end;
      datePatch.join_date = '';
      datePatch.full_date = '';
      datePatch.key_dates = nextKeyDates;
    }

    await guardWrite(
      db.transaction('rw', [db.members, db.devStages], async () => {
        const mergedMaterials = buildStageMaterials(targetStage, stage?.materials ?? []);
        await db.members.update(memberId, plain(datePatch));
        await db.devStages.put(
          plain({
            member_id: memberId,
            stage: targetStage,
            stage_date: todayStr,
            next_node: computeNextDevNode(targetStage, mergedMaterials),
            next_due: targetStage === '预备党员' ? (datePatch.full_date ?? stage?.next_due) : undefined,
            materials: mergedMaterials,
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

  /** 更新发展台账字段（节点推进等；变更材料时自动重算 next_node） */
  async function updateDevStage(memberId: string, patch: Partial<Sct.DevStage>) {
    const existing = devStages.value.find(d => d.member_id === memberId) ?? (await db.devStages.get(memberId));
    const finalPatch: Partial<Sct.DevStage> = { ...patch };
    if (patch.materials && existing && patch.next_node === undefined) {
      const targetStage = patch.stage ?? existing.stage;
      finalPatch.next_node = computeNextDevNode(targetStage, patch.materials);
    }
    await guardWrite(db.devStages.update(memberId, plain(finalPatch)), '发展台账');
  }

  /** 更新或补录任意阶段节点的某项发展材料（支持归档日期为「无」/空字符串，自动重算下一步待办） */
  async function upsertStageMaterial(
    memberId: string,
    nodeNo: string,
    mat: { no: string; name: string; status: string; date: string }
  ) {
    const existing = devStages.value.find(d => d.member_id === memberId) ?? (await db.devStages.get(memberId));
    if (!existing) return;
    const list = [...(existing.materials ?? [])];
    const matched = findMatchedMaterial(list, nodeNo, mat.name);
    const cleanDate = mat.status === '已归档' ? mat.date.trim() : '';

    if (matched) {
      const idx = list.indexOf(matched);
      if (idx >= 0) {
        list[idx] = {
          ...matched,
          status: mat.status,
          date: cleanDate
        };
      }
    } else {
      list.push({
        no: mat.no,
        name: mat.name,
        status: mat.status,
        date: cleanDate
      });
    }

    const nextNode = computeNextDevNode(existing.stage, list);
    await guardWrite(db.devStages.update(memberId, plain({ materials: list, next_node: nextNode })), '材料归档状态');
  }

  /** 批量一键归档多条发展材料（单次原子写入，支持逐条不同日期或留空为「无」，自动重算下一步待办） */
  async function batchArchiveStageMaterials(
    memberId: string,
    items: Array<{ nodeNo: string; no: string; name: string; date: string }>
  ) {
    if (!items.length) return 0;
    const existing = devStages.value.find(d => d.member_id === memberId) ?? (await db.devStages.get(memberId));
    if (!existing) return 0;
    const list = [...(existing.materials ?? [])];

    for (const item of items) {
      const cleanDate = (item.date || '').trim();
      const matched = findMatchedMaterial(list, item.nodeNo, item.name);
      if (matched) {
        const idx = list.indexOf(matched);
        if (idx >= 0) {
          list[idx] = {
            ...matched,
            status: '已归档',
            date: cleanDate
          };
        }
      } else {
        list.push({
          no: item.no,
          name: item.name,
          status: '已归档',
          date: cleanDate
        });
      }
    }

    const nextNode = computeNextDevNode(existing.stage, list);
    await guardWrite(db.devStages.update(memberId, plain({ materials: list, next_node: nextNode })), '批量归档材料');
    return items.length;
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

  // ---------------- 文档与模板库 ----------------
  async function saveDocTemplate(input: Omit<Sct.DocTemplate, 'id'> & { id?: string }) {
    const id = input.id ?? `tpl-${nanoid(8)}`;
    await guardWrite(
      db.docTemplates.put(
        plain({
          ...input,
          id,
          identity: 'secretary'
        } as Sct.DocTemplate)
      ),
      '文档模板'
    );
    return id;
  }

  async function deleteDocTemplate(id: string) {
    await db.docTemplates.delete(id);
  }

  async function restoreDefaultDocTemplates() {
    await guardWrite(
      db.docTemplates.bulkPut(DEFAULT_DOC_TEMPLATES.map(t => plain({ ...t, identity: 'secretary' }))),
      '恢复内置模板'
    );
  }

  async function addDoc(input: Partial<Sct.Doc> & Pick<Sct.Doc, 'title' | 'body' | 'created_at'>) {
    const id = input.id ?? `doc-${nanoid(8)}`;
    const nowIso = dayjs().toISOString();
    await guardWrite(
      db.docs.put(
        plain({
          ...input,
          id,
          updated_at: input.updated_at ?? nowIso,
          identity: 'secretary'
        } as Sct.Doc)
      ),
      '文档'
    );
    return id;
  }

  async function updateDoc(id: string, patch: Partial<Sct.Doc>) {
    await guardWrite(
      db.docs.update(
        id,
        plain({
          ...patch,
          updated_at: dayjs().toISOString()
        })
      ),
      '文档'
    );
  }

  async function deleteDoc(id: string) {
    await db.docs.delete(id);
  }

  // ---------------- 党员积分 ----------------
  async function addPointRecord(
    input: Omit<Sct.PointRecord, 'id' | 'created_at' | 'identity'> & { id?: string; created_at?: string }
  ) {
    const id = input.id ?? `pt-${nanoid(8)}`;
    const row: Sct.PointRecord = {
      ...input,
      id,
      created_at: input.created_at ?? dayjs().format('YYYY-MM-DD HH:mm:ss'),
      identity: 'secretary'
    };
    await guardWrite(db.pointRecords.put(plain(row)), '党员积分记录');
    return id;
  }

  async function updatePointRecord(id: string, patch: Partial<Sct.PointRecord>) {
    const existing = await db.pointRecords.get(id);
    if (!existing) return;
    await guardWrite(db.pointRecords.put(plain({ ...existing, ...patch, id })), '党员积分记录');
  }

  async function deletePointRecord(id: string) {
    await guardWrite(db.pointRecords.delete(id), '删除积分记录');
  }

  async function setPointVeto(memberId: string, year: number, active: boolean, reason: string) {
    const id = `${memberId}::${year}`;
    if (!active) {
      await guardWrite(db.pointVetoes.delete(id), '取消一票否决');
      return;
    }
    const row: Sct.PointVeto = {
      id,
      member_id: memberId,
      year,
      active: true,
      reason: reason.trim(),
      updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      identity: 'secretary'
    };
    await guardWrite(db.pointVetoes.put(plain(row)), '设置一票否决');
  }

  async function savePointRules(rules: Sct.PointRuleItem[]) {
    await guardWrite(db.meta.put({ key: 'point-rules', value: plain(rules) }), '积分考核标准');
  }

  async function resetPointRules() {
    await guardWrite(db.meta.delete('point-rules'), '重置积分考核标准');
  }

  async function bulkAddPointRecords(
    inputs: Array<Omit<Sct.PointRecord, 'id' | 'created_at' | 'identity'>>
  ): Promise<number> {
    if (!inputs.length) return 0;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const rows: Sct.PointRecord[] = inputs.map(item => ({
      ...item,
      id: `pt-${nanoid(8)}`,
      created_at: now,
      identity: 'secretary'
    }));
    await guardWrite(db.pointRecords.bulkPut(plain(rows)), '批量导入积分草稿');
    return rows.length;
  }

  // ---------------- 工作台模块开关与自定义字段配置（事务读写防并发覆盖） ----------------
  async function updateWorkspaceConfig(patch: Partial<Sct.WorkspaceConfig>) {
    let next!: Sct.WorkspaceConfig;
    await guardWrite(
      db.transaction('rw', [db.meta], async () => {
        const row = await db.meta.get('workspace-config');
        const cur = row?.value ? normalizeWorkspaceConfig(row.value) : workspaceConfig.value;
        next = normalizeWorkspaceConfig({
          ...cur,
          ...patch,
          enabledModules: {
            ...cur.enabledModules,
            ...patch.enabledModules
          },
          customFields: patch.customFields ?? cur.customFields,
          updatedAt: new Date().toISOString()
        });
        await db.meta.put({ key: 'workspace-config', value: plain(next) });
      }),
      '工作台配置'
    );
    persistWorkspaceConfigSync(next);
    return next;
  }

  // ---------------- 组织关系转接 / 转入核查 / 流动党员 / 归档与恢复 ----------------
  async function releaseMemberActiveSlots(memberId: string) {
    await db.members.update(memberId, { seat: null, role: '' });
    const youthRow = await db.meta.get('youth-committee-slots');
    if (Array.isArray(youthRow?.value)) {
      const slots = youthRow.value as Sct.YouthCommitteeSlot[];
      if (slots.some(s => s.member_id === memberId)) {
        await db.meta.put({
          key: 'youth-committee-slots',
          value: slots.map(s => (s.member_id === memberId ? { ...s, member_id: null } : s))
        });
      }
    }
  }

  /** 在成员生命周期流转时，自动关闭或取消同成员冲突的「办理中」旧转接记录，防止幽灵记录 */
  async function closeConflictingOpenTransfers(memberId: string, closeStatus: '已完成' | '已取消', keepId?: string) {
    const openRows = await db.transferRecords
      .where('member_id')
      .equals(memberId)
      .filter(r => r.status === '办理中' && r.id !== keepId)
      .toArray();
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const today = dayjs().format('YYYY-MM-DD');
    for (const r of openRows) {
      await db.transferRecords.put(
        plain({
          ...r,
          status: closeStatus,
          completed_date: closeStatus === '已完成' ? today : r.completed_date,
          updated_at: now
        })
      );
    }
  }

  async function initiateTransferOut(
    memberId: string,
    payload: Partial<Sct.TransferRecord> & { transferId?: string }
  ): Promise<string> {
    const m = memberOf(memberId);
    const id = payload.transferId ?? `tf-${nanoid(8)}`;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const row: Sct.TransferRecord = {
      id,
      member_id: memberId,
      member_name_snapshot: m?.name ?? payload.member_name_snapshot ?? '',
      direction: 'out',
      status: '办理中',
      step: payload.step ?? 1,
      initiated_date: payload.initiated_date || dayjs().format('YYYY-MM-DD'),
      transfer_mode: payload.transfer_mode ?? '线上系统转接',
      target_committee: payload.target_committee ?? '',
      target_branch: payload.target_branch ?? '',
      is_internal: Boolean(payload.is_internal),
      letter_no: payload.letter_no ?? '',
      fee_paid_until: payload.fee_paid_until ?? dayjs().format('YYYY-MM'),
      archive_dest: payload.archive_dest ?? '随人事档案',
      receipt_received: Boolean(payload.receipt_received),
      receipt_date: payload.receipt_date ?? '',
      receipt_no: payload.receipt_no ?? '',
      note: payload.note ?? '',
      updated_at: now,
      identity: 'secretary'
    };
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        await closeConflictingOpenTransfers(memberId, '已取消', id);
        await db.transferRecords.put(plain(row));
        await db.members.update(memberId, { lifecycle_status: '转出办理中' });
      }),
      '保存组织关系转出单'
    );
    return id;
  }

  async function updateTransferRecord(id: string, patch: Partial<Sct.TransferRecord>) {
    const existing = await db.transferRecords.get(id);
    if (!existing) return;
    await guardWrite(
      db.transferRecords.put(
        plain({
          ...existing,
          ...patch,
          id,
          updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
        })
      ),
      '更新组织关系转接记录'
    );
  }

  async function completeTransferOut(
    transferId: string,
    receipt: { receipt_date?: string; receipt_no?: string; note?: string } = {}
  ) {
    const completedDate = receipt.receipt_date || dayjs().format('YYYY-MM-DD');
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords, db.meta], async () => {
        const existing = await db.transferRecords.get(transferId);
        if (!existing || existing.direction !== 'out' || existing.status !== '办理中') return;
        await closeConflictingOpenTransfers(existing.member_id, '已取消', transferId);
        await db.transferRecords.put(
          plain({
            ...existing,
            status: '已完成',
            step: 4,
            completed_date: completedDate,
            receipt_received: true,
            receipt_date: completedDate,
            receipt_no: receipt.receipt_no ?? existing.receipt_no ?? '',
            note: receipt.note ?? existing.note ?? '',
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
          })
        );
        await releaseMemberActiveSlots(existing.member_id);
        await db.members.update(existing.member_id, {
          lifecycle_status: '已转出',
          archived_at: completedDate,
          archive_reason: `组织关系转往：${existing.target_branch || existing.target_committee || '接收党组织'}`
        });
      }),
      '办结关系转出并归档'
    );
  }

  async function cancelTransferOut(transferId: string) {
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        const existing = await db.transferRecords.get(transferId);
        if (!existing || existing.direction !== 'out' || existing.status !== '办理中') return;
        await db.transferRecords.put(
          plain({
            ...existing,
            status: '已取消',
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
          })
        );
        await db.members.update(existing.member_id, { lifecycle_status: '在册正常' });
      }),
      '撤回关系转出'
    );
  }

  async function batchInitiateTransferOut(
    items: Array<{
      member_id: string;
      transfer_mode: Sct.TransferMode;
      target_committee: string;
      target_branch: string;
      fee_paid_until: string;
      initiated_date: string;
      archive_dest: Sct.ArchiveDest;
      is_internal: boolean;
      completeImmediately?: boolean;
    }>
  ): Promise<Sct.TransferRecord[]> {
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const created: Sct.TransferRecord[] = [];
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords, db.meta], async () => {
        for (const item of items) {
          const m = await db.members.get(item.member_id);
          if (!m) continue;
          const done = Boolean(item.completeImmediately);
          const recId = `tf-${nanoid(8)}`;
          await closeConflictingOpenTransfers(item.member_id, '已取消', recId);
          const rec: Sct.TransferRecord = {
            id: recId,
            member_id: item.member_id,
            member_name_snapshot: m.name,
            direction: 'out',
            status: done ? '已完成' : '办理中',
            step: done ? 4 : 2,
            initiated_date: item.initiated_date || dayjs().format('YYYY-MM-DD'),
            completed_date: done ? item.initiated_date || dayjs().format('YYYY-MM-DD') : undefined,
            transfer_mode: item.transfer_mode,
            target_committee: item.target_committee,
            target_branch: item.target_branch,
            fee_paid_until: item.fee_paid_until,
            archive_dest: item.archive_dest,
            is_internal: item.is_internal,
            receipt_received: done,
            receipt_date: done ? item.initiated_date || dayjs().format('YYYY-MM-DD') : '',
            updated_at: now,
            identity: 'secretary'
          };
          created.push(rec);
          await db.transferRecords.put(plain(rec));
          if (done) {
            await releaseMemberActiveSlots(item.member_id);
            await db.members.update(item.member_id, {
              lifecycle_status: '已转出',
              archived_at: rec.completed_date,
              archive_reason: `毕业/批量转往：${rec.target_branch || rec.target_committee || '接收党组织'}`
            });
          } else {
            await db.members.update(item.member_id, { lifecycle_status: '转出办理中' });
          }
        }
      }),
      '批量发起组织关系转出'
    );
    return created;
  }

  async function markMemberIncomingAudit(memberId: string, sourceOrg = '') {
    const m = memberOf(memberId);
    let resultId = '';
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        const existingOpenIn = await db.transferRecords
          .where('member_id')
          .equals(memberId)
          .filter(r => r.direction === 'in' && r.status === '办理中')
          .first();
        if (existingOpenIn) {
          resultId = existingOpenIn.id;
          if (sourceOrg.trim()) {
            await db.transferRecords.put(
              plain({
                ...existingOpenIn,
                source_org: sourceOrg.trim(),
                updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
              })
            );
          }
        } else {
          resultId = `tf-${nanoid(8)}`;
          await closeConflictingOpenTransfers(memberId, '已取消', resultId);
          const row: Sct.TransferRecord = {
            id: resultId,
            member_id: memberId,
            member_name_snapshot: m?.name ?? '',
            direction: 'in',
            status: '办理中',
            initiated_date: dayjs().format('YYYY-MM-DD'),
            source_org: sourceOrg.trim(),
            audit_items: {},
            audit_notes: {},
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
            identity: 'secretary'
          };
          await db.transferRecords.put(plain(row));
        }
        await db.members.update(memberId, { lifecycle_status: '转入待核查' });
      }),
      '加入转入档案核查'
    );
    return resultId;
  }

  async function updateIncomingAudit(
    transferId: string,
    auditItems: Record<string, Sct.AuditItemState>,
    auditNotes?: Record<string, string>,
    sourceOrg?: string
  ) {
    await guardWrite(
      db.transaction('rw', [db.transferRecords], async () => {
        const existing = await db.transferRecords.get(transferId);
        if (!existing) return;
        await db.transferRecords.put(
          plain({
            ...existing,
            source_org: sourceOrg !== undefined ? sourceOrg : existing.source_org,
            audit_items: auditItems,
            audit_notes: auditNotes ?? existing.audit_notes ?? {},
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
          })
        );
      }),
      '保存档案核查状态'
    );
  }

  /** 原子更新转入核查矩阵单项（事务内合并，彻底杜绝快速连点丢状态与并发重复建单） */
  async function patchIncomingAuditItem(
    memberId: string,
    itemKey: string,
    nextState: Sct.AuditItemState,
    transferId?: string
  ) {
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        let existing = transferId ? await db.transferRecords.get(transferId) : undefined;
        if (!existing) {
          existing = await db.transferRecords
            .where('member_id')
            .equals(memberId)
            .filter(r => r.direction === 'in' && r.status === '办理中')
            .first();
        }
        const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
        if (!existing) {
          const m = await db.members.get(memberId);
          existing = {
            id: `tf-${nanoid(8)}`,
            member_id: memberId,
            member_name_snapshot: m?.name ?? '',
            direction: 'in',
            status: '办理中',
            initiated_date: dayjs().format('YYYY-MM-DD'),
            source_org: '',
            audit_items: {},
            audit_notes: {},
            updated_at: now,
            identity: 'secretary'
          };
        }
        await db.transferRecords.put(
          plain({
            ...existing,
            audit_items: {
              ...existing.audit_items,
              [itemKey]: nextState
            },
            updated_at: now
          })
        );
      }),
      '更新档案核查项'
    );
  }

  async function approveIncomingAudit(transferId: string) {
    const today = dayjs().format('YYYY-MM-DD');
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        const existing = await db.transferRecords.get(transferId);
        if (!existing || existing.direction !== 'in' || existing.status !== '办理中') return;
        await db.transferRecords.put(
          plain({
            ...existing,
            status: '已完成',
            completed_date: today,
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
          })
        );
        await db.members.update(existing.member_id, { lifecycle_status: '在册正常' });
      }),
      '核查通过并正式入册'
    );
  }

  async function setMemberFloating(
    memberId: string,
    direction: 'float_out' | 'float_in',
    sourceOrg: string,
    note = ''
  ) {
    const m = memberOf(memberId);
    const statusLabel: Sct.MemberLifecycleStatus = direction === 'float_out' ? '流出党员' : '流入党员';
    const recId = `tf-${nanoid(8)}`;
    const row: Sct.TransferRecord = {
      id: recId,
      member_id: memberId,
      member_name_snapshot: m?.name ?? '',
      direction,
      status: '办理中',
      initiated_date: dayjs().format('YYYY-MM-DD'),
      source_org: sourceOrg.trim(),
      contact_logs: [],
      note: note.trim(),
      updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      identity: 'secretary'
    };
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        await closeConflictingOpenTransfers(memberId, '已完成', recId);
        await db.transferRecords.put(plain(row));
        await db.members.update(memberId, { lifecycle_status: statusLabel });
      }),
      '登记流动党员'
    );
    return row.id;
  }

  async function addFloatingContactLog(transferId: string, summary: string, date = dayjs().format('YYYY-MM-DD')) {
    const existing = await db.transferRecords.get(transferId);
    if (!existing || !summary.trim()) return;
    const logs = [...(existing.contact_logs ?? []), { date, summary: summary.trim() }];
    await updateTransferRecord(transferId, { contact_logs: logs });
  }

  async function archiveMemberStopped(memberId: string, reason: string) {
    const today = dayjs().format('YYYY-MM-DD');
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords, db.meta], async () => {
        await closeConflictingOpenTransfers(memberId, '已取消');
        await releaseMemberActiveSlots(memberId);
        await db.members.update(memberId, {
          lifecycle_status: '停止发展',
          archived_at: today,
          archive_reason: reason.trim() || '停止发展 / 历史离队归档'
        });
      }),
      '停止发展归档'
    );
  }

  async function restoreMemberToActive(memberId: string) {
    await guardWrite(
      db.transaction('rw', [db.members, db.transferRecords], async () => {
        await closeConflictingOpenTransfers(memberId, '已完成');
        await db.members.update(memberId, {
          lifecycle_status: '在册正常',
          archived_at: '',
          archive_reason: ''
        });
      }),
      '恢复为在册正常'
    );
  }

  // ---------------- 志愿时长台账 CRUD ----------------
  async function addVolunteerActivity(
    input: Omit<Sct.VolunteerActivity, 'id' | 'created_at' | 'identity'> & { id?: string }
  ): Promise<string> {
    const id = input.id ?? `vol-${nanoid(8)}`;
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const row: Sct.VolunteerActivity = {
      ...input,
      id,
      created_at: now,
      updated_at: now,
      identity: 'secretary'
    };
    await guardWrite(db.volunteerActivities.put(plain(row)), '志愿服务活动');
    return id;
  }

  async function updateVolunteerActivity(id: string, patch: Partial<Sct.VolunteerActivity>) {
    const existing = await db.volunteerActivities.get(id);
    if (!existing) return;
    await guardWrite(
      db.volunteerActivities.put(
        plain({
          ...existing,
          ...patch,
          id,
          updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss')
        })
      ),
      '更新志愿服务活动'
    );
  }

  async function deleteVolunteerActivity(id: string) {
    await guardWrite(db.volunteerActivities.delete(id), '删除志愿服务活动');
  }

  async function setVolunteerActivityStatus(id: string, status: Sct.VolunteerStatus) {
    await updateVolunteerActivity(id, { status });
  }

  // ---------------- 党小组管理（双向互通） ----------------
  async function addPartyGroup(name: string) {
    const clean = name.trim();
    if (!clean) {
      window.$message?.warning('请输入党小组名称');
      return;
    }
    const next = Array.from(new Set([...partyGroupNames.value, clean]));
    await guardWrite(db.meta.put({ key: 'party-groups', value: plain(next) }), '新增党小组');
  }

  async function renamePartyGroup(oldName: string, newName: string) {
    const from = oldName.trim();
    const to = newName.trim();
    if (!to || from === to) return;
    await guardWrite(
      db.transaction('rw', [db.members, db.meta], async () => {
        const currentList = [...partyGroupNames.value];
        const nextList = Array.from(new Set(currentList.map(g => (g === from ? to : g))));
        if (!nextList.includes(to)) nextList.push(to);
        await db.meta.put({ key: 'party-groups', value: plain(nextList) });

        const affected = await db.members.filter(m => (m.group ?? '').trim() === from).toArray();
        if (affected.length) {
          await db.members.bulkPut(plain(affected.map(m => ({ ...m, group: to }))));
        }
      }),
      '重命名党小组'
    );
  }

  async function deletePartyGroup(name: string) {
    const target = name.trim();
    if (!target) return;
    await guardWrite(
      db.transaction('rw', [db.members, db.meta], async () => {
        const nextList = partyGroupNames.value.filter(g => g !== target);
        await db.meta.put({ key: 'party-groups', value: plain(nextList) });
        const affected = await db.members.filter(m => (m.group ?? '').trim() === target).toArray();
        if (affected.length) {
          await db.members.bulkPut(plain(affected.map(m => ({ ...m, group: '' }))));
        }
      }),
      '删除党小组'
    );
  }

  // ---------------- 自定义青年委员槽位（支持 0..N 个，仅限正式党员） ----------------
  async function saveYouthSlots(slots: Sct.YouthCommitteeSlot[]) {
    await guardWrite(db.meta.put({ key: 'youth-committee-slots', value: plain(slots) }), '青年委员配置');
  }

  async function addYouthCommitteeSlot(title = '青年委员', duty = '联系青年团员 · 组织文体实践与推优入党') {
    const cleanTitle = title.trim() || '青年委员';
    const nextSlot: Sct.YouthCommitteeSlot = {
      id: `youth-${nanoid(6)}`,
      title: cleanTitle,
      duty: duty.trim() || '联系青年团员 · 组织文体实践与推优入党',
      member_id: null
    };
    await saveYouthSlots([...youthCommitteeSlots.value, nextSlot]);
    return nextSlot.id;
  }

  async function updateYouthCommitteeSlot(slotId: string, patch: { title?: string; duty?: string }) {
    const existing = youthCommitteeSlots.value.find(s => s.id === slotId);
    if (!existing) return;
    const nextTitle = patch.title !== undefined ? patch.title.trim() || '青年委员' : existing.title;
    const nextDuty = patch.duty !== undefined ? patch.duty.trim() : existing.duty;
    const nextSlots = youthCommitteeSlots.value.map(s =>
      s.id === slotId ? { ...s, title: nextTitle, duty: nextDuty } : s
    );
    await guardWrite(
      db.transaction('rw', [db.members, db.meta], async () => {
        await db.meta.put({ key: 'youth-committee-slots', value: plain(nextSlots) });
        if (existing.member_id && nextTitle !== existing.title) {
          await db.members.update(existing.member_id, { role: nextTitle });
        }
      }),
      '更新青年委员岗位'
    );
  }

  async function assignYouthCommitteeMember(slotId: string, memberId: string | null) {
    const targetSlot = youthCommitteeSlots.value.find(s => s.id === slotId);
    if (!targetSlot) return;
    if (memberId) {
      const m = memberOf(memberId);
      if (m && m.type !== '正式党员') {
        window.$message?.warning('仅正式党员具有被选举权，预备党员等不能担任支委职务');
        return;
      }
    }
    await guardWrite(
      db.transaction('rw', [db.members, db.meta], async () => {
        // 清理原占据该槽位成员的职务
        if (targetSlot.member_id && targetSlot.member_id !== memberId) {
          await db.members.update(targetSlot.member_id, { role: '' });
        }
        // 如果该成员此前担任其他青年委员槽位，先从旧槽位移除
        const nextSlots = youthCommitteeSlots.value.map(s => {
          if (s.id === slotId) return { ...s, member_id: memberId };
          if (memberId && s.member_id === memberId) return { ...s, member_id: null };
          return s;
        });
        await db.meta.put({ key: 'youth-committee-slots', value: plain(nextSlots) });
        if (memberId) {
          await db.members.update(memberId, { role: targetSlot.title });
        }
      }),
      '指派青年委员'
    );
  }

  async function removeYouthCommitteeSlot(slotId: string) {
    const targetSlot = youthCommitteeSlots.value.find(s => s.id === slotId);
    if (!targetSlot) return;
    await guardWrite(
      db.transaction('rw', [db.members, db.meta], async () => {
        if (targetSlot.member_id) {
          await db.members.update(targetSlot.member_id, { role: '' });
        }
        const nextSlots = youthCommitteeSlots.value.filter(s => s.id !== slotId);
        await db.meta.put({ key: 'youth-committee-slots', value: plain(nextSlots) });
      }),
      '移除青年委员岗位'
    );
  }

  return {
    members,
    activeMembers,
    inBranchRosterMembers,
    archivedMembers,
    transferringOutMembers,
    incomingAuditMembers,
    floatingMembers,
    transferRecords,
    volunteerActivities,
    workspaceConfig,
    seatMaps,
    calEvents,
    devStages,
    feeRecords,
    talks,
    docTemplates,
    docsList,
    attendance,
    pointRecords,
    pointVetoes,
    pointRules,
    activePointScheme,
    partyGroupNames,
    youthCommitteeSlots,
    branchName,
    setBranchName,
    updateWorkspaceConfig,
    memberMonthlyFee,
    attendanceOfEvent,
    initAttendance,
    setAttendance,
    attendanceRate,
    advanceStage,
    moveStageTo,
    updateDevStage,
    upsertStageMaterial,
    batchArchiveStageMaterials,
    addTalk,
    deleteTalk,
    saveDocTemplate,
    deleteDocTemplate,
    restoreDefaultDocTemplates,
    addDoc,
    updateDoc,
    deleteDoc,
    addPointRecord,
    updatePointRecord,
    deletePointRecord,
    setPointVeto,
    savePointRules,
    resetPointRules,
    bulkAddPointRecords,
    canHardDeleteMember,
    initiateTransferOut,
    updateTransferRecord,
    completeTransferOut,
    cancelTransferOut,
    batchInitiateTransferOut,
    markMemberIncomingAudit,
    updateIncomingAudit,
    patchIncomingAuditItem,
    approveIncomingAudit,
    setMemberFloating,
    addFloatingContactLog,
    archiveMemberStopped,
    restoreMemberToActive,
    addVolunteerActivity,
    updateVolunteerActivity,
    deleteVolunteerActivity,
    setVolunteerActivityStatus,
    addPartyGroup,
    renamePartyGroup,
    deletePartyGroup,
    addYouthCommitteeSlot,
    updateYouthCommitteeSlot,
    assignYouthCommitteeMember,
    removeYouthCommitteeSlot,
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
    deleteMember,
    bulkImportMembers,
    addSeatMap,
    updateSeatMap,
    deleteSeatMap
  };
});
