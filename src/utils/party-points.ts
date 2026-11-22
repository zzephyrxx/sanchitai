/**
 * 党员积分计算引擎、汇总格式化、双 Sheet Excel 导出与《支部记录表》打印版生成
 */
import dayjs from 'dayjs';
import {
  BASE_BUCKETS,
  DUTY_BUCKETS,
  POINT_BUCKET_MAP,
  POINT_CATEGORY_META,
  POINT_DUTY_MAX,
  POINT_PASS_LINE
} from '@/constants/party-points';
import { esc } from '@/utils/print';
import { saveFileWithPicker } from '@/utils/save-file';

export interface BucketScoreDetail {
  key: Sct.PointSubCategory;
  label: string;
  shortLabel: string;
  cap: number;
  /** 基础分：累计扣分（正数）；履职分：原始累计加分 */
  raw: number;
  /** 基础分：该子项剩余得分（0..cap）；履职分：封顶后有效得分（0..cap） */
  effective: number;
  /** 是否触发本项封顶/扣满 */
  capped: boolean;
}

export interface MemberYearPointSummary {
  member: Sct.Member;
  year: number;
  baseBuckets: BucketScoreDetail[];
  dutyBuckets: BucketScoreDetail[];
  /** 基础分（未一票否决时的子项合计，一票否决后为 0） */
  baseScore: number;
  /** 基础分原始总扣分（正数） */
  baseDeducted: number;
  /** 履职分三大类封顶得分 */
  dutyStudyScore: number;
  dutyPracticeScore: number;
  dutyVolunteerScore: number;
  /** 履职总分（≤40） */
  dutyScore: number;
  /** 附加分合计 */
  bonusScore: number;
  /** 减扣分合计（正数，如 10 表示扣 10 分） */
  penaltyDeduction: number;
  /** 年度总积分 = baseScore + dutyScore + bonusScore - penaltyDeduction */
  totalScore: number;
  /** 一票否决状态 */
  vetoActive: boolean;
  vetoReason: string;
  /** 是否触发 <60 分或一票否决预警 */
  isWarning: boolean;
  /** 有效/待核实/未通过条目数 */
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  totalRecordCount: number;
  /** 扣分与加分摘要文案（供导出支部记录表） */
  deductionSummary: string;
  additionSummary: string;
}

export function roundScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function formatScore(value: number, signed = false): string {
  const n = roundScore(value);
  const absText = Number.isInteger(n) ? String(Math.abs(n)) : String(Math.abs(n));
  if (n < 0) return `-${absText}`;
  if (signed && n > 0) return `+${absText}`;
  return absText;
}

/** 按细则计算建议分值（用户仍可在表单中手动微调） */
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

/** 计算单名党员在指定年度的完整积分构成 */
export function computeMemberYearPoints(
  member: Sct.Member,
  year: number,
  allRecords: readonly Sct.PointRecord[],
  veto?: Sct.PointVeto
): MemberYearPointSummary {
  const records = allRecords.filter(r => r.member_id === member.id && r.year === year);
  const approved = records.filter(r => r.status === '已认定');
  const pendingCount = records.filter(r => r.status === '待核实').length;
  const rejectedCount = records.filter(r => r.status === '未通过').length;

  // 1. 基础分（5 子项各自封顶扣至 0）
  const baseBuckets: BucketScoreDetail[] = BASE_BUCKETS.map(bucket => {
    const cap = bucket.cap ?? 0;
    const rawDeduct = roundScore(
      approved
        .filter(r => r.category === 'base' && r.sub_category === bucket.key)
        .reduce((acc, r) => acc + Math.abs(Number(r.score) || 0), 0)
    );
    const effective = roundScore(Math.max(0, cap - rawDeduct));
    return {
      key: bucket.key,
      label: bucket.label,
      shortLabel: bucket.shortLabel,
      cap,
      raw: rawDeduct,
      effective,
      capped: rawDeduct >= cap && cap > 0
    };
  });

  const vetoActive = Boolean(veto?.active);
  const vetoReason = veto?.reason?.trim() || '';
  const baseDeducted = roundScore(baseBuckets.reduce((acc, b) => acc + b.raw, 0));
  const baseScore = vetoActive ? 0 : roundScore(baseBuckets.reduce((acc, b) => acc + b.effective, 0));

  // 2. 履职分（3 大类 15/10/15 各自封顶，合计 ≤ 40）
  const dutyBuckets: BucketScoreDetail[] = DUTY_BUCKETS.map(bucket => {
    const cap = bucket.cap ?? 0;
    const rawGain = roundScore(
      approved
        .filter(r => r.category === 'duty' && r.sub_category === bucket.key)
        .reduce((acc, r) => acc + Math.max(0, Number(r.score) || 0), 0)
    );
    const effective = roundScore(Math.min(cap, rawGain));
    return {
      key: bucket.key,
      label: bucket.label,
      shortLabel: bucket.shortLabel,
      cap,
      raw: rawGain,
      effective,
      capped: rawGain > cap
    };
  });

  const dutyStudyScore = dutyBuckets.find(b => b.key === 'duty_study')?.effective ?? 0;
  const dutyPracticeScore = dutyBuckets.find(b => b.key === 'duty_practice')?.effective ?? 0;
  const dutyVolunteerScore = dutyBuckets.find(b => b.key === 'duty_volunteer')?.effective ?? 0;
  const dutyScore = roundScore(
    Math.min(
      POINT_DUTY_MAX,
      dutyBuckets.reduce((acc, b) => acc + b.effective, 0)
    )
  );

  // 3. 附加分（不封顶）
  const bonusScore = roundScore(
    approved.filter(r => r.category === 'bonus').reduce((acc, r) => acc + Math.max(0, Number(r.score) || 0), 0)
  );

  // 4. 减扣分（正数表示扣除额）
  const penaltyDeduction = roundScore(
    approved.filter(r => r.category === 'penalty').reduce((acc, r) => acc + Math.abs(Number(r.score) || 0), 0)
  );

  const totalScore = roundScore(baseScore + dutyScore + bonusScore - penaltyDeduction);
  const isWarning = vetoActive || totalScore < POINT_PASS_LINE;

  // 摘要文本（用于导出支部记录表）
  const deductLines = approved
    .filter(r => r.category === 'base' || r.category === 'penalty')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => `${r.date.slice(5)} ${r.content || r.rule_label}(-${formatScore(Math.abs(r.score))})`);
  if (vetoActive) {
    deductLines.unshift(`【一票否决】${vetoReason || '基础分清零'}`);
  }

  const addLines = approved
    .filter(r => r.category === 'duty' || r.category === 'bonus')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => `${r.date.slice(5)} ${r.content || r.rule_label}(+${formatScore(Math.abs(r.score))})`);

  return {
    member,
    year,
    baseBuckets,
    dutyBuckets,
    baseScore,
    baseDeducted,
    dutyStudyScore,
    dutyPracticeScore,
    dutyVolunteerScore,
    dutyScore,
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
    additionSummary: addLines.join('；')
  };
}

/** 导出双 Sheet Excel（Sheet 1《支部积分汇总表》+ Sheet 2《全员积分明细流水》） */
export async function exportBranchPointsExcel(opts: {
  branchName: string;
  year: number;
  summaries: readonly MemberYearPointSummary[];
  records: readonly Sct.PointRecord[];
  memberMap: ReadonlyMap<string, Sct.Member>;
}): Promise<'saved' | 'cancelled'> {
  const XLSX = await import('xlsx');

  const summaryRows = opts.summaries.map((s, idx) => ({
    序号: idx + 1,
    姓名: s.member.name,
    学号: s.member.student_id || '',
    党员身份: s.member.type,
    '基础分(满分60)': s.baseScore,
    '专业学习(限15)': s.dutyStudyScore,
    '实践活动(限10)': s.dutyPracticeScore,
    '志愿服务(限15)': s.dutyVolunteerScore,
    '履职分合计(限40)': s.dutyScore,
    附加分: s.bonusScore,
    减扣分: s.penaltyDeduction > 0 ? -s.penaltyDeduction : 0,
    年度总积分: s.totalScore,
    评定状态: s.vetoActive ? '一票否决（基础分清零）' : s.totalScore < POINT_PASS_LINE ? '低于60分预警' : '合格',
    基础扣分与减扣明细: s.deductionSummary || '无',
    履职与附加加分明细: s.additionSummary || '无',
    待核实条数: s.pendingCount
  }));

  const yearRecords = opts.records
    .filter(r => r.year === opts.year)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const detailRows = yearRecords.map((r, idx) => {
    const m = opts.memberMap.get(r.member_id);
    const catMeta = POINT_CATEGORY_META[r.category];
    const bucketMeta = POINT_BUCKET_MAP[r.sub_category];
    return {
      序号: idx + 1,
      年度: r.year,
      活动时间: r.date,
      党员姓名: m?.name ?? r.member_id,
      学号: m?.student_id ?? '',
      积分大类: catMeta?.shortLabel ?? r.category,
      所属子项: bucketMeta?.shortLabel ?? r.sub_category,
      计分细则: r.rule_label,
      活动内容与说明: r.content,
      分值: r.score,
      支部认定状态: r.status,
      备注: r.note ?? ''
    };
  });

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  wsSummary['!cols'] = [
    { wch: 6 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 9 },
    { wch: 9 },
    { wch: 12 },
    { wch: 18 },
    { wch: 36 },
    { wch: 36 },
    { wch: 10 }
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, '支部积分汇总表');

  const wsDetail = XLSX.utils.json_to_sheet(
    detailRows.length
      ? detailRows
      : [
          {
            序号: '',
            年度: opts.year,
            活动时间: '',
            党员姓名: '暂无明细记录',
            积分大类: '',
            活动内容与说明: '',
            分值: ''
          }
        ]
  );
  wsDetail['!cols'] = [
    { wch: 6 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 10 },
    { wch: 14 },
    { wch: 28 },
    { wch: 32 },
    { wch: 8 },
    { wch: 12 },
    { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, '全员积分明细流水');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const res = await saveFileWithPicker(blob, {
    suggestedName: `${opts.branchName}_${opts.year}年度党员积分支部记录表_${dayjs().format('YYYYMMDD')}.xlsx`,
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

/** 生成可打印公示版 HTML（带《计算机学院学生党员积分管理支部记录表》抬头与签字栏，对应附件 3） */
export function buildBranchPointsPrintHtml(opts: {
  branchName: string;
  year: number;
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
        : s.totalScore < POINT_PASS_LINE
          ? '<span style="color:#c0392b;font-weight:700">&lt;60分预警</span>'
          : '合格';
      return `
        <tr>
          <td class="c">${idx + 1}</td>
          <td class="c"><b>${esc(s.member.name)}</b></td>
          <td class="c">${esc(s.member.type)}</td>
          <td class="c">${formatScore(s.baseScore)}</td>
          <td class="c">${formatScore(s.dutyScore)}<br><span style="font-size:10px;color:#666">学${formatScore(s.dutyStudyScore)}/践${formatScore(s.dutyPracticeScore)}/志${formatScore(s.dutyVolunteerScore)}</span></td>
          <td class="c">${s.bonusScore ? `+${formatScore(s.bonusScore)}` : '0'}</td>
          <td class="c">${s.penaltyDeduction ? `-${formatScore(s.penaltyDeduction)}` : '0'}</td>
          <td style="font-size:11px;line-height:1.45">${esc(s.deductionSummary || '无')}</td>
          <td style="font-size:11px;line-height:1.45">${esc(s.additionSummary || '无')}</td>
          <td class="c" style="font-weight:700;font-size:14px;${s.isWarning ? 'color:#c0392b;' : ''}">${formatScore(s.totalScore)}</td>
          <td class="c">${statusText}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <h1>学生党员积分管理支部记录表（${opts.year} 年度）</h1>
    <div class="meta">
      党支部：<b>${esc(opts.branchName)}</b> &nbsp;|&nbsp;
      参与考核党员：${opts.summaries.length} 人 &nbsp;|&nbsp;
      支部平均分：${formatScore(avg)} 分 &nbsp;|&nbsp;
      低于60分/否决预警：${warnCount} 人 &nbsp;|&nbsp;
      制表日期：${dayjs().format('YYYY-MM-DD')}
    </div>
    <table>
      <thead>
        <tr>
          <th class="c" style="width:36px">序号</th>
          <th class="c" style="width:68px">党员姓名</th>
          <th class="c" style="width:64px">身份</th>
          <th class="c" style="width:52px">基础分<br><span style="font-weight:400;font-size:10px">(60)</span></th>
          <th class="c" style="width:78px">履职分<br><span style="font-weight:400;font-size:10px">(≤40)</span></th>
          <th class="c" style="width:48px">附加分</th>
          <th class="c" style="width:48px">减扣分</th>
          <th>活动内容及扣分情况</th>
          <th>履职与附加加分情况</th>
          <th class="c" style="width:54px">总分</th>
          <th class="c" style="width:66px">评定提示</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="11" class="c">暂无正式/预备党员记录</td></tr>'}
      </tbody>
    </table>
    <table style="margin-top:12px">
      <tr>
        <td class="c" style="width:100px;font-weight:700;background:#f5f2ee">党员承诺</td>
        <td style="padding:12px 14px">
          以上公示与记录内容属实。&nbsp;&nbsp;&nbsp;&nbsp;
          党员代表/本人签名：＿＿＿＿＿＿＿＿ &nbsp;&nbsp;&nbsp;&nbsp;
          日期：＿＿＿＿ 年 ＿＿ 月 ＿＿ 日
        </td>
      </tr>
      <tr>
        <td class="c" style="width:100px;font-weight:700;background:#f5f2ee">支部意见</td>
        <td style="padding:12px 14px">
          经党支部核实认定，同意上报学院党委备案。&nbsp;&nbsp;&nbsp;&nbsp;
          支部书记/支委签名：＿＿＿＿＿＿＿＿ &nbsp;&nbsp;&nbsp;&nbsp;
          日期：＿＿＿＿ 年 ＿＿ 月 ＿＿ 日
        </td>
      </tr>
    </table>
    <div class="foot">
      <span>计分公式：年度总积分 = 基础分(60) + 履职分(专业15+实践10+志愿15≤40) + 附加分 - 减扣分（一票否决基础分归零）</span>
      <span>三尺台 · 党员积分台账</span>
    </div>
  `;
}
