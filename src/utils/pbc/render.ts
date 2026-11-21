/* ============================================================
 * render.ts — 统一渲染层：预览、缩略图、导出共用同一套绘制逻辑
 * ============================================================ */
import { loadEmblems } from './art';
import { H, TEMPLATE_LIST, TEMPLATE_MAP, W, type PbcState } from './templates';

export { W, H };

export type PageKind = 'cover' | 'inner';

/** 在任意 ctx 上以 (ox,oy) 为左上角、scale 倍率绘制一页 */
export function paint(
  ctx: CanvasRenderingContext2D,
  kind: PageKind,
  S: PbcState,
  scale: number,
  ox = 0,
  oy = 0
): void {
  const tpl = TEMPLATE_MAP[S.template] || TEMPLATE_LIST[0];
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  try {
    if (kind === 'cover') {
      tpl.cover(ctx, S);
    } else {
      tpl.inner(ctx, S);
    }
  } finally {
    ctx.restore();
  }
}

/** 生成一张独立离屏画布 */
export function createCanvas(kind: PageKind, S: PbcState, scale = 1): HTMLCanvasElement {
  const s = scale || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(H * s);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  paint(ctx, kind, S, 1, 0, 0);
  return c;
}

/** 渲染到页面上的预览 canvas */
export function preview(
  canvas: HTMLCanvasElement,
  kind: PageKind,
  S: PbcState,
  scale = 1
): HTMLCanvasElement {
  const s = scale || 1;
  canvas.width = Math.round(W * s);
  canvas.height = Math.round(H * s);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  paint(ctx, kind, S, 1, 0, 0);
  return canvas;
}

function dataURLtoBlob(url: string): Blob {
  const parts = url.split(',');
  const match = parts[0].match(/:(.*?);/);
  const mime = match ? match[1] : 'image/png';
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    arr[i] = bin.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

export function toBlob(
  kind: PageKind,
  S: PbcState,
  scale = 2,
  type = 'image/png',
  quality = 0.94
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const c = createCanvas(kind, S, scale);
    if (!c.toBlob) {
      resolve(dataURLtoBlob(c.toDataURL(type, quality)));
      return;
    }
    c.toBlob(
      b => {
        if (b) resolve(b);
        else reject(new Error('导出失败'));
      },
      type,
      quality
    );
  });
}

/** 资源预载：党徽 data URI + 系统字体就绪 */
export async function ensureReady(): Promise<void> {
  await Promise.all([
    loadEmblems(),
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
  ]);
}
