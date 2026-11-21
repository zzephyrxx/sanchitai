/* ============================================================
 * art.ts — 程序化装饰素材库（纯 Canvas 2D，零外部依赖）
 * 所有函数使用「逻辑坐标系」：W x H，由渲染层统一 setTransform(scale)
 * ============================================================ */
import { EMBLEM_DATA } from './emblem-data';
import { FLAG_DATA } from './flag-data';

const TAU = Math.PI * 2;

export type FontFamilyKey = 'song' | 'kai' | 'hei';

export const FONTS: Record<FontFamilyKey, string> = {
  song: '"Songti SC","STSong","SimSun","Noto Serif CJK SC","Source Han Serif SC",serif',
  kai: '"Kaiti SC","STKaiti","KaiTi","STKaiti SC","Noto Serif CJK SC",serif',
  hei: '"PingFang SC","Microsoft YaHei","Heiti SC","Noto Sans CJK SC",sans-serif'
};

export function font(family: string, size: number, weight?: string): string {
  const prefix = weight ? `${weight} ` : '';
  const rounded = Math.round(size * 10) / 10;
  const fam = FONTS[family as FontFamilyKey] || FONTS.song;
  return `${prefix}${rounded}px ${fam}`;
}

export const PALETTE = {
  red: '#E82820',
  redDeep: '#9E0F12',
  redDark: '#7A0B10',
  redMid: '#C41820',
  redBright: '#F2413B',
  gold: '#F8C830',
  goldLight: '#F7E3A8',
  goldDeep: '#B78320',
  goldPale: '#EAD8A6',
  ink: '#2C2622',
  inkSoft: '#5A5148',
  paper: '#FBF6EC',
  paperWarm: '#F5EADA',
  cream: '#F8F1E2'
} as const;

export function rgba(hex: string, a: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const n = Number.parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(c1: string, c2: string, t: number): string {
  function parseHex(c: string): [number, number, number] {
    const h = c.replace('#', '');
    const n = Number.parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const a = parseHex(c1);
  const b = parseHex(c2);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/** 可复现伪随机 */
export function rng(seed?: number): () => number {
  let s = (seed ?? 1) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** 线性渐变 */
export function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: ReadonlyArray<readonly [number, string]>
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(s => {
    g.addColorStop(s[0], s[1]);
  });
  return g;
}

/** 径向渐变 */
export function radial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  stops: ReadonlyArray<readonly [number, string]>
): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(s => {
    g.addColorStop(s[0], s[1]);
  });
  return g;
}

/** 金属质感金渐变，tone: -1 ~ 1 调整明暗 */
export function goldGrad(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tone = 0
): CanvasGradient {
  function shift(h: string): string {
    const n = Number.parseInt(h.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) + tone * 26));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) + tone * 24));
    const b = Math.min(255, Math.max(0, (n & 255) + tone * 18));
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  }
  return linear(ctx, x0, y0, x1, y1, [
    [0, shift('#FFF1C4')],
    [0.18, shift('#E7BE58')],
    [0.38, shift('#FFF4CE')],
    [0.58, shift('#D9A23C')],
    [0.76, shift('#F4D888')],
    [1, shift('#B47A20')]
  ]);
}

export interface TextOpts {
  size?: number;
  font?: string;
  weight?: string;
  baseline?: CanvasTextBaseline;
  fill?: string | CanvasGradient;
  color?: string;
  alpha?: number;
  shadow?: string;
  blur?: number;
  shadowY?: number;
  spacing?: number;
  align?: CanvasTextAlign;
  maxWidth?: number;
  minSize?: number;
  gap?: number;
  maxBottom?: number;
}

/** 单行文，支持 letterSpacing（逐字绘制） */
export function text(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: TextOpts = {}
): CanvasRenderingContext2D {
  const size = o.size || 24;
  ctx.save();
  ctx.font = font(o.font || 'song', size, o.weight);
  ctx.textAlign = 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';
  ctx.fillStyle = o.fill || o.color || PALETTE.ink;
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.shadow) {
    ctx.shadowColor = o.shadow;
    ctx.shadowBlur = o.blur || 8;
    ctx.shadowOffsetY = o.shadowY || 0;
  }
  const sp = o.spacing || 0;
  if (!sp) {
    if (o.align === 'center') ctx.textAlign = 'center';
    else if (o.align === 'right') ctx.textAlign = 'right';
    if (o.maxWidth) ctx.fillText(str, x, y, o.maxWidth);
    else ctx.fillText(str, x, y);
  } else {
    const chars = Array.from(str);
    let total = 0;
    for (let i = 0; i < chars.length; i += 1) {
      total += ctx.measureText(chars[i]).width + sp;
    }
    total -= sp;
    let sx = x;
    if (o.align === 'center') sx = x - total / 2;
    else if (o.align === 'right') sx = x - total;
    for (let i = 0; i < chars.length; i += 1) {
      ctx.fillText(chars[i], sx, y);
      sx += ctx.measureText(chars[i]).width + sp;
    }
  }
  ctx.restore();
  return ctx;
}

export function measure(
  ctx: CanvasRenderingContext2D,
  str: string,
  size: number,
  family?: string,
  weight?: string,
  spacing?: number
): number {
  ctx.save();
  ctx.font = font(family || 'song', size, weight);
  const w = ctx.measureText(str).width + (spacing || 0) * (Array.from(str).length - 1);
  ctx.restore();
  return w;
}

/** 竖排文字：逐字下排；空格留半格；标点做视觉偏移 */
export function vText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: TextOpts = {}
): number {
  const size = o.size || 40;
  const gap = o.gap === undefined ? size * 0.24 : o.gap;
  let cy = y;
  const punct = '，。、；：！？）》」』';
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\u3000') {
      cy += size * 0.55;
      continue;
    }
    const isPunct = punct.includes(ch);
    const ox = isPunct ? size * 0.28 : 0;
    const oy = isPunct ? -size * 0.12 : 0;
    text(ctx, ch, x + ox, cy + oy, {
      size,
      font: o.font,
      weight: o.weight,
      fill: o.fill || o.color,
      align: 'center',
      alpha: o.alpha,
      spacing: 0,
      shadow: o.shadow,
      blur: o.blur
    });
    cy += size + gap;
  }
  return cy;
}

/** 竖排自适应：按可用高度缩放，保证不越界、不压住下方元素 */
export function vTextFit(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: TextOpts = {}
): number {
  let size = o.size || 40;
  let gap = o.gap === undefined ? size * 0.24 : o.gap;
  let units = 0;
  Array.from(str).forEach(c => {
    units += c === ' ' || c === '\u3000' ? 0.55 : 1;
  });
  const total = units * (size + gap) - gap;
  if (o.maxBottom && y + total > o.maxBottom) {
    const k = Math.max(0.5, (o.maxBottom - y) / total);
    size *= k;
    gap *= k;
  }
  return vText(ctx, str, x, y, { ...o, size, gap });
}

export interface WrapOpts extends TextOpts {
  lineHeight?: number;
  maxLines?: number;
  underline?: string | null;
  paragraphGap?: number;
  onLine?: (line: string, y: number, index: number) => void;
}

/** 中文自动换行，避免标点落在行首。返回 {lines, endY, lineYs} */
export function wrap(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  o: WrapOpts = {}
): { lines: string[]; endY: number; lineYs: number[] } {
  const size = o.size || 22;
  const lh = o.lineHeight || size * 1.85;
  const maxW = o.maxWidth || 400;
  const maxLines = o.maxLines || 99;
  const noStart = '，。、；：！？）》」』,.;:!?';
  ctx.save();
  ctx.font = font(o.font || 'song', size, o.weight);
  const paras = String(str).split('\n');
  const lines: string[] = [];
  const lineYs: number[] = [];
  let cy = y;

  function push(l: string) {
    if (l) {
      lines.push(l);
      lineYs.push(cy);
    }
    if (o.underline) {
      ctx.strokeStyle = o.underline;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, cy + size * 0.38);
      ctx.lineTo(x + maxW, cy + size * 0.38);
      ctx.stroke();
    }
    if (o.onLine) o.onLine(l, cy, lines.length - 1);
    cy += lh;
  }

  for (let p = 0; p < paras.length; p += 1) {
    const chars = Array.from(paras[p]);
    let line = '';
    for (let i = 0; i < chars.length; i += 1) {
      const c = chars[i];
      const test = line + c;
      if (ctx.measureText(test).width > maxW && line) {
        if (noStart.includes(c)) {
          line += c;
          push(line);
          line = '';
        } else {
          push(line);
          line = c;
        }
      } else {
        line = test;
      }
      if (lines.length >= maxLines) break;
    }
    if (line && lines.length < maxLines) push(line);
    if (lines.length >= maxLines) break;
    if (o.paragraphGap && p < paras.length - 1) cy += o.paragraphGap;
  }
  ctx.restore();

  for (let k = 0; k < lines.length; k += 1) {
    text(ctx, lines[k], x, lineYs[k], {
      size,
      font: o.font,
      weight: o.weight,
      fill: o.fill || o.color,
      alpha: o.alpha,
      align: o.align,
      spacing: o.spacing || 0,
      shadow: o.shadow,
      blur: o.blur
    });
  }
  return { lines, endY: cy, lineYs };
}

/** 一行文字按可用宽度自动缩小字号 */
export function fitText(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  maxW: number,
  o: TextOpts = {}
): CanvasRenderingContext2D {
  let size = o.size || 30;
  ctx.save();
  ctx.font = font(o.font || 'song', size, o.weight);
  const w = ctx.measureText(str).width + (o.spacing || 0) * Math.max(0, Array.from(str).length - 1);
  ctx.restore();
  if (w > maxW && o.minSize) {
    size = Math.max(o.minSize, (size * maxW) / w);
  }
  return text(ctx, str, x, y, { ...o, size, maxWidth: maxW });
}

/* ---------- 底纹 ---------- */
const noiseCache: Record<string, HTMLCanvasElement> = {};
export function paperNoise(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seed?: number,
  alpha?: number
): void {
  const key = `${seed ?? 7}|${alpha ?? 0.5}`;
  if (!noiseCache[key]) {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 160;
    const g = c.getContext('2d')!;
    const rnd = rng(seed || 7);
    const img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = rnd();
      const dark = v > 0.62;
      img.data[i] = dark ? 120 : 255;
      img.data[i + 1] = dark ? 96 : 251;
      img.data[i + 2] = dark ? 72 : 240;
      img.data[i + 3] = dark ? Math.round(rnd() * 26) : Math.round(rnd() * 12);
    }
    g.putImageData(img, 0, 0);
    noiseCache[key] = c;
  }
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 0.5 : alpha;
  const pat = ctx.createPattern(noiseCache[key], 'repeat');
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

export function vignette(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  strength?: number,
  color?: string
): void {
  const g = radial(ctx, W / 2, H / 2, Math.min(W, H) * 0.2, Math.max(W, H) * 0.78, [
    [0, 'rgba(0,0,0,0)'],
    [1, rgba(color || '#3A0000', strength || 0.45)]
  ]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- 素材 1：同心弧线束 ---------- */
export function arcFan(
  ctx: CanvasRenderingContext2D,
  o: {
    cx: number;
    cy: number;
    r0: number;
    r1: number;
    a0?: number;
    a1?: number;
    count?: number;
    width?: number;
    color?: string;
    alpha?: number;
  }
): void {
  const { cx, cy, r0, r1 } = o;
  const a0 = o.a0 === undefined ? -1.45 : o.a0;
  const a1 = o.a1 === undefined ? 1.15 : o.a1;
  const n = o.count || 110;
  const w = o.width || 0.9;
  ctx.save();
  ctx.lineWidth = w;
  ctx.strokeStyle = o.color || 'rgba(255,190,180,0.30)';
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const r = r0 + (r1 - r0) * t;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- 素材 2：红绸飘带 ---------- */
export function silkRibbon(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: { y?: number; amp?: number; seed?: number; layers?: number; layerGap?: number } = {}
): void {
  const baseY = o.y === undefined ? H * 0.86 : o.y;
  const amp = o.amp || 42;
  const rnd = rng(o.seed || 19);
  const layers = o.layers || 5;
  const phases: number[] = [];
  for (let p = 0; p < layers; p += 1) phases.push(rnd() * TAU);
  ctx.save();
  for (let l = layers - 1; l >= 0; l -= 1) {
    const off = l * (o.layerGap || 13);
    const y0 = baseY + off;
    const ph = phases[l];
    const g = linear(ctx, 0, y0 - amp, 0, H, [
      [0, rgba(l % 2 ? '#FF6A52' : '#EE3A30', 0.28 + l * 0.045)],
      [0.45, rgba('#D82024', 0.38 + l * 0.035)],
      [1, rgba('#6E0810', 0.6)]
    ]);
    ctx.fillStyle = g;
    const waveY = (x: number) =>
      y0 -
      amp *
        (0.28 +
          Math.sin(x * 0.0062 + ph) * 0.52 +
          Math.sin(x * 0.0138 + ph * 1.6) * 0.2 +
          Math.sin(x * 0.0031 + ph * 0.6) * 0.16);
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    ctx.lineTo(-20, waveY(-20));
    for (let x = -20; x <= W + 20; x += 10) ctx.lineTo(x, waveY(x));
    ctx.lineTo(W + 20, H + 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba('#FFB39A', 0.16 + (layers - l) * 0.012);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-20, waveY(-20));
    for (let x2 = -20; x2 <= W + 20; x2 += 10) ctx.lineTo(x2, waveY(x2));
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- 素材 3：写意山峦 ---------- */
const WARM_MOUNTAIN_COLORS = ['#E8C79B', '#D9AE7E', '#C9935F', '#B87C4A', '#9B6138'];
const COOL_MOUNTAIN_COLORS = ['#C9B7A2', '#AE9A86', '#94816F', '#7A6858', '#5E4F43'];

function pickMountainColor(colors: string[] | undefined, warm: boolean, index: number): string {
  if (colors && colors.length > 0) {
    return colors[index % colors.length];
  }
  const palette = warm ? WARM_MOUNTAIN_COLORS : COOL_MOUNTAIN_COLORS;
  return palette[index % palette.length];
}

export function mountains(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: {
    y?: number;
    layers?: number;
    seed?: number;
    warm?: boolean;
    amp?: number;
    rise?: number;
    colors?: string[];
    alpha?: number;
    mist?: boolean;
    mistH?: number;
    paper?: string;
  } = {}
): void {
  const baseY = o.y === undefined ? H * 0.86 : o.y;
  const layers = o.layers || 5;
  const rnd = rng(o.seed || 33);
  const warm = Boolean(o.warm);
  ctx.save();
  for (let l = 0; l < layers; l += 1) {
    const t = l / Math.max(1, layers - 1);
    const amp = (o.amp || 90) * (1 - t * 0.48);
    const yBase = baseY - t * (o.rise || 26);
    const col = pickMountainColor(o.colors, warm, l);
    const baseAlpha = o.alpha === undefined ? 0.4 : o.alpha;
    const alpha = baseAlpha * (0.5 + t * 0.55);
    ctx.fillStyle = rgba(col, alpha);
    const step = W / 42;
    const pts: Array<[number, number]> = [];
    for (let x = -20; x <= W + 30; x += step) {
      const n1 = Math.sin(x * 0.0046 + l * 1.7) * 0.6 + Math.sin(x * 0.0102 + l * 0.9) * 0.22;
      const n2 = (rnd() - 0.5) * 0.14;
      pts.push([x, yBase - amp * (0.58 + n1 + n2)]);
    }
    const drawRidge = (withMove: boolean) => {
      if (withMove) ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i += 1) {
        ctx.quadraticCurveTo(
          pts[i - 1][0],
          pts[i - 1][1],
          (pts[i - 1][0] + pts[i][0]) / 2,
          (pts[i - 1][1] + pts[i][1]) / 2
        );
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    };
    ctx.beginPath();
    ctx.moveTo(-20, H + 20);
    ctx.lineTo(pts[0][0], pts[0][1]);
    drawRidge(false);
    ctx.lineTo(W + 30, H + 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(warm ? '#8C5A2E' : '#5A4B3C', alpha * 0.45);
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    drawRidge(true);
    ctx.stroke();
  }
  if (o.mist !== false) {
    const mh = o.mistH || 130;
    ctx.fillStyle = linear(ctx, 0, baseY - mh, 0, baseY + 40, [
      [0, 'rgba(255,253,246,0)'],
      [0.45, rgba(o.paper || '#FBF6EC', 0.55)],
      [1, 'rgba(255,253,246,0)']
    ]);
    ctx.fillRect(0, baseY - mh, W, mh + 40);
  }
  ctx.restore();
}

/* ---------- 素材 4：长城剪影 ---------- */
export function greatWall(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: { y?: number; color?: string; alpha?: number } = {}
): void {
  const y = o.y === undefined ? H * 0.8 : o.y;
  const color = o.color || '#B98254';
  const alpha = o.alpha === undefined ? 0.55 : o.alpha;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  function ridge(x: number) {
    return y - Math.sin(x * 0.0042 + 0.9) * 26 - Math.sin(x * 0.011) * 12;
  }
  ctx.beginPath();
  for (let x = W * 0.5; x <= W * 0.99; x += 14) ctx.lineTo(x, ridge(x));
  for (let x2 = W * 0.99; x2 >= W * 0.5; x2 -= 14) ctx.lineTo(x2, ridge(x2) + 15);
  ctx.closePath();
  ctx.fill();
  for (let dx = W * 0.51; dx < W * 0.99; dx += 17) {
    const ry = ridge(dx);
    ctx.fillRect(dx, ry - 7, 8, 8);
  }
  const towers = [0.63, 0.78, 0.9];
  towers.forEach((t, i) => {
    const tx = W * t;
    const ty = ridge(tx) - (i === 1 ? 36 : 24);
    const tw = 30 + i * 4;
    const th = 34 + i * 5;
    ctx.fillRect(tx - tw / 2, ty, tw, th);
    ctx.fillRect(tx - tw / 2 - 4, ty - 6, tw + 8, 7);
    for (let k = 0; k < 4; k += 1) ctx.fillRect(tx - tw / 2 - 4 + (k * (tw + 8)) / 4, ty - 11, 6, 6);
    ctx.globalAlpha = alpha * 0.42;
    ctx.fillStyle = '#5C3A22';
    ctx.fillRect(tx - 7, ty + th * 0.42, 14, th * 0.58);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
  });
  ctx.restore();
}

/* ---------- 素材 5：金线扇形 ---------- */
export function lineFan(
  ctx: CanvasRenderingContext2D,
  o: {
    cx: number;
    cy: number;
    r?: number;
    a0?: number;
    a1?: number;
    count?: number;
    color?: string;
    alpha?: number;
    width?: number;
    bend?: number;
  }
): void {
  const { cx, cy } = o;
  const r = o.r || 600;
  const a0 = o.a0 === undefined ? -1.2 : o.a0;
  const a1 = o.a1 === undefined ? 0.55 : o.a1;
  const n = o.count || 90;
  const color = o.color || '#C9A665';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = o.alpha === undefined ? 0.28 : o.alpha;
  ctx.lineWidth = o.width || 0.7;
  for (let i = 0; i <= n; i += 1) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ex = cx + Math.cos(a) * r;
    const ey = cy + Math.sin(a) * r;
    const bend = (o.bend || 0.18) * r;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(
      cx + Math.cos(a - 0.28) * r * 0.5 + bend * 0.12,
      cy + Math.sin(a - 0.28) * r * 0.5,
      ex,
      ey
    );
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- 素材 6：中式回纹角花 ---------- */
export function fretCorner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rot?: number,
  color?: string,
  lw?: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot || 0);
  ctx.strokeStyle = color || PALETTE.red;
  ctx.lineWidth = lw || 2.2;
  ctx.lineJoin = 'miter';
  const u = s / 8;
  function drawPath(pts: Array<[number, number]>) {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i) ctx.lineTo(p[0] * u, p[1] * u);
      else ctx.moveTo(p[0] * u, p[1] * u);
    });
    ctx.stroke();
  }
  drawPath([
    [0, 8],
    [0, 0],
    [8, 0]
  ]);
  drawPath([
    [1.2, 6.6],
    [1.2, 1.2],
    [6.6, 1.2],
    [6.6, 5.2],
    [3.4, 5.2],
    [3.4, 3.4],
    [5.2, 3.4]
  ]);
  drawPath([
    [2.4, 6.6],
    [6.6, 6.6]
  ]);
  ctx.fillStyle = color || PALETTE.red;
  ctx.fillRect(0, 0, u * 0.9, u * 0.9);
  ctx.restore();
}

/* ---------- 素材 7：祥云纹 ---------- */
export function cloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  color?: string,
  alpha?: number
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 100, s / 100);
  ctx.strokeStyle = color || PALETTE.gold;
  ctx.globalAlpha = alpha === undefined ? 0.6 : alpha;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-48, 12);
  ctx.bezierCurveTo(-54, -4, -36, -14, -24, -6);
  ctx.bezierCurveTo(-24, -24, 4, -28, 10, -8);
  ctx.bezierCurveTo(24, -20, 46, -8, 40, 8);
  ctx.bezierCurveTo(52, 10, 52, 22, 40, 22);
  ctx.lineTo(-36, 22);
  ctx.bezierCurveTo(-52, 22, -54, 14, -48, 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-28, 30);
  ctx.bezierCurveTo(-16, 38, 10, 38, 26, 30);
  ctx.stroke();
  ctx.restore();
}

/* ---------- 素材 8：放射光芒 ---------- */
export function rays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  o: { count?: number; offset?: number; widthScale?: number; color?: string; alpha?: number } = {}
): void {
  const n = o.count || 72;
  ctx.save();
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU + (o.offset || 0);
    const w = (i % 3 === 0 ? 0.028 : 0.012) * (o.widthScale || 1);
    const g = linear(ctx, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, [
      [0, rgba(o.color || '#FFD970', o.alpha === undefined ? 0.18 : o.alpha)],
      [1, 'rgba(255,215,112,0)']
    ]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a - w, a + w);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- 素材 9：曲线底纹 ---------- */
export function guilloche(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: { count?: number; alpha?: number; color?: string; width?: number; cx?: number; cy?: number; r?: number; squash?: number } = {}
): void {
  const n = o.count || 46;
  ctx.save();
  ctx.globalAlpha = o.alpha === undefined ? 0.1 : o.alpha;
  ctx.strokeStyle = o.color || PALETTE.gold;
  ctx.lineWidth = o.width || 0.7;
  const cx = o.cx === undefined ? W / 2 : o.cx;
  const cy = o.cy === undefined ? H / 2 : o.cy;
  const R = o.r || Math.max(W, H) * 0.55;
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * TAU;
    ctx.beginPath();
    for (let k = 0; k <= 90; k += 1) {
      const a = (k / 90) * TAU;
      const rr = R * (0.72 + 0.2 * Math.sin(6 * a + t * 3) + 0.08 * Math.cos(11 * a - t * 2));
      const x = cx + Math.cos(a + t * 0.16) * rr;
      const y = cy + Math.sin(a + t * 0.16) * rr * (o.squash || 0.72);
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- 素材 10：五角星 ---------- */
export function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  o: { fill?: string; alpha?: number; rotate?: number } = {}
): void {
  ctx.save();
  ctx.fillStyle = o.fill || PALETTE.gold;
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5 + (o.rotate || 0);
    const rr = i % 2 ? r * 0.4 : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ---------- 素材 11：印章 ---------- */
export function seal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  sealText: string,
  o: { rotate?: number; color?: string; alpha?: number } = {}
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(o.rotate || 0);
  ctx.fillStyle = o.color || '#B7221B';
  ctx.globalAlpha = o.alpha === undefined ? 0.86 : o.alpha;
  const r = s * 0.08;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(s - r, 0);
  ctx.quadraticCurveTo(s, 0, s, r);
  ctx.lineTo(s, s - r);
  ctx.quadraticCurveTo(s, s, s - r, s);
  ctx.lineTo(r, s);
  ctx.quadraticCurveTo(0, s, 0, s - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = s * 0.035;
  ctx.strokeStyle = rgba('#FFFFFF', 0.55);
  ctx.strokeRect(s * 0.075, s * 0.075, s * 0.85, s * 0.85);
  const chars = Array.from(sealText || '不忘初心');
  const cols = chars.length > 2 ? 2 : 1;
  const fs = s * (chars.length > 2 ? 0.3 : 0.46);
  for (let i = 0; i < chars.length; i += 1) {
    const col = cols === 2 ? i % 2 : 0;
    const row = cols === 2 ? Math.floor(i / 2) : i;
    const rows = cols === 2 ? Math.ceil(chars.length / 2) : chars.length;
    let xRatio = 0.5;
    if (cols === 2) {
      xRatio = col ? 0.73 : 0.27;
    }
    text(ctx, chars[i], s * xRatio, s * (0.16 + (row + 0.78) * (0.72 / rows)), {
      size: fs,
      font: 'song',
      fill: '#FFF6F0',
      align: 'center'
    });
  }
  ctx.restore();
}

/* ---------- 素材 12：双线边框 + 四角回纹 ---------- */
export function frame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: {
    margin?: number;
    color?: string;
    width?: number;
    alpha?: number;
    style?: 'double' | 'top' | 'single';
    corners?: boolean;
    cornerSize?: number;
    cornerColor?: string;
    allCorners?: boolean;
  } = {}
): void {
  const m = o.margin || 44;
  const color = o.color || PALETTE.red;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = o.width || 2;
  ctx.globalAlpha = o.alpha === undefined ? 0.85 : o.alpha;
  if (o.style === 'double') {
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
    ctx.lineWidth = 0.8;
    ctx.strokeRect(m + 6, m + 6, W - (m + 6) * 2, H - (m + 6) * 2);
  } else if (o.style === 'top') {
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.lineTo(W - m, m);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m, m);
    ctx.lineTo(m, H - m);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W - m, H - m);
    ctx.lineTo(W - m, m);
    ctx.stroke();
  } else {
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  }
  ctx.restore();
  if (o.corners !== false) {
    const s = o.cornerSize || 42;
    const col = o.cornerColor || color;
    fretCorner(ctx, m, m, s, 0, col, o.width || 2);
    fretCorner(ctx, W - m, H - m, s, Math.PI, col, o.width || 2);
    if (o.allCorners) {
      fretCorner(ctx, W - m, m, s, Math.PI / 2, col, o.width || 2);
      fretCorner(ctx, m, H - m, s, -Math.PI / 2, col, o.width || 2);
    }
  }
}

/* ---------- 素材 13：飘动旗面 ---------- */
export function flagWave(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  o: { layers?: number } = {}
): void {
  const layerCount = o.layers || 4;
  ctx.save();
  for (let l = 0; l < layerCount; l += 1) {
    const t = l / layerCount;
    const g = linear(ctx, 0, H * (0.42 + t * 0.1), W, H, [
      [0, rgba(l % 2 ? '#F0503F' : '#B80F18', 0.2 + t * 0.1)],
      [0.5, rgba('#D52022', 0.16)],
      [1, rgba('#7C0810', 0.28)]
    ]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, H * (0.62 + t * 0.07));
    ctx.bezierCurveTo(
      W * 0.28,
      H * (0.44 + t * 0.06),
      W * 0.52,
      H * (0.86 + t * 0.04),
      W,
      H * (0.58 + t * 0.06)
    );
    ctx.lineTo(W, H + 10);
    ctx.lineTo(0, H + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---------- 素材 14：党徽与党旗 ---------- */
const emblems: { red: HTMLImageElement | null; gold: HTMLImageElement | null } = { red: null, gold: null };
let flagImg: HTMLImageElement | null = null;
const ready = { red: false, gold: false, flag: false };
let loadPromise: Promise<void> | null = null;

export function loadEmblems(): Promise<void> {
  if (ready.red && ready.gold && ready.flag) {
    return Promise.resolve();
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>(resolve => {
    let pending = 3;
    function done() {
      pending -= 1;
      if (pending === 0) resolve();
    }
    (['red', 'gold'] as const).forEach(k => {
      const img = new Image();
      img.onload = () => {
        emblems[k] = img;
        ready[k] = true;
        done();
      };
      img.onerror = done;
      img.src = EMBLEM_DATA[k] || '';
    });
    const f = new Image();
    f.onload = () => {
      flagImg = f;
      ready.flag = true;
      done();
    };
    f.onerror = done;
    f.src = FLAG_DATA || '';
  });
  return loadPromise;
}

export function emblemsReady(): boolean {
  return ready.red && ready.gold;
}

export function emblem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  o: { variant?: string; alpha?: number; shadow?: string; blur?: number; shadowY?: number; brightness?: number } = {}
): void {
  const img = emblems[o.variant === 'red' ? 'red' : 'gold'];
  if (!img) return;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.shadow) {
    ctx.shadowColor = o.shadow;
    ctx.shadowBlur = o.blur || 16;
    ctx.shadowOffsetY = o.shadowY || 3;
  }
  if (o.brightness) ctx.filter = `brightness(${o.brightness})`;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

export function flag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  o: { alpha?: number; border?: string | false; lineWidth?: number } = {}
): void {
  if (!flagImg) return;
  const h = (w * 683) / 1024;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  ctx.drawImage(flagImg, x, y, w, h);
  if (o.border !== false) {
    ctx.strokeStyle = o.border || 'rgba(240,205,130,0.72)';
    ctx.lineWidth = o.lineWidth || 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}

export function emblemBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  o: { color?: string; variant?: string; alpha?: number } = {}
): void {
  ctx.save();
  const g = radial(ctx, cx, cy - r * 0.3, r * 0.1, r, [
    [0, rgba('#FFF3C8', 0.95)],
    [0.62, rgba(o.color || '#D4A338', 0.55)],
    [1, rgba('#8E5F14', 0.2)]
  ]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(o.color || '#D4A338', 0.85);
  ctx.lineWidth = r * 0.055;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.94, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = r * 0.018;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.8, 0, TAU);
  ctx.stroke();
  ctx.restore();
  emblem(ctx, cx, cy, r * 1.42, { variant: o.variant || 'red', alpha: o.alpha });
}

/* ---------- 素材 15：金色横幅条 ---------- */
export function ribbonBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  barText: string,
  o: { fill?: string | CanvasGradient; size?: number; font?: string; color?: string; spacing?: number } = {}
): void {
  ctx.save();
  ctx.fillStyle = o.fill || linear(ctx, x, y, x, y + h, [[0, '#D41C1B'], [1, '#A20E13']]);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = rgba('#FFFFFF', 0.1);
  ctx.fillRect(x, y, w, h * 0.32);
  ctx.restore();
  if (barText) {
    text(ctx, barText, x + w / 2, y + h * 0.7, {
      size: Math.min(o.size || h * 0.52, h * 0.56),
      font: o.font || 'song',
      fill: o.color || '#FFF3CF',
      align: 'center',
      spacing: o.spacing || h * 0.16
    });
  }
}

/* ---------- 素材 16：细分隔线（两端渐隐） ---------- */
export function rule(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: { color?: string; alpha?: number; width?: number } = {}
): void {
  ctx.save();
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  const c = o.color || '#B9A98C';
  const alpha = o.alpha === undefined ? 0.85 : o.alpha;
  g.addColorStop(0, rgba(c, 0));
  g.addColorStop(0.16, rgba(c, alpha));
  g.addColorStop(0.84, rgba(c, alpha));
  g.addColorStop(1, rgba(c, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = o.width || 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/* ---------- 素材 17：折痕（对折线） ---------- */
export function foldLine(ctx: CanvasRenderingContext2D, _W: number, H: number, x: number): void {
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = 'rgba(150,120,80,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, H);
  ctx.stroke();
  ctx.restore();
}
