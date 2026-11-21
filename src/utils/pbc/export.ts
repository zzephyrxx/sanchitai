/* ============================================================
 * export.ts — 高清导出 / A4 对折拼版 / 打印 / 批量 ZIP（纯前端，无依赖）
 * ============================================================ */
import { saveAs } from 'file-saver';
import { H, W, paint, toBlob, type PageKind } from './render';
import { partyAge, type PbcState } from './templates';

const AW = 1754;
const AH = 1240; /* A4 横向 @150dpi */

export interface PbcRosterRow {
  name: string;
  joinDate: string;
  wishes: string;
  branch: string;
  signDate: string;
  partyAge: string;
}

function safeName(s?: string): string {
  return String(s || '未命名')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .slice(0, 40);
}

export function saveBlob(blob: Blob, filename: string): void {
  saveAs(blob, filename);
}

/** 单页高清导出 */
export async function downloadPage(
  kind: PageKind,
  S: PbcState,
  opt: { scale?: number; type?: string; quality?: number } = {}
): Promise<Blob> {
  const scale = opt.scale || 2;
  const type = opt.type || 'image/png';
  const quality = opt.quality === undefined ? 0.94 : opt.quality;
  const blob = await toBlob(kind, S, scale, type, quality);
  const ext = type === 'image/jpeg' ? 'jpg' : 'png';
  const pageName = kind === 'cover' ? '封面' : '内页';
  saveBlob(blob, `${safeName(S.name)}_政治生日卡_${pageName}.${ext}`);
  return blob;
}

/** A4 对折拼版：side = 'front' 正面（封面展开） / 'back' 背面（内页展开） */
export function sheetCanvas(
  side: 'front' | 'back',
  S: PbcState,
  opt: { margin?: number } = {}
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = AW;
  c.height = AH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, AW, AH);

  const margin = opt.margin || 42;
  const scale = Math.min((AW - margin * 2) / W, (AH - margin * 2) / H);
  const pw = W * scale;
  const ph = H * scale;
  const px = (AW - pw) / 2;
  const py = (AH - ph) / 2;

  paint(ctx, side === 'front' ? 'cover' : 'inner', S, scale, px, py);

  ctx.save();
  ctx.strokeStyle = 'rgba(60,50,40,0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(px - 0.5, py - 0.5, pw + 1, ph + 1);

  ctx.setLineDash([9, 7]);
  ctx.strokeStyle = 'rgba(150,45,40,0.85)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(AW / 2, py - 24);
  ctx.lineTo(AW / 2, py - 3);
  ctx.moveTo(AW / 2, py + ph + 3);
  ctx.lineTo(AW / 2, py + ph + 24);
  ctx.stroke();
  ctx.setLineDash([]);

  const t = 16;
  const d = 9;
  ctx.strokeStyle = 'rgba(50,45,40,0.65)';
  ctx.lineWidth = 1.2;
  const corners: Array<[number, number, number, number]> = [
    [px, py, 1, 1],
    [px + pw, py, -1, 1],
    [px, py + ph, 1, -1],
    [px + pw, py + ph, -1, -1]
  ];
  corners.forEach(p => {
    ctx.beginPath();
    ctx.moveTo(p[0] + p[2] * d, p[1]);
    ctx.lineTo(p[0] + p[2] * t, p[1]);
    ctx.moveTo(p[0], p[1] + p[3] * d);
    ctx.lineTo(p[0], p[1] + p[3] * t);
    ctx.stroke();
  });

  const label = side === 'front' ? '正面 · 封面 / 封底' : '背面 · 内页（入党誓词 / 政治生日寄语）';
  ctx.fillStyle = '#7A6C58';
  ctx.font = '17px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`政治生日贺卡 · A4 对折拼版　|　${label}`, px, 26);
  ctx.textAlign = 'right';
  ctx.fillText('沿中线虚线对折 · 沿外框裁切 · 双面打印请选择「短边翻转」', px + pw, AH - 14);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#B4161B';
  ctx.fillText('折', AW / 2, py - 12);
  ctx.restore();
  return c;
}

export function downloadSheet(side: 'front' | 'back', S: PbcState): Promise<Blob> {
  const c = sheetCanvas(side, S);
  return new Promise((resolve, reject) => {
    c.toBlob(b => {
      if (!b) {
        reject(new Error('导出拼版失败'));
        return;
      }
      const sideLabel = side === 'front' ? '正面' : '背面';
      saveBlob(b, `${safeName(S.name)}_A4拼版_${sideLabel}.png`);
      resolve(b);
    }, 'image/png');
  });
}

/** 打印：使用 Blob URL 打开新窗口放两页 A4 横向，自动调起打印 */
export function printSheet(S: PbcState): void {
  const front = sheetCanvas('front', S).toDataURL('image/png');
  const back = sheetCanvas('back', S).toDataURL('image/png');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>政治生日贺卡 · A4 对折打印</title><style>
@page{size:A4 landscape;margin:0}
html,body{margin:0;padding:0;background:#fff}
.page{width:297mm;height:210mm;page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
.page img{width:100%;height:100%;display:block}
.tip{position:fixed;left:0;right:0;bottom:0;padding:10px 16px;background:#7A0B10;color:#ffe9bd;font:14px/1.6 "PingFang SC",sans-serif;text-align:center;z-index:9}
@media print{.tip{display:none}}
</style></head><body>
<div class="page"><img src="${front}" alt="正面"></div>
<div class="page"><img src="${back}" alt="背面"></div>
<div class="tip">共 2 页：第 1 页正面、第 2 页背面。双面打印请选择「短边翻转」，打印后沿中线对折、沿外框裁切。</div>
<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script>
</body></html>`;
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const w = window.open(blobUrl, '_blank');
  if (!w) {
    URL.revokeObjectURL(blobUrl);
    window.$message?.error('打印窗口被拦截，请允许本页弹出窗口后重试');
    return;
  }
  setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
}

/* ---------- 极简 ZIP（store 模式，自算 CRC32，支持中文文件名） ---------- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (let i = 0; i < parts.length; i += 1) len += parts[i].length;
  const out = new Uint8Array(len);
  let off = 0;
  for (let i = 0; i < parts.length; i += 1) {
    out.set(parts[i], off);
    off += parts[i].length;
  }
  return out;
}

function u16(v: number): Uint8Array {
  return new Uint8Array([v & 255, (v >>> 8) & 255]);
}
function u32(v: number): Uint8Array {
  return new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
}

export function makeZip(files: Array<{ name: string; data: Uint8Array }>): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data
    ]);
    locals.push(local);
    centrals.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ])
    );
    offset += local.length;
  });
  const cd = concat(centrals);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(cd.length),
    u32(offset),
    u16(0)
  ]);
  const zipBytes = concat(locals.concat([cd, eocd]));
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/** 批量导出 ZIP */
export async function batchExportZip(
  rows: PbcRosterRow[],
  base: PbcState,
  opt: { scale?: number } = {},
  onProgress?: (index: number, total: number, row: PbcRosterRow | null) => void
): Promise<number> {
  const scale = opt.scale || 2;
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const csv: string[] = ['姓名,入党日期,党龄,寄语,支部名称'];

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    if (onProgress) onProgress(idx, rows.length, row);
    const S: PbcState = {
      ...base,
      name: row.name || base.name,
      joinDate: row.joinDate || base.joinDate,
      branch: row.branch || base.branch,
      wishes: row.wishes || base.wishes,
      signDate: row.signDate || base.signDate,
      partyAgeMode: row.partyAge ? 'manual' : base.partyAgeMode,
      partyAge: row.partyAge || base.partyAge
    };
    const prefix = `${String(idx + 1).padStart(2, '0')}_${safeName(S.name)}`;
    csv.push(
      [
        S.name,
        S.joinDate,
        partyAge(S),
        `"${String(S.wishes || '').replace(/"/g, '""')}"`,
        `"${String(S.branch || '').replace(/"/g, '""')}"`
      ].join(',')
    );
    const [coverBlob, innerBlob] = await Promise.all([
      toBlob('cover', S, scale, 'image/png'),
      toBlob('inner', S, scale, 'image/png')
    ]);
    const [coverBytes, innerBytes] = await Promise.all([blobBytes(coverBlob), blobBytes(innerBlob)]);
    files.push({ name: `${prefix}_封面.png`, data: coverBytes });
    files.push({ name: `${prefix}_内页.png`, data: innerBytes });
  }

  files.push({ name: '名单.csv', data: new TextEncoder().encode(`\uFEFF${csv.join('\r\n')}`) });
  const zip = makeZip(files);
  saveBlob(zip, `政治生日贺卡_${rows.length}人_${new Date().toISOString().slice(0, 10)}.zip`);
  if (onProgress) onProgress(rows.length, rows.length, null);
  return files.length;
}

/** 逐张下载（不打包） */
export async function batchSequential(
  rows: PbcRosterRow[],
  base: PbcState,
  opt: { scale?: number; type?: string } = {},
  onProgress?: (index: number, total: number, row: PbcRosterRow | null) => void
): Promise<void> {
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    if (onProgress) onProgress(idx, rows.length, row);
    const S: PbcState = {
      ...base,
      name: row.name.trim() || base.name,
      joinDate: row.joinDate.trim() || base.joinDate,
      wishes: row.wishes.trim() || base.wishes,
      branch: row.branch.trim() || base.branch,
      signDate: row.signDate.trim() || base.signDate,
      partyAge: row.partyAge.trim() || base.partyAge,
      partyAgeMode: row.partyAge.trim() ? 'manual' : base.partyAgeMode
    };
    await downloadPage('cover', S, opt);
    await downloadPage('inner', S, opt);
  }
}
