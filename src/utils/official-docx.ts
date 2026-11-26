/**
 * 标准党支部公文 Word (.docx) 导出引擎
 *
 * 严格遵循《党政机关公文格式》GB/T 9704-2012（参考 Ann-L1/official-document-template）：
 * - A4 纸张（210mm × 297mm），页边距：上 37mm / 下 35mm / 左 28mm / 右 26mm，页脚距底边 28mm
 * - 固定行距 28 磅（560 twips），正文首行缩进 2 字符（640 twips）
 * - 字体字号分级：
 *   · 公文标题：方正小标宋简体 二号（22pt），居中
 *   · 主送机关：仿宋_GB2312 三号（16pt），顶格无缩进
 *   · 一级标题（一、）：黑体 三号（16pt），首行缩进 2 字符
 *   · 二级标题（（一））：楷体_GB2312 三号（16pt），首行缩进 2 字符
 *   · 三级标题（1.）：仿宋_GB2312 三号（16pt）加粗，首行缩进 2 字符
 *   · 四级标题（（1））与正文：仿宋_GB2312 三号（16pt），首行缩进 2 字符
 *   · 附件说明：正文后空一行，仿宋_GB2312 三号，左空 2 字符
 *   · 落款与成文日期：正文后空两行，仿宋_GB2312 三号，右对齐空 2 字符
 *   · 公文页码：四号宋体（14pt），奇偶页不同，奇数页居右空一字、偶数页居左空一字，左右一字线
 */
import { saveFileWithPicker } from '@/utils/save-file';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// GB/T 9704-2012 度量常量（1 mm ≈ 56.6929 twips，1 pt = 20 twips，font size 单位为 half-point）
const MM = 56.692913;
const PAGE_A4_W = Math.round(210 * MM); // 11906
const PAGE_A4_H = Math.round(297 * MM); // 16838
const MARGIN_TOP = Math.round(37 * MM); // 2098
const MARGIN_BOTTOM = Math.round(35 * MM); // 1984
const MARGIN_LEFT = Math.round(28 * MM); // 1587
const MARGIN_RIGHT = Math.round(26 * MM); // 1474
const MARGIN_FOOTER = Math.round(28 * MM); // 1587（距版心下边缘 7mm）

const LINE_28PT = 560; // 28pt × 20 twips
const INDENT_2CHARS = 640; // 三号字 16pt × 2字 × 20 twips
const INDENT_1CHAR = 320;

const SIZE_2HAO = 44; // 二号 22pt
const SIZE_3HAO = 32; // 三号 16pt
const SIZE_4HAO = 28; // 四号 14pt

const FONT_TITLE = '方正小标宋简体';
const FONT_H1 = '黑体';
const FONT_H2 = '楷体_GB2312';
const FONT_BODY = '仿宋_GB2312';
const FONT_PAGE_NUM = '宋体';

type BlockKind =
  | 'title'
  | 'salutation'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'meta'
  | 'attachment'
  | 'sign'
  | 'date'
  | 'hr'
  | 'quote'
  | 'body';

interface ParsedDocBlock {
  kind: BlockKind;
  text: string;
  label?: string;
}

const DATE_LINE_RE = /^(?:[0-9×xX]{4}年\s*[0-9×xX]{1,2}月\s*[0-9×xX]{1,2}日|日期[:：].*)$/;
const H1_CN_RE = /^[一二三四五六七八九十百]+[、.．]\s*.+/;
const H2_CN_RE = /^[（(][一二三四五六七八九十百]+[）)]\s*.+/;
const H3_NUM_RE = /^\d+[.．、]\s*.+/;
const H4_NUM_RE = /^[（(]\d+[）)]\s*.+/;
const META_KV_RE = /^(?:[-*•]\s*)?(?:\*\*)?([^：:\n]{2,12})(?:\*\*)?[：:]\s*(.+)$/;
const META_KEYS = new Set([
  '会议时间',
  '会议地点',
  '主持人',
  '记录人',
  '参会人员',
  '应到人数',
  '实到人数',
  '时间',
  '地点',
  '活动时间',
  '活动地点',
  '参加对象',
  '活动形式',
  '谈话时间',
  '谈话地点',
  '谈话人',
  '谈话对象',
  '谈话类型',
  '公示时间',
  '联系电话',
  '举报电话',
  '反映电话',
  '联系人',
  '上级党组织电话',
  '受理部门',
  '谈话人签字',
  '书记签章',
  '书    记',
  '书记',
  '副书记',
  '委员',
  '委员分工',
  '日期'
]);

function stripInlineMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

function isSignatureLine(line: string): boolean {
  if (!line || line.length > 36) return false;
  if (/[。！？；]$/.test(line)) return false;
  return /(?:党支部|支部委员会|党总支|委员会|签字|签章|落款)/.test(line) || line.length <= 20;
}

/** 将纯文本 / Markdown 模板解析为符合 GB/T 9704-2012 的语义段落序列 */
function parseToOfficialBlocks(fallbackTitle: string, rawBody: string): ParsedDocBlock[] {
  const rawLines = (rawBody || '').replace(/\r\n/g, '\n').split('\n');
  const trimmedLines = rawLines.map(l => l.trim());

  // 查找末尾 `---` 分隔线（Markdown 落款分隔）
  let hrSignIdx = -1;
  for (let i = trimmedLines.length - 1; i >= 0; i -= 1) {
    if (/^(-{3,}|\*{3,})$/.test(trimmedLines[i])) {
      hrSignIdx = i;
      break;
    }
  }

  // 查找末尾日期与落款索引
  let lastNonEmpty = trimmedLines.length - 1;
  while (lastNonEmpty >= 0 && !trimmedLines[lastNonEmpty]) lastNonEmpty -= 1;

  const signLineIndexes = new Set<number>();
  const dateLineIndexes = new Set<number>();

  let hrUsedForSign = false;
  if (lastNonEmpty >= 0 && DATE_LINE_RE.test(trimmedLines[lastNonEmpty])) {
    dateLineIndexes.add(lastNonEmpty);
    let prev = lastNonEmpty - 1;
    while (prev >= 0 && !trimmedLines[prev]) prev -= 1;
    if (prev >= 0 && isSignatureLine(trimmedLines[prev])) {
      signLineIndexes.add(prev);
    }
  } else if (hrSignIdx >= 0 && hrSignIdx < trimmedLines.length - 1) {
    const tailIdxs: number[] = [];
    for (let i = hrSignIdx + 1; i < trimmedLines.length; i += 1) {
      if (trimmedLines[i]) tailIdxs.push(i);
    }
    const allSignOrDate =
      tailIdxs.length > 0 &&
      tailIdxs.length <= 3 &&
      tailIdxs.every(i => DATE_LINE_RE.test(trimmedLines[i]) || isSignatureLine(trimmedLines[i]));
    if (allSignOrDate) {
      hrUsedForSign = true;
      for (const i of tailIdxs) {
        if (DATE_LINE_RE.test(trimmedLines[i])) dateLineIndexes.add(i);
        else signLineIndexes.add(i);
      }
    }
  }

  const blocks: ParsedDocBlock[] = [];
  let hasTitle = false;
  let seenBodyOrHeading = false;

  for (let i = 0; i < trimmedLines.length; i += 1) {
    const rawLine = rawLines[i] ?? '';
    const line = trimmedLines[i];
    if (!line) continue;
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      if (!hrUsedForSign || i !== hrSignIdx) {
        blocks.push({ kind: 'hr', text: '' });
      }
      continue;
    }

    if (dateLineIndexes.has(i)) {
      blocks.push({ kind: 'date', text: stripInlineMarkdown(line) });
      continue;
    }
    if (signLineIndexes.has(i)) {
      blocks.push({ kind: 'sign', text: stripInlineMarkdown(line) });
      continue;
    }
    // 兼容右缩进签字/申请日期行（如《党员档案自提申请书》中部落款）
    if (/^\s{8,}/.test(rawLine) && line.length <= 36 && /(?:签字|日期|落款|党支部|委员会)/.test(line)) {
      blocks.push({ kind: 'sign', text: stripInlineMarkdown(line) });
      continue;
    }

    // 1. 标题：Markdown `# ` 或首行非列表短标题
    if (line.startsWith('# ')) {
      blocks.push({ kind: 'title', text: stripInlineMarkdown(line.slice(2).trim()) });
      hasTitle = true;
      continue;
    }
    if (!hasTitle && blocks.length === 0 && line.length <= 60 && !/[。；]$/.test(line) && !/[：:]$/.test(line)) {
      blocks.push({ kind: 'title', text: stripInlineMarkdown(line) });
      hasTitle = true;
      continue;
    }

    // 2. 主送机关 / 抬头（紧接标题之后、以冒号结尾的短行）
    if (hasTitle && !seenBodyOrHeading && /[：:]$/.test(line) && line.length <= 36 && !line.startsWith('#')) {
      blocks.push({ kind: 'salutation', text: stripInlineMarkdown(line).replace(/:$/, '：') });
      seenBodyOrHeading = true;
      continue;
    }

    // 3. 附件说明
    if (/^附件[：:]/.test(line)) {
      blocks.push({ kind: 'attachment', text: stripInlineMarkdown(line).replace(/^附件:/, '附件：') });
      seenBodyOrHeading = true;
      continue;
    }

    // 4. 一级标题（Markdown `## ` 或 `一、`）
    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h1', text: stripInlineMarkdown(line.slice(3).trim()) });
      seenBodyOrHeading = true;
      continue;
    }
    if (H1_CN_RE.test(line)) {
      blocks.push({ kind: 'h1', text: stripInlineMarkdown(line) });
      seenBodyOrHeading = true;
      continue;
    }

    // 5. 二级标题（Markdown `### ` 或 `（一）`）
    if (line.startsWith('### ')) {
      blocks.push({ kind: 'h2', text: stripInlineMarkdown(line.slice(4).trim()) });
      seenBodyOrHeading = true;
      continue;
    }
    if (H2_CN_RE.test(line)) {
      blocks.push({ kind: 'h2', text: stripInlineMarkdown(line) });
      seenBodyOrHeading = true;
      continue;
    }

    // 6. 元数据键值行（如 会议时间：xxx / 公示时间：xxx / - **时间**：xxx）
    const metaMatch = line.match(META_KV_RE);
    if (metaMatch && META_KEYS.has(metaMatch[1].trim())) {
      blocks.push({
        kind: 'meta',
        label: `${metaMatch[1].trim()}：`,
        text: metaMatch[2].trim()
      });
      seenBodyOrHeading = true;
      continue;
    }

    // 7. 三级标题（1. / 1、）与四级标题（（1））
    if (H3_NUM_RE.test(line)) {
      blocks.push({ kind: 'h3', text: stripInlineMarkdown(line) });
      seenBodyOrHeading = true;
      continue;
    }
    if (H4_NUM_RE.test(line)) {
      blocks.push({ kind: 'h4', text: stripInlineMarkdown(line) });
      seenBodyOrHeading = true;
      continue;
    }

    // 8. 引用行
    if (line.startsWith('>')) {
      blocks.push({ kind: 'quote', text: stripInlineMarkdown(line.replace(/^>\s?/, '')) });
      seenBodyOrHeading = true;
      continue;
    }

    // 9. 普通正文（兼容 Markdown 列表项 `- `）
    const cleaned = line.replace(/^[-*•]\s+/, '');
    blocks.push({ kind: 'body', text: cleaned });
    seenBodyOrHeading = true;
  }

  if (!hasTitle && fallbackTitle.trim()) {
    blocks.unshift({ kind: 'title', text: fallbackTitle.trim() });
  }

  return blocks;
}

/** 生成符合 GB/T 9704-2012 党政机关公文标准的 Word (.docx) Blob */
export async function buildOfficialDocxBlob(title: string, body: string): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, Footer, LineRuleType, Packer, PageNumber, Paragraph, TextRun } =
    await import('docx');

  function makeFont(fontName: string) {
    return {
      ascii: fontName,
      eastAsia: fontName,
      hAnsi: fontName,
      cs: fontName
    };
  }

  function makeRun(text: string, fontName: string, size: number, bold = false) {
    return new TextRun({
      text,
      font: makeFont(fontName),
      size,
      bold,
      color: '000000'
    });
  }

  /** 支持正文中 `**加粗**` 转成原生 Word 加粗，并剥离行内反引号 */
  function makeInlineRuns(text: string, fontName: string, size: number) {
    const cleaned = text.replace(/`([^`]+)`/g, '$1');
    const parts = cleaned.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map(part => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return makeRun(part.slice(2, -2), fontName, size, true);
      }
      return makeRun(part, fontName, size, false);
    });
  }

  const blocks = parseToOfficialBlocks(title, body);
  const children: InstanceType<typeof Paragraph>[] = [];
  let addedSignBlank = false;

  for (const blk of blocks) {
    if (blk.kind === 'title') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: LINE_28PT, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_TITLE, SIZE_2HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'salutation') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_BODY, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'h1') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_H1, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'h2') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_H2, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'h3') {
      // GB/T 9704：若三级标题后紧跟正文（如「1. 标题。正文内容…」），仅加粗标题段，正文保持常规仿宋
      const splitMatch = blk.text.match(/^(\d+[.．、]\s*[^。：:]+[。：:])(.*)$/);
      const runs =
        splitMatch && splitMatch[2].trim()
          ? [makeRun(splitMatch[1], FONT_BODY, SIZE_3HAO, true), makeRun(splitMatch[2], FONT_BODY, SIZE_3HAO, false)]
          : [makeRun(blk.text, FONT_BODY, SIZE_3HAO, blk.text.length <= 28)];
      children.push(
        new Paragraph({
          alignment: AlignmentType.BOTH,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: runs
        })
      );
      continue;
    }

    if (blk.kind === 'h4') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.BOTH,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_BODY, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'meta') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [
            makeRun(blk.label ?? '', FONT_BODY, SIZE_3HAO, true),
            ...makeInlineRuns(blk.text, FONT_BODY, SIZE_3HAO)
          ]
        })
      );
      continue;
    }

    if (blk.kind === 'attachment') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: LINE_28PT, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_BODY, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'sign' || blk.kind === 'date') {
      const beforeSpacing = !addedSignBlank ? LINE_28PT * 2 : 0;
      addedSignBlank = true;
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          indent: { right: INDENT_2CHARS },
          spacing: { before: beforeSpacing, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_BODY, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    if (blk.kind === 'hr') {
      addedSignBlank = false;
      children.push(
        new Paragraph({
          spacing: { before: 160, after: 160, line: 240, lineRule: LineRuleType.AUTO },
          border: {
            bottom: {
              style: BorderStyle.DASHED,
              size: 6,
              color: '666666'
            }
          },
          children: []
        })
      );
      continue;
    }

    if (blk.kind === 'quote') {
      children.push(
        new Paragraph({
          alignment: AlignmentType.BOTH,
          indent: { firstLine: INDENT_2CHARS },
          spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
          children: [makeRun(blk.text, FONT_H2, SIZE_3HAO, false)]
        })
      );
      continue;
    }

    children.push(
      new Paragraph({
        alignment: AlignmentType.BOTH,
        indent: { firstLine: INDENT_2CHARS },
        spacing: { before: 0, after: 0, line: LINE_28PT, lineRule: LineRuleType.EXACT },
        children: makeInlineRuns(blk.text, FONT_BODY, SIZE_3HAO)
      })
    );
  }

  // GB/T 9704-2012 公文页码：四号宋体，左右各一条一字线，单页居右空一字、双页居左空一字
  const makePageNumParagraph = (isOdd: boolean) =>
    new Paragraph({
      alignment: isOdd ? AlignmentType.RIGHT : AlignmentType.LEFT,
      indent: isOdd ? { right: INDENT_1CHAR } : { left: INDENT_1CHAR },
      spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
      children: [
        makeRun('— ', FONT_PAGE_NUM, SIZE_4HAO),
        new TextRun({
          children: [PageNumber.CURRENT],
          font: makeFont(FONT_PAGE_NUM),
          size: SIZE_4HAO,
          color: '000000'
        }),
        makeRun(' —', FONT_PAGE_NUM, SIZE_4HAO)
      ]
    });

  const doc = new Document({
    title: title.trim() || '党支部工作材料',
    creator: '三尺台 · 高校党支部工作台',
    evenAndOddHeaderAndFooters: true,
    styles: {
      default: {
        document: {
          run: {
            font: makeFont(FONT_BODY),
            size: SIZE_3HAO,
            color: '000000'
          },
          paragraph: {
            spacing: { line: LINE_28PT, lineRule: LineRuleType.EXACT }
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_A4_W, height: PAGE_A4_H },
            margin: {
              top: MARGIN_TOP,
              bottom: MARGIN_BOTTOM,
              left: MARGIN_LEFT,
              right: MARGIN_RIGHT,
              footer: MARGIN_FOOTER
            }
          }
        },
        footers: {
          default: new Footer({ children: [makePageNumParagraph(true)] }),
          even: new Footer({ children: [makePageNumParagraph(false)] })
        },
        children
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  return new Blob([blob], { type: DOCX_MIME });
}

/** 导出符合 GB/T 9704-2012 标准的 Word (.docx) 文件 */
export async function exportOfficialDocx(
  filename: string,
  title: string,
  body: string
): Promise<'saved' | 'cancelled'> {
  const cleanName = (filename || title || '党支部公文')
    .trim()
    .replace(/\.docx?$/i, '')
    .replace(/[/\\:*?"<>|]/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
  const res = await saveFileWithPicker(() => buildOfficialDocxBlob(title, body), {
    suggestedName: `${cleanName}.docx`,
    types: [{ description: 'Word 公文文档 (.docx)', mime: DOCX_MIME, extensions: ['.docx'] }]
  });
  return res.status === 'saved' ? 'saved' : 'cancelled';
}
