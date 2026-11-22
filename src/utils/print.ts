/**
 * 轻量打印套件：生成独立 HTML 新窗口并调起打印（离线可用）
 */

const PRINT_STYLE = `
  * { box-sizing: border-box; }
  body { font-family: 'Songti SC', 'STSong', 'SimSun', serif; color: #1c1c1e; margin: 36px; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 6px; letter-spacing: 2px; }
  .meta { text-align: center; font-size: 12px; color: #666; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #999; padding: 7px 8px; text-align: left; }
  th { background: #f5f2ee; font-weight: 700; }
  td.c, th.c { text-align: center; }
  .foot { margin-top: 22px; display: flex; justify-content: space-between; font-size: 12px; color: #444; }
  @media print { body { margin: 0 24px; } }
`;

export function esc(text: string): string {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function printHtml(title: string, bodyHtml: string): void {
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_STYLE}</style></head><body>${bodyHtml}<script>window.onload=function(){setTimeout(function(){window.print()},120)}</script></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const win = window.open(url, '_blank', 'width=900,height=680');
  if (!win) {
    URL.revokeObjectURL(url);
    window.$message?.error('浏览器拦截了打印窗口，请允许弹窗后重试');
    return;
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 会议签到表 */
export function buildSignInSheet(opts: {
  title: string;
  meta: string;
  rows: Array<{ name: string; type: string; group: string }>;
}): string {
  const rows = opts.rows
    .map(
      (r, i) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(r.name)}</td><td class="c">${esc(r.type)}</td><td>${esc(r.group || '—')}</td><td></td><td></td></tr>`
    )
    .join('');
  return `
    <h1>${esc(opts.title)} 签到表</h1>
    <div class="meta">${esc(opts.meta)}</div>
    <table>
      <tr><th class="c" style="width:44px">序号</th><th style="width:90px">姓名</th><th class="c" style="width:80px">人员类型</th><th style="width:120px">党小组</th><th class="c" style="width:110px">签名</th><th class="c" style="width:110px">到会情况</th></tr>
      ${rows}
    </table>
    <div class="foot"><span>记录人：＿＿＿＿＿＿</span><span>应到 ${opts.rows.length} 人 · 实到 ＿＿ 人</span></div>
  `;
}

/** 座次/工位表 */
export function buildSeatSheet(opts: {
  title: string;
  meta: string;
  cols: number;
  rows: number;
  cells: Array<{ x: number; y: number; name: string; sub: string }>;
}): string {
  const cellMap = new Map(opts.cells.map(c => [`${c.x}-${c.y}`, c]));
  let body = '';
  for (let y = 1; y <= opts.rows; y += 1) {
    body += '<tr>';
    for (let x = 1; x <= opts.cols; x += 1) {
      const c = cellMap.get(`${x}-${y}`);
      body += `<td class="c" style="height:52px">${c ? `<b>${esc(c.name)}</b><br><span style="font-size:10px;color:#666">${esc(c.sub)}</span>` : '<span style="color:#bbb">空位</span>'}</td>`;
    }
    body += '</tr>';
  }
  return `
    <h1>${esc(opts.title)}</h1>
    <div class="meta">${esc(opts.meta)}</div>
    <table>${body}</table>
    <div class="foot"><span>打印时间：${new Date().toLocaleString('zh-CN')}</span></div>
  `;
}
