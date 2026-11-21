/* ============================================================
 * templates.ts — 6 套「封面 + 内页」模板 + 通用排版组件
 * 逻辑画布 1200 x 933（对应参考素材 1920x1493 的展开比例）
 * ============================================================ */
import * as A from './art';

export const W = 1200;
export const H = 933;

export interface PbcState {
  template: string;
  name: string;
  branch: string;
  joinDate: string;
  signDate: string;
  partyAgeMode: 'auto' | 'manual';
  partyAge: string;
  wishes: string;
  coverTitle: string;
  coverSlogan: string;
  oath: string;
  showOath: boolean;
  showEmblem: boolean;
  showBranchOnCover: boolean;
  showFlag: boolean;
  emblemVariant: 'auto' | 'gold' | 'red';
  font: 'song' | 'kai' | 'hei';
  fontSize: number;
  goldTone: number;
}

export interface PbcTemplate {
  id: string;
  name: string;
  tag: string;
  emblem: 'gold' | 'red';
  desc: string;
  cover: (ctx: CanvasRenderingContext2D, S: PbcState) => void;
  inner: (ctx: CanvasRenderingContext2D, S: PbcState) => void;
}

/* ---------------- 通用排版组件 ---------------- */
function fs(S: PbcState, v: number): number {
  return v * (S.fontSize || 1);
}

function emblemKind(S: PbcState, tpl: { emblem?: 'gold' | 'red' }): string {
  if (!S.emblemVariant || S.emblemVariant === 'auto') {
    return tpl.emblem || 'gold';
  }
  return S.emblemVariant;
}

function gold(ctx: CanvasRenderingContext2D, S: PbcState, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  return A.goldGrad(ctx, x0, y0, x1, y1, S.goldTone || 0);
}

export function partyAge(S: Pick<PbcState, 'partyAgeMode' | 'partyAge' | 'joinDate' | 'signDate'>): string {
  if (S.partyAgeMode === 'manual' && String(S.partyAge).trim() !== '') {
    return String(S.partyAge).trim();
  }
  const j = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(S.joinDate || '');
  if (!j) return '—';
  const ref = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(S.signDate || '');
  let ry = 0;
  let rm = 0;
  let rd = 0;
  if (ref) {
    ry = Number(ref[1]);
    rm = Number(ref[2]);
    rd = Number(ref[3]);
  } else {
    const d = new Date();
    ry = d.getFullYear();
    rm = d.getMonth() + 1;
    rd = d.getDate();
  }
  let y = ry - Number(j[1]);
  if (rm < Number(j[2]) || (rm === Number(j[2]) && rd < Number(j[3]))) {
    y -= 1;
  }
  return String(Math.max(0, y));
}

export function cnDate(str?: string, fb?: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str || '');
  if (m) {
    return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
  }
  return fb || '____ 年 __ 月 __ 日';
}

function family(S: PbcState): string {
  return S.font || 'song';
}

/** 入党誓词块 */
function oath(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  o: {
    x: number;
    y: number;
    w: number;
    size?: number;
    color?: string;
    titleColor?: string;
    title?: boolean;
    ruleColor?: string;
    lineHeight?: number;
    maxLines?: number;
    spacing?: number;
    underline?: string | null;
    alpha?: number;
  }
) {
  if (S.showOath === false) return undefined;
  const { x, y, w } = o;
  const size = fs(S, o.size || 22);
  const color = o.color || '#2E2823';
  const titleColor = o.titleColor || color;
  if (o.title !== false) {
    A.text(ctx, '入党誓词', x + w / 2, y, {
      size: size * 1.5,
      font: family(S),
      fill: titleColor,
      align: 'center',
      spacing: size * 0.32
    });
    A.rule(ctx, x + w * 0.28, y + size * 0.52, x + w * 0.72, y + size * 0.52, {
      color: o.ruleColor || '#C3AA7C',
      alpha: 0.75
    });
  }
  const bodyY = y + (o.title === false ? 0 : size * 2.35);
  const lh = fs(S, o.lineHeight || 43);
  return A.wrap(ctx, S.oath || '', x, bodyY, {
    size,
    font: family(S),
    maxWidth: w,
    lineHeight: lh,
    color,
    maxLines: o.maxLines || 12,
    spacing: o.spacing || 0,
    underline: o.underline || null,
    alpha: o.alpha
  });
}

/** 右栏：称呼 / 入党信息 / 寄语 / 落款 */
function letter(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  o: {
    x: number;
    y: number;
    w: number;
    size?: number;
    color?: string;
    lineHeight?: number;
    wishLineHeight?: number;
    signY?: number;
    ruleColor?: string;
    showLines?: boolean;
    wishCenter?: boolean;
    maxWishLines?: number;
    sign?: boolean;
  }
) {
  const { x, w } = o;
  let y = o.y;
  const size = fs(S, o.size || 22);
  const color = o.color || '#2E2823';
  const lh = fs(S, o.lineHeight || 44);
  let wl = fs(S, o.wishLineHeight || 43);
  const signY = o.signY || H * 0.705;

  A.text(ctx, `${S.name || '____'} 同志：`, x + w, y, {
    size: size * 1.18,
    font: family(S),
    fill: color,
    align: 'right',
    spacing: size * 0.1
  });
  y += size * 1.28;
  A.rule(ctx, x, y, x + w, y, { color: o.ruleColor || '#BCAE93', alpha: 0.7 });
  y += size * 1.3;

  const info = `${cnDate(S.joinDate)}，你光荣加入中国共产党，党龄已 ${partyAge(S)} 年。`;
  const r1 = A.wrap(ctx, info, x, y, {
    size,
    font: family(S),
    maxWidth: w,
    lineHeight: lh,
    color,
    underline: o.showLines ? A.rgba(o.ruleColor || '#BCAE93', 0.55) : null
  });
  y = r1.endY + size * 0.45;

  A.text(ctx, '希望你：', x + (o.wishCenter ? w / 2 : 0), y, {
    size: size * 1.06,
    font: family(S),
    fill: color,
    align: o.wishCenter ? 'center' : 'left',
    spacing: size * 0.14
  });
  y += size * 0.85;
  A.rule(ctx, x, y, x + w, y, { color: o.ruleColor || '#BCAE93', alpha: 0.55 });
  y += size * 1.1;

  let wishSize = size * 0.98;
  const chars = Array.from(S.wishes || '').length;
  const perLine = (sz: number) => Math.max(1, Math.floor(w / (sz * 1.02)));
  const wishBottom = signY - size * 1.6;
  const need = Math.ceil(chars / perLine(wishSize));
  if (need > Math.max(1, Math.floor((wishBottom - y) / wl))) {
    wishSize = size * 0.86;
    wl = fs(S, (o.wishLineHeight || 43) * 0.86);
  }
  let maxLines = Math.max(1, Math.floor((wishBottom - y) / wl));
  maxLines = Math.min(maxLines, o.maxWishLines || 8);
  const r2 = A.wrap(ctx, S.wishes || '', x, y, {
    size: wishSize,
    font: family(S),
    maxWidth: w,
    lineHeight: wl,
    color,
    maxLines,
    underline: o.showLines ? A.rgba(o.ruleColor || '#BCAE93', 0.45) : null
  });

  if (o.sign !== false) {
    A.fitText(ctx, S.branch || '', x + w, signY, w * 1.12, {
      size: size * 0.8,
      minSize: size * 0.62,
      font: family(S),
      fill: color,
      align: 'right',
      alpha: 0.92
    });
    A.text(ctx, cnDate(S.signDate), x + w, signY + size * 1.25, {
      size: size * 0.8,
      font: family(S),
      fill: color,
      align: 'right',
      alpha: 0.92
    });
  }
  return r2;
}

/** 封面底部支部落款 */
function coverBranch(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  x: number,
  y: number,
  o: { size?: number; maxWidth?: number; color?: string; align?: CanvasTextAlign; spacing?: number } = {}
): void {
  if (!S.showBranchOnCover) return;
  const sz = fs(S, o.size || 19);
  A.fitText(ctx, S.branch || '', x, y, o.maxWidth || W * 0.56, {
    size: sz,
    minSize: sz * 0.62,
    font: family(S),
    fill: o.color || 'rgba(255,226,160,0.85)',
    align: o.align || 'left',
    spacing: o.spacing === undefined ? 1.5 : o.spacing
  });
}

/** 红色横条 */
function sloganBar(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  x: number,
  y: number,
  w: number,
  h: number,
  o: { size?: number; color?: string; spacing?: number; fill?: string | CanvasGradient } = {}
): void {
  A.ribbonBar(ctx, x, y, w, h, S.coverSlogan || '不忘初心 牢记使命', {
    size: Math.min(fs(S, o.size || h * 0.5), h * 0.56),
    font: family(S),
    color: o.color || '#FFF0CB',
    spacing: o.spacing === undefined ? h * 0.14 : o.spacing,
    fill: o.fill
  });
}

/** 内页顶部标签 + 细线 */
function topTag(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  o: {
    text?: string;
    x?: number;
    y?: number;
    size?: number;
    spacing?: number;
    color?: string;
    rule?: boolean;
    ruleY?: number;
    ruleEnd?: number;
    ruleColor?: string;
    ruleAlpha?: number;
    ruleWidth?: number;
  } = {}
): void {
  const tagText = o.text || '政治生日卡';
  const x = o.x === undefined ? W * 0.115 : o.x;
  const y = o.y === undefined ? H * 0.085 : o.y;
  const size = fs(S, o.size || 26);
  const sp = fs(S, o.spacing === undefined ? 8 : o.spacing);
  A.text(ctx, tagText, x, y, {
    size,
    font: family(S),
    fill: o.color || '#B4161B',
    spacing: sp
  });
  if (o.rule !== false) {
    const tw = A.measure(ctx, tagText, size, family(S), undefined, sp);
    const ry = o.ruleY === undefined ? y - size * 0.85 : o.ruleY;
    A.rule(ctx, x + tw + 20, ry, o.ruleEnd || W * 0.92, ry, {
      color: o.ruleColor || '#C4161C',
      alpha: o.ruleAlpha || 0.85,
      width: o.ruleWidth || 1.8
    });
  }
}

/** 封面可选党旗 */
function coverFlag(
  ctx: CanvasRenderingContext2D,
  S: PbcState,
  o: { x?: number; y?: number; w?: number; border?: string } = {}
): void {
  if (!S.showFlag) return;
  A.flag(ctx, o.x === undefined ? W * 0.06 : o.x, o.y === undefined ? H * 0.72 : o.y, o.w || 92, {
    border: o.border || 'rgba(240,205,130,0.70)'
  });
}

/* ---------------- 模板 1：红绸经典 ---------------- */
const classic: PbcTemplate = {
  id: 'classic',
  name: '红绸经典',
  tag: '复刻参考',
  emblem: 'gold',
  desc: '深红绸面 + 百道同心弧线 + 竖排烫金标题；内页米金纸配长城山水',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#9C0C14'],
      [0.46, '#C61920'],
      [1, '#8E0810']
    ]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = A.radial(ctx, W * 0.38, H * 0.42, 20, W * 0.8, [
      [0, 'rgba(240,70,58,0.55)'],
      [0.6, 'rgba(214,36,34,0.18)'],
      [1, 'rgba(120,0,10,0)']
    ]);
    ctx.fillRect(0, 0, W, H);

    const ccx = W * 0.3;
    const ccy = H * 0.56;
    const aa0 = -1.44;
    const aa1 = 1.02;
    ctx.fillStyle = A.radial(ctx, W * 0.8, H * 0.3, 30, W * 0.86, [
      [0, 'rgba(255,122,102,0.30)'],
      [0.55, 'rgba(246,72,60,0.13)'],
      [1, 'rgba(246,72,60,0)']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.arcFan(ctx, {
      cx: ccx,
      cy: ccy,
      r0: W * 0.42,
      r1: W * 1.12,
      a0: aa0,
      a1: aa1,
      count: 190,
      color: 'rgba(255,198,186,0.34)',
      width: 0.9
    });
    ctx.save();
    ctx.strokeStyle = 'rgba(255,232,222,0.58)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(ccx, ccy, W * 1.115, aa0, aa1);
    ctx.stroke();
    ctx.restore();

    A.mountains(ctx, W, H, {
      y: H * 0.9,
      layers: 3,
      amp: 58,
      alpha: 0.16,
      seed: 88,
      mist: false,
      colors: ['#F2604E', '#DE2B28', '#A60E18']
    });
    A.silkRibbon(ctx, W, H, { y: H * 0.845, amp: 62, layers: 7, layerGap: 10, seed: 21 });
    A.vignette(ctx, W, H, 0.26, '#4A0006');
    A.paperNoise(ctx, W, H, 3, 0.1);

    const emX = W * 0.625;
    const emY = H * 0.185;
    const emSize = fs(S, 92);
    if (S.showEmblem !== false) {
      A.emblem(ctx, emX, emY, emSize, {
        variant: emblemKind(S, classic),
        shadow: 'rgba(80,0,0,0.45)',
        blur: 14
      });
    }
    const tSize = fs(S, 76);
    const tGap = fs(S, 17);
    const titleY = Math.max(H * 0.285, emY + emSize / 2 + tSize * 1.1);
    const g = gold(ctx, S, W * 0.58, H * 0.25, W * 0.66, H * 0.8);
    A.vTextFit(ctx, S.coverTitle || '政治生日卡', emX, titleY, {
      size: tSize,
      gap: tGap,
      font: family(S),
      weight: 'bold',
      fill: g,
      maxBottom: H * 0.865
    });
    A.vTextFit(ctx, S.coverSlogan || '不忘初心 牢记使命', W * 0.692, titleY + fs(S, 7), {
      size: fs(S, 23),
      gap: fs(S, 13),
      font: family(S),
      fill: 'rgba(255,232,184,0.92)',
      maxBottom: H * 0.865
    });
    coverFlag(ctx, S);
    A.rule(ctx, W * 0.055, H * 0.915, W * 0.3, H * 0.915, { color: '#F0C66A', alpha: 0.55 });
    coverBranch(ctx, S, W * 0.055, H * 0.95, { color: 'rgba(255,230,175,0.88)' });
  },
  inner(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FDFAF2'],
      [0.48, '#F9F2E3'],
      [1, '#F0E3CB']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 11, 0.34);
    A.lineFan(ctx, { cx: W * 1.06, cy: -H * 0.12, r: W * 0.98, a0: 1.95, a1: 2.92, count: 105, color: '#C7A263', alpha: 0.15, bend: 0.08 });
    A.lineFan(ctx, { cx: -W * 0.06, cy: H * 1.1, r: W * 0.98, a0: -1.48, a1: -0.52, count: 115, color: '#C7A263', alpha: 0.19, bend: 0.08 });
    A.mountains(ctx, W, H, { y: H * 0.8, warm: true, layers: 5, amp: 106, alpha: 0.3, seed: 12, mist: true, mistH: 150 });
    A.greatWall(ctx, W, H, { y: H * 0.785, alpha: 0.26, color: '#B17B48' });

    A.frame(ctx, W, H, { margin: 46, style: 'top', color: '#C4161C', width: 2.1, cornerSize: 48, cornerColor: '#C4161C' });
    topTag(ctx, S, { x: W * 0.118, y: H * 0.081, size: 27, spacing: 9, ruleY: H * 0.061, ruleEnd: W * 0.755, ruleWidth: 2 });

    oath(ctx, S, { x: W * 0.125, y: H * 0.175, w: W * 0.345, size: 22, color: '#2B2722', titleColor: '#2B2722', lineHeight: 43 });
    letter(ctx, S, {
      x: W * 0.545,
      y: H * 0.185,
      w: W * 0.365,
      size: 22,
      color: '#2B2722',
      showLines: true,
      lineHeight: 44,
      wishLineHeight: 43
    });
    sloganBar(ctx, S, W * 0.665, H * 0.768, W * 0.245, 34, { size: 19 });
    A.rule(ctx, W * 0.32, H * 0.783, W * 0.665, H * 0.783, { color: '#C4161C', alpha: 0.9, width: 2 });
  }
};

/* ---------------- 模板 2：金线长城 ---------------- */
const goldwall: PbcTemplate = {
  id: 'goldwall',
  name: '金线长城',
  tag: '庄重华美',
  emblem: 'red',
  desc: '米金宣纸 + 暖金长城剪影 + 回纹金框，党徽居中，横排烫金标题',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FBF3DF'],
      [0.5, '#F6E7C6'],
      [1, '#EBD4A8']
    ]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = A.radial(ctx, W * 0.5, H * 0.3, 20, W * 0.72, [
      [0, 'rgba(255,250,225,0.95)'],
      [1, 'rgba(214,174,104,0.10)']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 5, 0.4);
    A.lineFan(ctx, { cx: W * 1.06, cy: -H * 0.1, r: W * 0.95, a0: 1.95, a1: 2.9, count: 110, color: '#B8913F', alpha: 0.2 });
    A.lineFan(ctx, { cx: -W * 0.05, cy: H * 1.1, r: W * 0.95, a0: -1.45, a1: -0.5, count: 110, color: '#B8913F', alpha: 0.2 });
    A.mountains(ctx, W, H, { y: H * 0.84, warm: true, layers: 6, amp: 132, alpha: 0.34, seed: 27, mist: true, mistH: 170 });
    A.greatWall(ctx, W, H, { y: H * 0.79, alpha: 0.4, color: '#A8733B' });
    A.frame(ctx, W, H, { margin: 40, style: 'double', color: '#B8913F', width: 2.2, cornerSize: 46, cornerColor: '#B8913F', allCorners: true });
    A.cloud(ctx, W * 0.2, H * 0.19, 108, '#C29B50', 0.28);
    A.cloud(ctx, W * 0.8, H * 0.19, 108, '#C29B50', 0.28);

    if (S.showEmblem !== false) {
      A.emblem(ctx, W * 0.5, H * 0.275, fs(S, 146), { variant: emblemKind(S, goldwall), shadow: 'rgba(120,60,0,0.16)', blur: 12 });
    }
    const deepGold = A.linear(ctx, W * 0.18, H * 0.44, W * 0.82, H * 0.57, [
      [0, '#8A5A16'],
      [0.24, '#C9962F'],
      [0.48, '#A06C1C'],
      [0.74, '#D3A343'],
      [1, '#855613']
    ]);
    A.text(ctx, S.coverTitle || '政治生日卡', W / 2, H * 0.515, {
      size: fs(S, 82),
      font: family(S),
      weight: 'bold',
      align: 'center',
      spacing: fs(S, 18),
      fill: deepGold,
      shadow: 'rgba(255,248,225,0.65)',
      blur: 7
    });
    A.rule(ctx, W * 0.3, H * 0.565, W * 0.7, H * 0.565, { color: '#B7221B', alpha: 0.75, width: 2 });
    A.text(ctx, S.coverSlogan || '不忘初心 牢记使命', W / 2, H * 0.625, {
      size: fs(S, 26),
      font: family(S),
      align: 'center',
      fill: '#A8281F',
      spacing: fs(S, 10)
    });
    A.seal(ctx, W * 0.865, H * 0.665, 62, '初心', { alpha: 0.82 });
    coverFlag(ctx, S, { x: W * 0.075, y: H * 0.72, w: 92 });
    coverBranch(ctx, S, W / 2, H * 0.905, { align: 'center', color: '#8A6A34', size: 20 });
  },
  inner(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FEFBF3'],
      [1, '#F6EBD5']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 8, 0.3);
    A.mountains(ctx, W, H, { y: H * 0.88, warm: true, layers: 4, amp: 74, alpha: 0.2, seed: 41, mist: true, mistH: 110 });
    A.greatWall(ctx, W, H, { y: H * 0.85, alpha: 0.22, color: '#B58A52' });
    A.frame(ctx, W, H, { margin: 44, style: 'double', color: '#B8913F', width: 1.8, cornerSize: 42, cornerColor: '#B8913F', allCorners: true });
    A.ribbonBar(ctx, W * 0.08, H * 0.088, W * 0.32, 38, '政治生日卡', { size: fs(S, 23), spacing: 8 });
    A.rule(ctx, W * 0.42, H * 0.107, W * 0.92, H * 0.107, { color: '#B7221B', alpha: 0.7, width: 1.8 });
    A.foldLine(ctx, W, H, W / 2);
    oath(ctx, S, { x: W * 0.095, y: H * 0.225, w: W * 0.355, size: 21, color: '#40382E', lineHeight: 42, ruleColor: '#B8913F' });
    letter(ctx, S, {
      x: W * 0.535,
      y: H * 0.205,
      w: W * 0.375,
      size: 21,
      color: '#40382E',
      showLines: true,
      lineHeight: 42,
      wishLineHeight: 41,
      ruleColor: '#C0A879'
    });
    sloganBar(ctx, S, W * 0.6, H * 0.855, W * 0.32, 36, { size: 19 });
    A.star(ctx, W * 0.085, H * 0.107, 12, { fill: '#F6DFA0' });
  }
};

/* ---------------- 模板 3：党旗红 ---------------- */
const flagred: PbcTemplate = {
  id: 'flagred',
  name: '党旗红',
  tag: '鲜明大气',
  emblem: 'gold',
  desc: '正红放射光芒 + 飘扬旗面，金色党徽与横排大字；内页左红右米双色分栏',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#C7121B'],
      [0.5, '#E02624'],
      [1, '#A50B14']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.rays(ctx, W * 0.5, H * 0.36, W * 0.95, { count: 84, color: '#FFD97A', alpha: 0.16 });
    ctx.fillStyle = A.radial(ctx, W * 0.5, H * 0.34, 20, W * 0.55, [
      [0, 'rgba(255,196,90,0.28)'],
      [1, 'rgba(255,196,90,0)']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.guilloche(ctx, W, H, { cx: W * 0.5, cy: H * 0.42, r: W * 0.56, count: 30, color: '#FFD77C', alpha: 0.09, squash: 0.55 });
    A.flagWave(ctx, W, H, { layers: 5 });
    A.paperNoise(ctx, W, H, 17, 0.09);
    A.vignette(ctx, W, H, 0.34, '#5A0008');

    if (S.showEmblem !== false) {
      A.emblem(ctx, W * 0.5, H * 0.295, fs(S, 172), {
        variant: emblemKind(S, flagred),
        shadow: 'rgba(90,0,0,0.5)',
        blur: 22
      });
    }
    A.text(ctx, S.coverTitle || '政治生日卡', W / 2, H * 0.585, {
      size: fs(S, 88),
      font: family(S),
      weight: 'bold',
      align: 'center',
      spacing: fs(S, 16),
      fill: gold(ctx, S, 0, H * 0.51, W, H * 0.63),
      shadow: 'rgba(90,0,0,0.45)',
      blur: 12
    });
    A.rule(ctx, W * 0.24, H * 0.635, W * 0.76, H * 0.635, { color: '#FFE5A0', alpha: 0.85, width: 2 });
    A.text(ctx, S.coverSlogan || '不忘初心 牢记使命', W / 2, H * 0.695, {
      size: fs(S, 27),
      font: family(S),
      align: 'center',
      fill: '#FFEFC4',
      spacing: fs(S, 11)
    });
    for (let i = 0; i < 5; i += 1) {
      A.star(ctx, W * (0.4 + i * 0.05), H * 0.785, 7 + (i === 0 ? 4 : 0), { fill: '#FFDA79', alpha: 0.85 });
    }
    coverFlag(ctx, S, { x: W * 0.06, y: H * 0.7, w: 92 });
    coverBranch(ctx, S, W / 2, H * 0.925, { align: 'center', color: '#FFE6B0', size: 19 });
  },
  inner(ctx, S) {
    ctx.fillStyle = '#FBEFD9';
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 23, 0.26);
    ctx.fillStyle = A.linear(ctx, 0, 0, W * 0.5, H, [
      [0, '#B11219'],
      [1, '#8B0A12']
    ]);
    ctx.fillRect(0, 0, W * 0.5, H);
    A.rays(ctx, W * 0.25, H * 0.3, W * 0.75, { count: 60, color: '#FFD07A', alpha: 0.1 });
    A.frame(ctx, W * 0.5, H, { margin: 34, color: 'rgba(255,220,150,0.55)', width: 1.4, corners: false });
    A.frame(ctx, W, H, { margin: 34, color: '#C9A45E', width: 1.4, corners: false });
    if (S.showEmblem !== false) A.emblem(ctx, W * 0.082, H * 0.105, 38, { variant: 'gold', alpha: 0.95 });
    A.text(ctx, '入党誓词', W * 0.25, H * 0.115, {
      size: fs(S, 32),
      font: family(S),
      align: 'center',
      fill: '#FFE9B8',
      spacing: fs(S, 10)
    });
    if (S.showOath !== false) {
      A.rule(ctx, W * 0.11, H * 0.145, W * 0.39, H * 0.145, { color: '#FFE0A0', alpha: 0.6 });
      A.wrap(ctx, S.oath || '', W * 0.075, H * 0.225, {
        size: fs(S, 21),
        font: family(S),
        maxWidth: W * 0.35,
        lineHeight: fs(S, 42),
        color: '#FFF3DC',
        maxLines: 11
      });
    }
    A.text(ctx, '政治生日卡', W * 0.75, H * 0.115, {
      size: fs(S, 28),
      font: family(S),
      align: 'center',
      fill: '#B4161B',
      spacing: fs(S, 9)
    });
    A.rule(ctx, W * 0.56, H * 0.145, W * 0.94, H * 0.145, { color: '#B4161B', alpha: 0.7 });
    letter(ctx, S, {
      x: W * 0.555,
      y: H * 0.215,
      w: W * 0.375,
      size: 21,
      color: '#3A322A',
      showLines: false,
      lineHeight: 42,
      wishLineHeight: 41
    });
    sloganBar(ctx, S, W * 0.56, H * 0.875, W * 0.375, 36, { size: 19 });
    A.star(ctx, W * 0.925, H * 0.112, 10, { fill: '#C4161B', alpha: 0.8 });
  }
};

/* ---------------- 模板 4：水墨山河 ---------------- */
const inkmountain: PbcTemplate = {
  id: 'inkmountain',
  name: '水墨山河',
  tag: '清雅书卷',
  emblem: 'red',
  desc: '宣纸水墨长卷＋朱红印章，竖排题名；内页跨页山水，淡雅留白',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FCFAF3'],
      [0.6, '#F4EFE2'],
      [1, '#E9E1CE']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 31, 0.48);
    ctx.fillStyle = A.radial(ctx, W * 0.72, H * 0.28, 20, W * 0.42, [
      [0, 'rgba(120,110,96,0.10)'],
      [1, 'rgba(120,110,96,0)']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.mountains(ctx, W, H, { y: H * 0.8, layers: 6, amp: 150, alpha: 0.3, seed: 61, mist: true, mistH: 190, paper: '#FCFAF3' });
    A.mountains(ctx, W, H, { y: H * 0.9, layers: 3, amp: 74, alpha: 0.18, seed: 77, mist: false });
    A.cloud(ctx, W * 0.86, H * 0.72, 92, '#8E8578', 0.26);
    A.frame(ctx, W, H, { margin: 40, color: '#B1332A', width: 1.3, corners: true, cornerSize: 38, cornerColor: '#B1332A' });

    if (S.showEmblem !== false) {
      A.emblem(ctx, W * 0.145, H * 0.145, fs(S, 72), { variant: emblemKind(S, inkmountain), alpha: 0.92 });
    }
    A.vTextFit(ctx, S.coverTitle || '政治生日卡', W * 0.66, H * 0.24, {
      size: fs(S, 74),
      gap: fs(S, 20),
      font: family(S),
      fill: '#302B26',
      weight: 'bold',
      maxBottom: H * 0.86
    });
    A.vTextFit(ctx, S.coverSlogan || '不忘初心 牢记使命', W * 0.775, H * 0.26, {
      size: fs(S, 22),
      gap: fs(S, 12),
      font: family(S),
      fill: '#8A4036',
      maxBottom: H * 0.86
    });
    A.seal(ctx, W * 0.16, H * 0.7, 60, '初心使命', { rotate: -0.04, alpha: 0.8 });
    coverFlag(ctx, S, { y: H * 0.72 });
    A.rule(ctx, W * 0.12, H * 0.905, W * 0.88, H * 0.905, { color: '#8E8578', alpha: 0.55 });
    coverBranch(ctx, S, W * 0.12, H * 0.945, { color: '#6B6154', size: 18 });
  },
  inner(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FDFBF5'],
      [1, '#F2ECDD']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 37, 0.4);
    A.mountains(ctx, W, H, { y: H * 0.855, layers: 6, amp: 118, alpha: 0.24, seed: 65, mist: true, mistH: 160, paper: '#FDFBF5' });
    A.frame(ctx, W, H, { margin: 42, color: '#B1332A', width: 1.4, corners: true, cornerSize: 40, cornerColor: '#B1332A' });
    A.foldLine(ctx, W, H, W / 2);
    topTag(ctx, S, {
      x: W * 0.115,
      y: H * 0.095,
      size: 26,
      spacing: 8,
      color: '#A73029',
      ruleY: H * 0.078,
      ruleEnd: W * 0.93,
      ruleColor: '#B1332A'
    });
    oath(ctx, S, { x: W * 0.105, y: H * 0.205, w: W * 0.355, size: 21, color: '#39332C', lineHeight: 42, ruleColor: '#A9A091' });
    letter(ctx, S, {
      x: W * 0.545,
      y: H * 0.195,
      w: W * 0.365,
      size: 21,
      color: '#39332C',
      showLines: true,
      lineHeight: 42,
      wishLineHeight: 41,
      ruleColor: '#B7AFA0'
    });
    A.seal(ctx, W * 0.12, H * 0.755, 52, '不忘初心', { alpha: 0.72 });
    sloganBar(ctx, S, W * 0.655, H * 0.865, W * 0.255, 32, { size: 17 });
  }
};

/* ---------------- 模板 5：简约烫金 ---------------- */
const modern: PbcTemplate = {
  id: 'modern',
  name: '简约烫金',
  tag: '现代留白',
  emblem: 'gold',
  desc: '深酒红哑光 + 极细金线几何，大留白现代版式，突出姓名与党龄数字',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#6E0B12'],
      [0.55, '#8A1017'],
      [1, '#5A0810']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 43, 0.14);
    ctx.save();
    ctx.strokeStyle = 'rgba(240,200,120,0.20)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i += 1) {
      ctx.beginPath();
      ctx.arc(W * 0.86, H * 0.14, 90 + i * 62, Math.PI * 0.42, Math.PI * 1.28);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.2);
    ctx.lineTo(W * 0.08, H * 0.82);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.2);
    ctx.lineTo(W * 0.3, H * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W * 0.08, H * 0.82);
    ctx.lineTo(W * 0.3, H * 0.82);
    ctx.stroke();
    ctx.restore();
    A.rule(ctx, W * 0.08, H * 0.5, W * 0.3, H * 0.5, { color: '#E8C377', alpha: 0.5 });

    if (S.showEmblem !== false) {
      ctx.save();
      ctx.strokeStyle = 'rgba(232,195,119,0.55)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.335, fs(S, 118), 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(232,195,119,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.335, fs(S, 132), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      A.emblem(ctx, W * 0.5, H * 0.335, fs(S, 168), { variant: emblemKind(S, modern) });
    }
    A.text(ctx, S.coverTitle || '政治生日卡', W * 0.5, H * 0.625, {
      size: fs(S, 76),
      font: family(S),
      weight: 'bold',
      align: 'center',
      spacing: fs(S, 22),
      fill: gold(ctx, S, 0, H * 0.56, W, H * 0.66)
    });
    A.rule(ctx, W * 0.34, H * 0.705, W * 0.66, H * 0.705, { color: '#D8AE55', alpha: 0.65 });
    A.text(ctx, S.coverSlogan || '不忘初心 牢记使命', W * 0.5, H * 0.775, {
      size: fs(S, 23),
      font: family(S),
      align: 'center',
      fill: '#F0D8A2',
      spacing: fs(S, 10)
    });
    A.text(ctx, `党龄 ${partyAge(S)} 年`, W * 0.86, H * 0.865, {
      size: fs(S, 20),
      font: family(S),
      align: 'center',
      fill: 'rgba(240,210,150,0.72)',
      spacing: 2
    });
    coverFlag(ctx, S, { x: W * 0.075, y: H * 0.7, w: 90 });
    coverBranch(ctx, S, W * 0.08, H * 0.905, { color: 'rgba(240,210,150,0.78)', size: 18 });
  },
  inner(ctx, S) {
    ctx.fillStyle = '#FCFAF4';
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 47, 0.22);
    ctx.fillStyle = '#B4161B';
    ctx.fillRect(W * 0.085, H * 0.1, 3, H * 0.3);
    A.text(ctx, '政治生日', W * 0.11, H * 0.205, {
      size: fs(S, 44),
      font: family(S),
      fill: '#26221E',
      spacing: fs(S, 10)
    });
    A.rule(ctx, W * 0.11, H * 0.235, W * 0.42, H * 0.235, { color: '#C8B48E', alpha: 0.8 });
    A.text(ctx, `${S.name || '____'} 同志`, W * 0.11, H * 0.325, {
      size: fs(S, 46),
      font: family(S),
      fill: '#B4161B',
      spacing: fs(S, 6)
    });
    A.text(ctx, `${cnDate(S.joinDate)} 加入中国共产党 · 党龄 ${partyAge(S)} 年`, W * 0.11, H * 0.385, {
      size: fs(S, 18),
      font: family(S),
      fill: '#5C5248'
    });

    const qy = H * 0.445;
    const qh = H * 0.285;
    ctx.fillStyle = A.rgba('#B4161B', 0.045);
    ctx.fillRect(W * 0.11, qy, W * 0.37, qh);
    A.text(ctx, '“', W * 0.125, qy + H * 0.075, {
      size: fs(S, 56),
      font: 'song',
      fill: A.rgba('#B4161B', 0.26)
    });
    const wishLh = fs(S, 36);
    const wishStart = qy + H * 0.085;
    const wishLines = Math.max(1, Math.floor((qy + qh - H * 0.02 - wishStart) / wishLh));
    A.wrap(ctx, S.wishes || '', W * 0.155, wishStart, {
      size: fs(S, 19),
      font: family(S),
      maxWidth: W * 0.3,
      lineHeight: wishLh,
      color: '#3A332C',
      maxLines: Math.min(wishLines, 6)
    });

    if (S.showOath !== false) {
      const oy = H * 0.775;
      A.rule(ctx, W * 0.11, oy, W * 0.48, oy, { color: '#C8B48E', alpha: 0.7 });
      A.text(ctx, '入党誓词', W * 0.11, oy + H * 0.045, {
        size: fs(S, 16),
        font: family(S),
        fill: '#A22820',
        spacing: 4
      });
      A.wrap(ctx, S.oath || '', W * 0.11, oy + H * 0.085, {
        size: fs(S, 12),
        font: family(S),
        maxWidth: W * 0.37,
        lineHeight: fs(S, 20),
        color: '#7A6E60',
        maxLines: 3
      });
    }

    ctx.fillStyle = A.rgba('#B4161B', 0.035);
    ctx.fillRect(W * 0.56, H * 0.1, W * 0.36, H * 0.8);
    A.rule(ctx, W * 0.56, H * 0.1, W * 0.92, H * 0.1, { color: '#B4161B', alpha: 0.8, width: 2 });
    A.text(ctx, `入党 ${partyAge(S)} 周年`, W * 0.74, H * 0.4, {
      size: fs(S, 52),
      font: family(S),
      align: 'center',
      fill: A.rgba('#B4161B', 0.72),
      spacing: fs(S, 6)
    });
    A.rule(ctx, W * 0.63, H * 0.445, W * 0.85, H * 0.445, { color: '#C8B48E', alpha: 0.8 });
    A.text(ctx, S.coverSlogan || '不忘初心 牢记使命', W * 0.74, H * 0.525, {
      size: fs(S, 24),
      font: family(S),
      align: 'center',
      fill: '#3A332C',
      spacing: fs(S, 8)
    });
    A.fitText(ctx, S.branch || '', W * 0.74, H * 0.765, W * 0.33, {
      size: fs(S, 18),
      minSize: fs(S, 12),
      font: family(S),
      align: 'center',
      fill: '#5C5248'
    });
    A.text(ctx, cnDate(S.signDate), W * 0.74, H * 0.805, {
      size: fs(S, 17),
      font: family(S),
      align: 'center',
      fill: '#5C5248'
    });
  }
};

/* ---------------- 模板 6：华章锦绣 ---------------- */
const festive: PbcTemplate = {
  id: 'festive',
  name: '华章锦绣',
  tag: '喜庆对称',
  emblem: 'red',
  desc: '红金回纹满底 + 对称锦纹 + 圆形徽章，匾额式竖排标题与四角角花',
  cover(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#AE1018'],
      [0.5, '#CE1D22'],
      [1, '#940A12']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.guilloche(ctx, W, H, { cx: W * 0.5, cy: H * 0.5, r: W * 0.62, count: 54, color: '#FFD97C', alpha: 0.11, squash: 0.78 });
    A.rays(ctx, W * 0.5, H * 0.5, W * 0.72, { count: 48, color: '#FFD97C', alpha: 0.09 });
    A.paperNoise(ctx, W, H, 53, 0.1);
    A.frame(ctx, W, H, { margin: 34, style: 'double', color: '#E3BC62', width: 2, cornerSize: 54, cornerColor: '#E3BC62', allCorners: true });
    A.frame(ctx, W, H, { margin: 62, color: 'rgba(240,205,130,0.35)', width: 1, corners: false });
    A.cloud(ctx, W * 0.2, H * 0.22, 128, '#E8C474', 0.28);
    A.cloud(ctx, W * 0.8, H * 0.22, 128, '#E8C474', 0.28);

    if (S.showEmblem !== false) {
      A.emblemBadge(ctx, W * 0.5, H * 0.255, fs(S, 82), { variant: emblemKind(S, festive), color: '#F0CE7C' });
    }
    const bx = W * 0.365;
    const by = H * 0.4;
    const bw = W * 0.27;
    const bh = H * 0.4;
    ctx.fillStyle = A.linear(ctx, bx, by, bx + bw, by + bh, [
      [0, '#8E0A11'],
      [1, '#B4141B']
    ]);
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = gold(ctx, S, bx, by, bx + bw, by + bh);
    ctx.lineWidth = 3;
    ctx.strokeRect(bx + 6, by + 6, bw - 12, bh - 12);
    A.vTextFit(ctx, S.coverTitle || '政治生日卡', W * 0.5, by + bh * 0.11, {
      size: fs(S, 50),
      gap: fs(S, 12),
      font: family(S),
      weight: 'bold',
      fill: gold(ctx, S, bx, by, bx + bw, by + bh),
      maxBottom: by + bh - 22
    });
    A.text(ctx, S.coverSlogan || '不忘初心 牢记使命', W * 0.5, H * 0.875, {
      size: fs(S, 24),
      font: family(S),
      align: 'center',
      fill: '#F6DBA0',
      spacing: fs(S, 9)
    });
    coverFlag(ctx, S, { x: W * 0.075, y: H * 0.7, w: 90 });
    coverBranch(ctx, S, W / 2, H * 0.925, { align: 'center', color: 'rgba(246,219,160,0.82)', size: 18 });
  },
  inner(ctx, S) {
    ctx.fillStyle = A.linear(ctx, 0, 0, W, H, [
      [0, '#FEF9EC'],
      [0.5, '#F9EFD9'],
      [1, '#F1E1BE']
    ]);
    ctx.fillRect(0, 0, W, H);
    A.paperNoise(ctx, W, H, 59, 0.34);
    A.guilloche(ctx, W, H, { cx: W * 0.5, cy: H * 0.52, r: W * 0.55, count: 26, color: '#C6A259', alpha: 0.07, squash: 0.62 });
    A.frame(ctx, W, H, { margin: 38, style: 'double', color: '#C6A259', width: 1.8, cornerSize: 46, cornerColor: '#C6A259', allCorners: true });
    A.frame(ctx, W, H, { margin: 54, color: 'rgba(198,162,89,0.45)', width: 1, corners: false });
    A.foldLine(ctx, W, H, W / 2);
    const bx = W * 0.395;
    const by = H * 0.055;
    const bw = W * 0.21;
    const bh = 52;
    A.ribbonBar(ctx, bx, by, bw, bh, '政治生日卡', { size: fs(S, 25), spacing: 8, fill: '#B4161B' });
    A.rule(ctx, W * 0.1, by + bh / 2, bx - 14, by + bh / 2, { color: '#C6A259', alpha: 0.8, width: 2 });
    A.rule(ctx, bx + bw + 14, by + bh / 2, W * 0.9, by + bh / 2, { color: '#C6A259', alpha: 0.8, width: 2 });
    A.cloud(ctx, W * 0.13, H * 0.15, 88, '#C6A259', 0.22);

    oath(ctx, S, { x: W * 0.105, y: H * 0.215, w: W * 0.355, size: 21, color: '#3B3227', lineHeight: 41, ruleColor: '#C6A259' });
    letter(ctx, S, {
      x: W * 0.545,
      y: H * 0.205,
      w: W * 0.365,
      size: 21,
      color: '#3B3227',
      showLines: true,
      lineHeight: 41,
      wishLineHeight: 40,
      ruleColor: '#C6AE80'
    });
    A.seal(ctx, W * 0.115, H * 0.755, 48, '初心', { alpha: 0.7 });
    sloganBar(ctx, S, W * 0.375, H * 0.865, W * 0.25, 34, { size: 18 });
    A.star(ctx, W * 0.325, H * 0.882, 9, { fill: '#C6A259', alpha: 0.8 });
    A.star(ctx, W * 0.675, H * 0.882, 9, { fill: '#C6A259', alpha: 0.8 });
  }
};

export const TEMPLATE_LIST: PbcTemplate[] = [classic, goldwall, flagred, inkmountain, modern, festive];
export const TEMPLATE_MAP: Record<string, PbcTemplate> = Object.fromEntries(
  TEMPLATE_LIST.map(t => [t.id, t])
);
