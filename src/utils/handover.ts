/**
 * 一键交接包：任期大事记 / 待办 / 台账摘要 → 可打印 HTML + 全量数据 JSON
 */
import dayjs from 'dayjs';
import type { BackupShape } from '@/db/db';

/** HTML 文本转义（OCR 规则：插值安全） */
function esc(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildHandoverHtml(shape: BackupShape, branchName: string): string {
  const doneEvents = shape.cal_events
    .filter(e => e.status === '已完成' || e.status === '进行中')
    .sort((a, b) => a.date.localeCompare(b.date));
  const planEvents = shape.cal_events.filter(e => e.status === '计划' && !e.merged_into).sort((a, b) => a.date.localeCompare(b.date));
  const upcomingDev = shape.dev_stages
    .filter(d => d.next_due)
    .sort((a, b) => (a.next_due ?? '').localeCompare(b.next_due ?? ''));
  const owed = shape.fee_records.filter(f => f.status === '欠缴');

  const evRows = doneEvents
    .map(e => `<tr><td class="c">${esc(e.date)}</td><td>${esc(e.kind ?? '')}</td><td>${esc(e.title)}</td><td class="c">${esc(e.location ?? '')}</td></tr>`)
    .join('');

  const planRows = planEvents
    .map(e => `<tr><td class="c">${esc(e.date)}</td><td>${esc(e.kind ?? '')}</td><td>${esc(e.title)}</td></tr>`)
    .join('');

  const devRows = upcomingDev
    .map(d => {
      const m = shape.members.find(x => x.id === d.member_id);
      return `<tr><td class="c">${esc(d.next_due ?? '')}</td><td>${esc(m?.name ?? d.member_id)}</td><td>${esc(d.stage)}</td><td>${esc(d.next_node ?? '')}</td></tr>`;
    })
    .join('');

  const owedMap = new Map<string, string[]>();
  owed.forEach(f => owedMap.set(f.member_id, [...(owedMap.get(f.member_id) ?? []), f.year_month]));
  const owedRows = [...owedMap.entries()]
    .map(([id, months]) => {
      const name = shape.members.find(m => m.id === id)?.name ?? id;
      return `<li>${esc(name)}：${esc(months.join('、'))}</li>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>支部工作交接文档</title>
<style>
 body{font-family:'Songti SC','SimSun',serif;font-size:13px;line-height:1.8;margin:42px;color:#1c1c1e}
 h1{text-align:center;font-size:22px;letter-spacing:3px;margin:0 0 4px}
 h2{font-size:16px;border-left:4px solid #A81C24;padding-left:8px;margin:26px 0 8px}
 table{width:100%;border-collapse:collapse}
 th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
 th{background:#f5f2ee}
 .c{text-align:center}
 .meta{text-align:center;color:#666;font-size:12px;margin-bottom:20px}
 .note{background:#f7f4ef;padding:10px 14px;border:1px dashed #bbb;margin-top:24px;font-size:12px}
</style></head><body>
<h1>支部工作交接文档</h1>
<div class="meta">${esc(branchName)} · 生成于 ${dayjs().format('YYYY年M月D日')} · 由学工工作平台导出</div>

<h2>一、任期大事记（已开展 ${doneEvents.length} 项）</h2>
<table><tr><th class="c" style="width:90px">日期</th><th class="c" style="width:80px">类型</th><th>事项</th><th class="c" style="width:110px">地点</th></tr>${evRows}</table>

<h2>二、待办事项（计划 ${planEvents.length} 项）</h2>
<table><tr><th class="c" style="width:90px">日期</th><th class="c" style="width:80px">类型</th><th>事项</th></tr>${planRows}</table>

<h2>三、党员发展待办节点</h2>
<table><tr><th class="c" style="width:90px">预计日期</th><th class="c" style="width:70px">姓名</th><th class="c" style="width:80px">阶段</th><th>下一步</th></tr>${devRows}</table>

<h2>四、党费欠缴提醒</h2>
<ul>${owedRows || '<li>无欠缴</li>'}</ul>

<h2>五、台账摘要</h2>
<table><tr><th>在册成员</th><th>台历事项</th><th>党费记录</th><th>谈话记录</th><th>发展台账</th></tr>
<tr><td class="c">${shape.members.length}</td><td class="c">${shape.cal_events.length}</td><td class="c">${shape.fee_records.length}</td><td class="c">${shape.talks.length}</td><td class="c">${shape.dev_stages.length}</td></tr></table>

<div class="note">
 交接说明：① 全量数据以「交接数据包.json」为准，接任人在学工工作平台「设置 → 从备份恢复」导入即可接续全部台账；
 ② 应用锁由前任设置时，请在交接前于「设置 → 应用锁」关闭或告知密码与密保答案；
 ③ 纸质档案按学院归档要求另行移交。
</div>
</body></html>`;
}
