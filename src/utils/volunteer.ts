/**
 * 志愿时长台账工具：
 * - 微信群接龙/多行名单智能解析（自动匹配花名册姓名、可选提取单人时长）
 * - 按成员汇总统计 & 考核折算预览
 * - 双 Sheet Excel 导出（支持脱敏公示版 / 全量报送版）
 * - 电子纸风格可打印公示单 HTML 生成
 */
import dayjs from 'dayjs';
import { esc } from '@/utils/print';
import { formatIdCardForExport, formatPhoneForExport, privacyModeFileSuffix } from '@/utils/privacy-export';

export interface MemberVolunteerSummary {
  member: Sct.Member;
  totalHours: number;
  pendingHours: number;
  activityCount: number;
  records: Array<{
    activityId: string;
    date: string;
    title: string;
    source: Sct.VolunteerSource;
    status: Sct.VolunteerStatus;
    hours: number;
    roleNote?: string;
  }>;
  convertedScore?: number;
}

export interface ParsedWechatParticipant {
  rawName: string;
  matchedMemberId: string | null;
  matchedMemberName?: string;
  hours?: number;
  roleNote?: string;
}

export function roundHours(val: number): number {
  if (!Number.isFinite(val)) return 0;
  return Math.round(val * 100) / 100;
}

/**
 * 解析微信群接龙或分隔文本名单：
 * 支持格式如：
 * - "1. 张三 2h\n2. 李四 1.5小时\n3. 王五（引导）"
 * - "张三、李四、王五，赵六"
 */
/** 仅在括号外部按行内分隔符拆分（避免拆断「1、张三」序号或「（摄影/引导）」括号备注） */
function splitLineOutsideParens(line: string): string[] {
  const stripped = line.replace(/^[（(]?\d+[）).、\s]+/, '').trim();
  if (!stripped) return [];
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of stripped) {
    if (ch === '(' || ch === '（') {
      depth += 1;
      buf += ch;
    } else if (ch === ')' || ch === '）') {
      depth = Math.max(0, depth - 1);
      buf += ch;
    } else if (depth === 0 && /[、,，;；]/.test(ch)) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export function parseWechatNameList(
  rawText: string,
  members: readonly Sct.Member[],
  defaultHours: number
): {
  matched: Array<{ member: Sct.Member; hours: number; roleNote: string }>;
  unmatched: string[];
} {
  const cleanLines = rawText
    .replace(/\r/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(rawLine => !/^(#接龙|接龙|例[:：]|活动|时间[:：]|地点[:：])/.test(rawLine))
    .flatMap(splitLineOutsideParens);

  // 构建花名册精确姓名映射（先入优先，保证调用方传入的在册优先顺序不被归档同名覆盖）
  const exactMap = new Map<string, Sct.Member>();
  for (const m of members) {
    const key = m.name.trim();
    if (key && !exactMap.has(key)) {
      exactMap.set(key, m);
    }
  }
  const sortedByNameLen = members.slice().sort((a, b) => b.name.length - a.name.length);

  const seenIds = new Set<string>();
  const matched: Array<{ member: Sct.Member; hours: number; roleNote: string }> = [];
  const unmatched: string[] = [];

  for (const rawLine of cleanLines) {
    // 剥离拆分后可能残余的序号
    let line = rawLine.replace(/^[（(]?\d+[）).、\s]+/, '').trim();
    if (!line) continue;

    // 尝试提取时长（支持 2h / 1.5H / 2小时 / 1.5时，兼容中文非 \w 边界）
    let extractedHours = defaultHours;
    const hoursMatch = line.match(/(\d+(?:\.\d+)?)\s*(?:小时|时|[hH](?![a-zA-Z]))/);
    if (hoursMatch) {
      extractedHours = roundHours(Number(hoursMatch[1]));
      line = line.replace(hoursMatch[0], '').trim();
    }

    // 尝试提取括号备注
    let roleNote = '';
    const noteMatch = line.match(/[（(]([^）)]+)[）)]/);
    if (noteMatch) {
      roleNote = noteMatch[1].trim();
      line = line.replace(noteMatch[0], '').trim();
    }

    // 1. 精确姓名匹配
    let hit = exactMap.get(line);
    // 2. 空格拆分取首词或子串包含匹配
    if (!hit) {
      const tokens = line.split(/\s+/).filter(Boolean);
      for (const tk of tokens) {
        if (exactMap.has(tk)) {
          hit = exactMap.get(tk);
          if (!roleNote && tokens.length > 1) {
            roleNote = tokens.filter(t => t !== tk).join(' ');
          }
          break;
        }
      }
    }
    if (!hit) {
      hit = sortedByNameLen.find(m => m.name.length >= 2 && line.includes(m.name));
    }

    if (hit) {
      if (!seenIds.has(hit.id)) {
        seenIds.add(hit.id);
        matched.push({ member: hit, hours: extractedHours, roleNote });
      }
    } else if (line.length <= 24) {
      unmatched.push(line);
    }
  }

  return { matched, unmatched };
}

/** 计算全员志愿时长汇总（支持按已认定统计 + 考核折算预览） */
export function computeVolunteerSummaries(opts: {
  members: readonly Sct.Member[];
  activities: readonly Sct.VolunteerActivity[];
  conversion?: { enabled: boolean; maxHours: number; semesters: number };
}): MemberVolunteerSummary[] {
  const { members, activities, conversion } = opts;
  const memberMap = new Map(members.map(m => [m.id, m]));
  const map = new Map<string, MemberVolunteerSummary>();

  for (const m of members) {
    map.set(m.id, {
      member: m,
      totalHours: 0,
      pendingHours: 0,
      activityCount: 0,
      records: []
    });
  }

  for (const act of activities) {
    for (const p of act.participants) {
      let summary = map.get(p.member_id);
      if (!summary) {
        const fallbackMember: Sct.Member = memberMap.get(p.member_id) ?? {
          id: p.member_id,
          code: '',
          name: p.name_snapshot,
          type: '正式党员',
          lifecycle_status: '已转出',
          role: '',
          group: '',
          grade: '',
          level: '',
          major: '',
          advisor: '',
          join_date: '',
          full_date: ''
        };
        summary = {
          member: fallbackMember,
          totalHours: 0,
          pendingHours: 0,
          activityCount: 0,
          records: []
        };
        map.set(p.member_id, summary);
      }
      const h = roundHours(Number(p.hours) || 0);
      if (act.status === '已认定') {
        summary.totalHours = roundHours(summary.totalHours + h);
      } else {
        summary.pendingHours = roundHours(summary.pendingHours + h);
      }
      summary.activityCount += 1;
      summary.records.push({
        activityId: act.id,
        date: act.date,
        title: act.title,
        source: act.source,
        status: act.status,
        hours: h,
        roleNote: p.role_note
      });
    }
  }

  const list = Array.from(map.values()).map(item => {
    item.records.sort((a, b) => b.date.localeCompare(a.date));
    if (conversion?.enabled) {
      const capPerSem = Math.max(1, conversion.maxHours || 60);
      const sem = Math.max(1, conversion.semesters || 1);
      const totalCap = capPerSem * sem;
      item.convertedScore = roundHours(Math.min(100, (Math.min(totalCap, item.totalHours) / totalCap) * 100));
    }
    return item;
  });

  return list.sort(
    (a, b) =>
      b.totalHours - a.totalHours ||
      b.activityCount - a.activityCount ||
      a.member.name.localeCompare(b.member.name, 'zh')
  );
}

/** 导出双 Sheet 志愿时长 Excel（Sheet 1 按人汇总公示表 + Sheet 2 按活动明细表） */
export async function exportVolunteerExcel(opts: {
  branchName: string;
  rangeLabel: string;
  summaries: readonly MemberVolunteerSummary[];
  activities: readonly Sct.VolunteerActivity[];
  privacyMode: Sct.ExportPrivacyMode;
  includeConversion?: boolean;
}): Promise<'saved' | 'cancelled'> {
  const XLSX = await import('xlsx');
  const { branchName, rangeLabel, summaries, activities, privacyMode, includeConversion } = opts;

  const summaryRows = summaries.map((s, idx) => {
    const row: Record<string, unknown> = {
      序号: idx + 1,
      姓名: s.member.name,
      统一编号: s.member.code || '',
      '学号/工号': s.member.student_id || '',
      政治面貌: s.member.type,
      成员状态: s.member.lifecycle_status ?? '在册正常',
      党小组: s.member.group || '',
      已认定志愿时长h: s.totalHours,
      待核实时长h: s.pendingHours,
      参与场次: s.activityCount
    };
    if (includeConversion && s.convertedScore !== undefined) {
      row.考核折算分 = s.convertedScore;
    }
    if (privacyMode === 'full') {
      row.联系电话 = formatPhoneForExport(s.member.phone, privacyMode);
      row.身份证号 = formatIdCardForExport(s.member.id_card, privacyMode);
    }
    row.活动明细摘要 = s.records
      .filter(r => r.status === '已认定')
      .map(r => `${r.date.slice(5)} ${r.title}(${r.hours}h)`)
      .join('；');
    return row;
  });

  const detailRows: Record<string, unknown>[] = [];
  const sortedActs = activities.slice().sort((a, b) => b.date.localeCompare(a.date));
  let seq = 1;
  for (const act of sortedActs) {
    for (const p of act.participants) {
      detailRows.push({
        序号: seq,
        活动日期: act.date,
        活动名称: act.title,
        活动来源: act.source,
        认定状态: act.status,
        参与人: p.name_snapshot,
        志愿时长h: p.hours,
        分工备注: p.role_note ?? '',
        活动说明: act.note ?? ''
      });
      seq += 1;
    }
  }

  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows.length ? summaryRows : [{ 提示: '暂无汇总记录' }]);
  XLSX.utils.book_append_sheet(wb, wsSummary, '按人汇总公示表');

  const wsDetail = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{ 提示: '暂无活动明细' }]);
  XLSX.utils.book_append_sheet(wb, wsDetail, '按活动明细表');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  const { saveFileWithPicker } = await import('@/utils/save-file');
  const res = await saveFileWithPicker(blob, {
    suggestedName: `${branchName}_志愿时长公示表_${rangeLabel}${privacyModeFileSuffix(privacyMode)}_${dayjs().format('YYYYMMDD')}.xlsx`,
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

/** 生成电子纸风格《志愿服务时长公示表》打印 HTML */
export function buildVolunteerPrintHtml(opts: {
  branchName: string;
  rangeLabel: string;
  summaries: readonly MemberVolunteerSummary[];
  includeConversion?: boolean;
}): string {
  const activeRows = opts.summaries
    .map(s => ({
      ...s,
      certifiedRecords: s.records.filter(r => r.status === '已认定')
    }))
    .filter(s => s.totalHours > 0 || s.certifiedRecords.length > 0);
  const grandTotal = roundHours(activeRows.reduce((acc, s) => acc + s.totalHours, 0));

  const bodyHtml = activeRows
    .map(
      (s, idx) => `
      <tr>
        <td class="c">${idx + 1}</td>
        <td class="c"><b>${esc(s.member.name)}</b></td>
        <td class="c">${esc(s.member.type)}</td>
        <td class="c">${esc(s.member.group || '—')}</td>
        <td class="c" style="font-weight:700">${s.totalHours} h</td>
        <td class="c">${s.certifiedRecords.length}</td>
        ${opts.includeConversion ? `<td class="c">${s.convertedScore ?? '—'}</td>` : ''}
        <td style="font-size:11px;line-height:1.45">${esc(
          s.certifiedRecords.map(r => `${r.date.slice(5)} ${r.title}(${r.hours}h)`).join('；') || '—'
        )}</td>
      </tr>
    `
    )
    .join('');

  return `
    <h1>志愿服务时长统计公示表</h1>
    <div class="meta">
      党支部：<b>${esc(opts.branchName)}</b> &nbsp;|&nbsp;
      统计区间：<b>${esc(opts.rangeLabel)}</b> &nbsp;|&nbsp;
      参与人数：${activeRows.length} 人 &nbsp;|&nbsp;
      累计认定总时长：<b>${grandTotal} 小时</b> &nbsp;|&nbsp;
      公示日期：${dayjs().format('YYYY-MM-DD')}
    </div>
    <table>
      <thead>
        <tr>
          <th class="c" style="width:40px">序号</th>
          <th class="c" style="width:74px">姓名</th>
          <th class="c" style="width:74px">政治面貌</th>
          <th class="c" style="width:74px">党小组</th>
          <th class="c" style="width:72px">认定总时长</th>
          <th class="c" style="width:54px">场次</th>
          ${opts.includeConversion ? '<th class="c" style="width:68px">考核折算</th>' : ''}
          <th>已认定志愿活动明细</th>
        </tr>
      </thead>
      <tbody>
        ${bodyHtml || `<tr><td colspan="${opts.includeConversion ? 8 : 7}" class="c">暂无志愿服务记录</td></tr>`}
      </tbody>
    </table>
    <table style="margin-top:12px">
      <tr>
        <td class="c" style="width:100px;font-weight:700;background:#f5f2ee">公示说明</td>
        <td style="padding:10px 14px">
          如有异议，请在公示期内向党支部委员会反馈核实。&nbsp;&nbsp;&nbsp;&nbsp;
          审核人签名：＿＿＿＿＿＿＿＿ &nbsp;&nbsp;&nbsp;&nbsp;
          日期：＿＿＿＿ 年 ＿＿ 月 ＿＿ 日
        </td>
      </tr>
    </table>
    <div class="foot">
      <span>仅统计状态为「已认定」的志愿服务时长</span>
      <span>三尺台 · 志愿时长台账</span>
    </div>
  `;
}
