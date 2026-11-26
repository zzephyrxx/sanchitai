/**
 * 党员积分计算、跨模块草稿同步与导出工具（v0.2.7，固定高校 60+40 分桶制）
 *
 * - 基础分 60（5 项扣至 0）+ 履职分 ≤40（专业 15 / 实践 10 / 志愿 15）+ 附加分 - 减扣分
 * - 支持从「三会一课考勤」「党费欠缴」「志愿时长台账」一键生成待核实草稿建议
 * - 支持脱敏公示版 / 全量报送版双模式 Excel 导出与《支部记录表》打印
 */
import dayjs from 'dayjs';
import { buildUni6040Scheme } from '@/constants/party-points';
import { esc } from '@/utils/print';
import { formatIdCardForExport, privacyModeFileSuffix } from '@/utils/privacy-export';

export interface DimensionScoreDetail {
  id: string;
  label: string;
  shortLabel: string;
  category: Sct.PointCategory;
  mode: Sct.PointDimensionDef['mode'];
  initialScore: number;
  cap: number | null;
  color: string;
  /** 原始累计变动值（扣分维度为累计扣分正数，加分维度为累计加分正数） */
  raw: number;
  /** 封顶/保底后的有效得分（deduct_direct 为正数表示扣减额） */
  effective: number;
  capped: boolean;
}

export interface MemberYearPointSummary {
  member: Sct.Member;
  year: number;
  scheme: Sct.PointScheme;
  dimensions: DimensionScoreDetail[];
  /** 基础分合计（满分 60，一票否决时清零） */
  baseScore: number;
  /** 基础分累计扣减（正数） */
  baseDeducted: number;
  /** 履职分合计（上限 40） */
  dutyScore: number;
  /** 专业学习有效分（上限 15） */
  dutyStudyScore: number;
  /** 实践活动有效分（上限 10） */
  dutyPracticeScore: number;
  /** 志愿服务有效分（上限 15） */
  dutyVolunteerScore: number;
  /** 附加分合计 */
  bonusScore: number;
  /** 直接减扣分合计（正数） */
  penaltyDeduction: number;
  /** 年度总分 */
  totalScore: number;
  vetoActive: boolean;
  vetoReason: string;
  isWarning: boolean;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  totalRecordCount: number;
  deductionSummary: string;
  additionSummary: string;
  baseBuckets: DimensionScoreDetail[];
  dutyBuckets: DimensionScoreDetail[];
}

export interface SyncPointDraftSuggestion {
  sourceRef: string;
  sourceKind: 'attendance' | 'fee' | 'volunteer';
  sourceBadge: string;
  memberId: string;
  memberName: string;
  date: string;
  category: Sct.PointCategory;
  subCategory: string;
  ruleLabel: string;
  content: string;
  score: number;
  calcMeta?: Sct.PointRecord['calc_meta'];
  alreadyImported: boolean;
}

export function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function formatScore(value: number, signed = false): string {
  const n = roundScore(value);
  const absText = String(Math.abs(n));
  if (n < 0) return `-${absText}`;
  if (signed && n > 0) return `+${absText}`;
  return absText;
}

export function computeRuleSuggestedScore(
  rule: Sct.PointRuleItem,
  meta: { count?: number; role?: 'core' | 'member'; hours?: number }
): number {
  const base = rule.default_score;
  switch (rule.calc_mode) {
    case 'count': {
      const cnt = Math.max(0.5, Number(meta.count) || 1);
      return roundScore(base * cnt);
    }
    case 'role_half': {
      const ratio = meta.role === 'member' ? 0.5 : 1;
      return roundScore(base * ratio);
    }
    case 'hours_20': {
      const hours = Math.max(0, Number(meta.hours) || 0);
      return roundScore((hours / 20) * Math.abs(base || 1));
    }
    default:
      return roundScore(base);
  }
}

/** 计算单名党员在指定年度（60+40 分桶制）下的完整积分构成 */
export function computeMemberYearPoints(
  member: Sct.Member,
  year: number,
  allRecords: readonly Sct.PointRecord[],
  veto?: Sct.PointVeto,
  schemeInput?: Sct.PointScheme
): MemberYearPointSummary {
  const scheme = schemeInput ?? buildUni6040Scheme();
  const records = allRecords.filter(r => r.member_id === member.id && r.year === year);
  const approved = records.filter(r => r.status === '已认定');
  const pendingCount = records.filter(r => r.status === '待核实').length;
  const rejectedCount = records.filter(r => r.status === '未通过').length;

  const vetoActive = scheme.enable_veto && Boolean(veto?.active);
  const vetoReason = veto?.reason?.trim() || '';

  const dimIdSet = new Set(scheme.dimensions.map(d => d.id));
  const fallbackByCategory = new Map<Sct.PointCategory, string>();
  for (const d of scheme.dimensions) {
    if (!fallbackByCategory.has(d.category)) {
      fallbackByCategory.set(d.category, d.id);
    }
  }

  const bucketedApproved = new Map<string, Sct.PointRecord[]>();
  for (const r of approved) {
    const targetDimId = dimIdSet.has(r.sub_category)
      ? r.sub_category
      : (fallbackByCategory.get(r.category) ?? scheme.dimensions[0]?.id ?? '');
    if (!targetDimId) continue;
    const arr = bucketedApproved.get(targetDimId) ?? [];
    arr.push(r);
    bucketedApproved.set(targetDimId, arr);
  }

  const dimensions: DimensionScoreDetail[] = scheme.dimensions.map(dim => {
    const dimRecords = bucketedApproved.get(dim.id) ?? [];

    if (dim.mode === 'deduct_from_base') {
      const cap = dim.cap ?? dim.initial_score;
      const rawDeduct = roundScore(dimRecords.reduce((acc, r) => acc + Math.abs(Number(r.score) || 0), 0));
      const effective = vetoActive ? 0 : roundScore(Math.max(0, dim.initial_score - rawDeduct));
      return {
        id: dim.id,
        label: dim.label,
        shortLabel: dim.shortLabel,
        category: dim.category,
        mode: dim.mode,
        initialScore: dim.initial_score,
        cap,
        color: dim.color,
        raw: rawDeduct,
        effective,
        capped: rawDeduct >= dim.initial_score && dim.initial_score > 0
      };
    }

    if (dim.mode === 'deduct_direct') {
      const rawDeduct = roundScore(dimRecords.reduce((acc, r) => acc + Math.abs(Number(r.score) || 0), 0));
      return {
        id: dim.id,
        label: dim.label,
        shortLabel: dim.shortLabel,
        category: dim.category,
        mode: dim.mode,
        initialScore: 0,
        cap: null,
        color: dim.color,
        raw: rawDeduct,
        effective: rawDeduct,
        capped: false
      };
    }

    const rawGain = roundScore(dimRecords.reduce((acc, r) => acc + Math.max(0, Number(r.score) || 0), 0));
    const hasCap = dim.mode === 'add_capped' && typeof dim.cap === 'number' && dim.cap > 0;
    const effective = hasCap ? roundScore(Math.min(dim.cap as number, rawGain)) : rawGain;
    return {
      id: dim.id,
      label: dim.label,
      shortLabel: dim.shortLabel,
      category: dim.category,
      mode: dim.mode,
      initialScore: 0,
      cap: hasCap ? (dim.cap as number) : null,
      color: dim.color,
      raw: rawGain,
      effective,
      capped: hasCap && rawGain > (dim.cap as number)
    };
  });

  const baseBuckets = dimensions.filter(d => d.mode === 'deduct_from_base');
  const dutyBuckets = dimensions.filter(
    d => d.mode === 'add_capped' || (d.mode === 'add_uncapped' && d.category === 'duty')
  );
  const bonusBuckets = dimensions.filter(d => d.mode === 'add_uncapped' && d.category === 'bonus');
  const penaltyBuckets = dimensions.filter(d => d.mode === 'deduct_direct');

  const baseScore = vetoActive ? 0 : roundScore(baseBuckets.reduce((acc, d) => acc + d.effective, 0));
  const baseInitialTotal = roundScore(baseBuckets.reduce((acc, d) => acc + d.initialScore, 0));
  const baseDeducted = vetoActive ? baseInitialTotal : roundScore(Math.max(0, baseInitialTotal - baseScore));

  let dutyScoreRaw = 0;
  const groupedSums = new Map<string, number>();
  for (const dim of scheme.dimensions) {
    const detail = dimensions.find(d => d.id === dim.id);
    if (!detail) continue;
    if (dim.mode === 'add_capped' || (dim.mode === 'add_uncapped' && dim.category === 'duty')) {
      if (dim.group_cap_key && scheme.group_caps?.[dim.group_cap_key] !== undefined) {
        groupedSums.set(dim.group_cap_key, (groupedSums.get(dim.group_cap_key) ?? 0) + detail.effective);
      } else {
        dutyScoreRaw += detail.effective;
      }
    }
  }
  for (const [gKey, sumVal] of groupedSums.entries()) {
    const gCap = scheme.group_caps?.[gKey] ?? sumVal;
    dutyScoreRaw += Math.min(gCap, sumVal);
  }
  const dutyScore = roundScore(dutyScoreRaw);
  const dutyStudyScore = dutyBuckets.find(d => d.id === 'duty_study')?.effective ?? 0;
  const dutyPracticeScore = dutyBuckets.find(d => d.id === 'duty_practice')?.effective ?? 0;
  const dutyVolunteerScore = dutyBuckets.find(d => d.id === 'duty_volunteer')?.effective ?? 0;
  const bonusScore = roundScore(bonusBuckets.reduce((acc, d) => acc + d.effective, 0));
  const penaltyDeduction = roundScore(penaltyBuckets.reduce((acc, d) => acc + d.effective, 0));

  const totalScore = roundScore(baseScore + dutyScore + bonusScore - penaltyDeduction);
  const isWarning = vetoActive || totalScore < scheme.pass_line;

  const deductLines = approved
    .filter(r => r.score < 0 || r.category === 'base' || r.category === 'penalty')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => `${r.date.slice(5)} ${r.content || r.rule_label}(-${formatScore(Math.abs(r.score))})`);
  if (vetoActive) {
    deductLines.unshift(`【一票否决】${vetoReason || '评定清零'}`);
  }

  const addLines = approved
    .filter(r => r.score > 0 && r.category !== 'base' && r.category !== 'penalty')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => `${r.date.slice(5)} ${r.content || r.rule_label}(+${formatScore(Math.abs(r.score))})`);

  return {
    member,
    year,
    scheme,
    dimensions,
    baseScore,
    baseDeducted,
    dutyScore,
    dutyStudyScore,
    dutyPracticeScore,
    dutyVolunteerScore,
    bonusScore,
    penaltyDeduction,
    totalScore,
    vetoActive,
    vetoReason,
    isWarning,
    approvedCount: approved.length,
    pendingCount,
    rejectedCount,
    totalRecordCount: records.length,
    deductionSummary: deductLines.join('；'),
    additionSummary: addLines.join('；'),
    baseBuckets,
    dutyBuckets
  };
}

/** 扫描本年度考勤缺席、党费欠缴、志愿时长，生成「待核实积分草稿建议」供支书勾选导入 */
export function buildPointDraftSuggestions(opts: {
  year: number;
  scheme: Sct.PointScheme;
  members: readonly Sct.Member[];
  calEvents: readonly Sct.CalEvent[];
  attendance: readonly Sct.Attendance[];
  feeRecords: readonly Sct.FeeRecord[];
  volunteerActivities: readonly Sct.VolunteerActivity[];
  existingRecords: readonly Sct.PointRecord[];
}): SyncPointDraftSuggestion[] {
  const { year, scheme, members, calEvents, attendance, feeRecords, volunteerActivities, existingRecords } = opts;
  const yearPrefix = `${year}-`;
  const memberMap = new Map(members.map(m => [m.id, m]));
  const eventMap = new Map(calEvents.map(e => [e.id, e]));
  const importedRefs = new Set(existingRecords.map(r => r.source_ref).filter((v): v is string => Boolean(v)));

  const suggestions: SyncPointDraftSuggestion[] = [];

  const meetingDim =
    scheme.dimensions.find(d => d.id.includes('meeting') || d.label.includes('组织生活')) ??
    scheme.dimensions.find(d => d.mode === 'deduct_from_base');
  const feeDim =
    scheme.dimensions.find(d => d.id.includes('fee') || d.label.includes('党费')) ??
    scheme.dimensions.find(d => d.mode === 'deduct_from_base');
  const volunteerDim =
    scheme.dimensions.find(d => d.id.includes('volunteer') || d.label.includes('志愿')) ??
    scheme.dimensions.find(d => d.mode === 'add_capped' || d.mode === 'add_uncapped');

  // 1. 考勤未到会（按人聚合本年度未到会场次）
  if (meetingDim) {
    const absentByMember = new Map<string, string[]>();
    for (const att of attendance) {
      if (att.status !== '未到会') continue;
      const ev = eventMap.get(att.event_id);
      if (!ev || !ev.date.startsWith(yearPrefix)) continue;
      if (!memberMap.has(att.member_id)) continue;
      const arr = absentByMember.get(att.member_id) ?? [];
      arr.push(`${ev.date.slice(5)} ${ev.title}`);
      absentByMember.set(att.member_id, arr);
    }
    for (const [memberId, list] of absentByMember.entries()) {
      const m = memberMap.get(memberId);
      if (!m) continue;
      const ref = `sync:att:${year}:${memberId}:${list.length}`;
      suggestions.push({
        sourceRef: ref,
        sourceKind: 'attendance',
        sourceBadge: '三会一课考勤',
        memberId,
        memberName: m.name,
        date: dayjs().format('YYYY-MM-DD'),
        category: meetingDim.category,
        subCategory: meetingDim.id,
        ruleLabel: `缺席组织生活（本年 ${list.length} 次）`,
        content: `考勤同步：本年未到会 ${list.length} 次（${list.slice(0, 3).join('、')}${list.length > 3 ? '…' : ''}）`,
        score: -list.length,
        calcMeta: { count: list.length, base_score: -1 },
        alreadyImported: importedRefs.has(ref)
      });
    }
  }

  // 2. 党费欠缴（按人聚合本年度欠缴月份）
  if (feeDim) {
    const owedByMember = new Map<string, string[]>();
    for (const fee of feeRecords) {
      if (fee.status !== '欠缴' || !fee.year_month.startsWith(yearPrefix)) continue;
      if (!memberMap.has(fee.member_id)) continue;
      const arr = owedByMember.get(fee.member_id) ?? [];
      arr.push(fee.year_month);
      owedByMember.set(fee.member_id, arr);
    }
    for (const [memberId, months] of owedByMember.entries()) {
      const m = memberMap.get(memberId);
      if (!m) continue;
      const sorted = months.slice().sort();
      const ref = `sync:fee:${year}:${memberId}:${sorted.length}`;
      suggestions.push({
        sourceRef: ref,
        sourceKind: 'fee',
        sourceBadge: '党费收缴台账',
        memberId,
        memberName: m.name,
        date: dayjs().format('YYYY-MM-DD'),
        category: feeDim.category,
        subCategory: feeDim.id,
        ruleLabel: `本年党费欠缴（${sorted.length} 个月）`,
        content: `党费同步：欠缴月份 ${sorted.join('、')}`,
        score: -roundScore(sorted.length * 3),
        calcMeta: { count: sorted.length, base_score: -3 },
        alreadyImported: importedRefs.has(ref)
      });
    }
  }

  // 3. 志愿时长台账（仅统计本年「已认定」活动总时长，按每 20 小时换算）
  if (volunteerDim) {
    const volRule = scheme.rules.find(r => r.calc_mode === 'hours_20' && r.enabled !== false);
    const unitPer20h = Math.abs(volRule?.default_score ?? 1);
    const hoursByMember = new Map<string, { hours: number; count: number }>();
    for (const act of volunteerActivities) {
      if (act.status !== '已认定' || !act.date.startsWith(yearPrefix)) continue;
      for (const p of act.participants) {
        if (!memberMap.has(p.member_id)) continue;
        const cur = hoursByMember.get(p.member_id) ?? { hours: 0, count: 0 };
        cur.hours = roundScore(cur.hours + (Number(p.hours) || 0));
        cur.count += 1;
        hoursByMember.set(p.member_id, cur);
      }
    }
    for (const [memberId, stat] of hoursByMember.entries()) {
      const m = memberMap.get(memberId);
      if (!m || stat.hours <= 0) continue;
      const score = roundScore((stat.hours / 20) * unitPer20h);
      if (score <= 0) continue;
      const ref = `sync:vol:${year}:${memberId}:${stat.hours}`;
      suggestions.push({
        sourceRef: ref,
        sourceKind: 'volunteer',
        sourceBadge: '志愿时长台账',
        memberId,
        memberName: m.name,
        date: dayjs().format('YYYY-MM-DD'),
        category: volunteerDim.category,
        subCategory: volunteerDim.id,
        ruleLabel: volRule?.label ?? `志愿服务时长换算（每 20h = ${unitPer20h} 分）`,
        content: `志愿台账同步：${year} 年度已认定 ${stat.count} 场活动，累计 ${stat.hours} 小时`,
        score,
        calcMeta: { hours: stat.hours, base_score: unitPer20h },
        alreadyImported: importedRefs.has(ref)
      });
    }
  }

  return suggestions;
}

/** 导出双 Sheet Excel（60+40 分桶制 + 脱敏公示/全量报送双模式） */
export async function exportBranchPointsExcel(opts: {
  branchName: string;
  year: number;
  scheme: Sct.PointScheme;
  summaries: readonly MemberYearPointSummary[];
  records: readonly Sct.PointRecord[];
  memberMap: ReadonlyMap<string, Sct.Member>;
  privacyMode?: Sct.ExportPrivacyMode;
}): Promise<'saved' | 'cancelled'> {
  const XLSX = await import('xlsx');
  const privacyMode = opts.privacyMode ?? 'masked';
  const dimMap = new Map(opts.scheme.dimensions.map(d => [d.id, d]));

  const summaryRows = opts.summaries.map((s, idx) => {
    const baseRow: Record<string, unknown> = {
      序号: idx + 1,
      姓名: s.member.name,
      统一编号: s.member.code || '',
      学号: s.member.student_id || '',
      党员身份: s.member.type,
      成员状态: s.member.lifecycle_status ?? '在册正常'
    };
    if (privacyMode === 'full') {
      baseRow.身份证号 = formatIdCardForExport(s.member.id_card, privacyMode);
    }
    baseRow['基础分(满分60)'] = s.baseScore;
    for (const d of s.dutyBuckets) {
      const colName = d.cap ? `${d.shortLabel}(限${d.cap})` : d.shortLabel;
      baseRow[colName] = d.effective;
    }
    baseRow['履职分合计(限40)'] = s.dutyScore;
    baseRow.附加分 = s.bonusScore;
    baseRow.减扣分 = s.penaltyDeduction > 0 ? -s.penaltyDeduction : 0;
    baseRow.年度总积分 = s.totalScore;
    baseRow.评定状态 = s.vetoActive ? '一票否决' : s.isWarning ? `低于${opts.scheme.pass_line}分预警` : '合格';
    baseRow.扣分明细 = s.deductionSummary || '无';
    baseRow.加分明细 = s.additionSummary || '无';
    baseRow.待核实条数 = s.pendingCount;
    return baseRow;
  });

  const yearRecords = opts.records
    .filter(r => r.year === opts.year)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const detailRows = yearRecords.map((r, idx) => {
    const m = opts.memberMap.get(r.member_id);
    const dim = dimMap.get(r.sub_category);
    return {
      序号: idx + 1,
      年度: r.year,
      活动时间: r.date,
      党员姓名: m?.name ?? r.member_id,
      学号: m?.student_id ?? '',
      所属子项: dim?.shortLabel ?? r.sub_category,
      计分细则: r.rule_label,
      活动内容与说明: r.content,
      分值: r.score,
      支部认定状态: r.status,
      备注: r.note ?? ''
    };
  });

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, '支部积分汇总表');

  const wsDetail = XLSX.utils.json_to_sheet(
    detailRows.length
      ? detailRows
      : [{ 序号: '', 年度: opts.year, 活动时间: '', 党员姓名: '暂无明细记录', 所属子项: '', 分值: '' }]
  );
  XLSX.utils.book_append_sheet(wb, wsDetail, '全员积分明细流水');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const { saveFileWithPicker } = await import('@/utils/save-file');
  const res = await saveFileWithPicker(blob, {
    suggestedName: `${opts.branchName}_${opts.year}年度党员积分记录表${privacyModeFileSuffix(privacyMode)}_${dayjs().format('YYYYMMDD')}.xlsx`,
    types: [
      {
        description: 'Excel 工作簿',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        extensions: ['.xlsx']
      }
    ]
  });
  return res.status === 'saved' ? 'saved' : 'cancelled';
}

/** 生成 60+40 分桶制可打印公示版 HTML */
export function buildBranchPointsPrintHtml(opts: {
  branchName: string;
  year: number;
  scheme: Sct.PointScheme;
  summaries: readonly MemberYearPointSummary[];
}): string {
  const avg =
    opts.summaries.length > 0
      ? roundScore(opts.summaries.reduce((acc, s) => acc + s.totalScore, 0) / opts.summaries.length)
      : 0;
  const warnCount = opts.summaries.filter(s => s.isWarning).length;

  const rowsHtml = opts.summaries
    .map((s, idx) => {
      const statusText = s.vetoActive
        ? '<span style="color:#c0392b;font-weight:700">一票否决</span>'
        : s.isWarning
          ? `<span style="color:#c0392b;font-weight:700">&lt;${opts.scheme.pass_line}分预警</span>`
          : '合格';

      const studyScore = s.dutyBuckets.find(d => d.id === 'duty_study')?.effective ?? 0;
      const practiceScore = s.dutyBuckets.find(d => d.id === 'duty_practice')?.effective ?? 0;
      const volScore = s.dutyBuckets.find(d => d.id === 'duty_volunteer')?.effective ?? 0;

      return `
        <tr>
          <td class="c">${idx + 1}</td>
          <td class="c"><b>${esc(s.member.name)}</b></td>
          <td class="c">${esc(s.member.type)}</td>
          <td class="c">${formatScore(s.baseScore)}</td>
          <td class="c">${formatScore(studyScore)}</td>
          <td class="c">${formatScore(practiceScore)}</td>
          <td class="c">${formatScore(volScore)}</td>
          <td class="c"><b>${formatScore(s.dutyScore)}</b></td>
          <td class="c">+${formatScore(s.bonusScore)} / -${formatScore(s.penaltyDeduction)}</td>
          <td style="font-size:11px;line-height:1.45">${esc(s.additionSummary || s.deductionSummary || '无')}</td>
          <td class="c" style="font-weight:700;font-size:14px;${s.isWarning ? 'color:#c0392b;' : ''}">${formatScore(s.totalScore)}</td>
          <td class="c">${statusText}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <h1>党员积分评定支部记录表（${opts.year} 年度）</h1>
    <div class="meta">
      党支部：<b>${esc(opts.branchName)}</b> &nbsp;|&nbsp;
      考核人数：${opts.summaries.length} 人 &nbsp;|&nbsp;
      平均分：${formatScore(avg)} 分 &nbsp;|&nbsp;
      预警人数：${warnCount} 人 &nbsp;|&nbsp;
      制表日期：${dayjs().format('YYYY-MM-DD')}
    </div>
    <table>
      <thead>
        <tr>
          <th class="c" style="width:36px">序号</th>
          <th class="c" style="width:68px">党员姓名</th>
          <th class="c" style="width:62px">身份</th>
          <th class="c">基础分<br><span style="font-weight:400;font-size:10px">(60)</span></th>
          <th class="c">专业<br><span style="font-weight:400;font-size:10px">(15)</span></th>
          <th class="c">实践<br><span style="font-weight:400;font-size:10px">(10)</span></th>
          <th class="c">志愿<br><span style="font-weight:400;font-size:10px">(15)</span></th>
          <th class="c">履职合计<br><span style="font-weight:400;font-size:10px">(40)</span></th>
          <th class="c">附加/减扣</th>
          <th>主要积分事项摘要</th>
          <th class="c" style="width:60px">年度总分</th>
          <th class="c" style="width:68px">评定提示</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="12" class="c">暂无党员记录</td></tr>'}
      </tbody>
    </table>
    <table style="margin-top:12px">
      <tr>
        <td class="c" style="width:100px;font-weight:700;background:#f5f2ee">支部核实意见</td>
        <td style="padding:12px 14px">
          以上公示与考核记录经支部核实无误。&nbsp;&nbsp;&nbsp;&nbsp;
          党支部书记签名：＿＿＿＿＿＿＿＿ &nbsp;&nbsp;&nbsp;&nbsp;
          日期：＿＿＿＿ 年 ＿＿ 月 ＿＿ 日
        </td>
      </tr>
    </table>
    <div class="foot">
      <span>考核说明：${esc(opts.scheme.description)}</span>
      <span>三尺台 · 党员积分管理</span>
    </div>
  `;
}
