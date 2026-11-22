/**
 * 成员编号生成（支部缩写 + 3 位数字）与敏感字段脱敏工具（纯函数）
 */

const COMMON_CHAR_INITIALS: Record<string, string> = {
  智: 'Z',
  感: 'G',
  知: 'Z',
  视: 'S',
  觉: 'J',
  计: 'J',
  算: 'S',
  机: 'J',
  硕: 'S',
  博: 'B',
  研: 'Y',
  究: 'J',
  生: 'S',
  本: 'B',
  科: 'K',
  学: 'X',
  院: 'Y',
  软: 'R',
  件: 'J',
  信: 'X',
  息: 'X',
  工: 'G',
  程: 'C',
  数: 'S',
  据: 'J',
  网: 'W',
  络: 'L',
  安: 'A',
  全: 'Q',
  人: 'R',
  能: 'N',
  自: 'Z',
  动: 'D',
  化: 'H',
  电: 'D',
  子: 'Z',
  通: 'T',
  物: 'W',
  联: 'L',
  医: 'Y',
  经: 'J',
  管: 'G',
  法: 'F',
  文: 'W',
  理: 'L',
  材: 'C',
  料: 'L',
  械: 'X',
  土: 'T',
  木: 'M',
  建: 'J',
  筑: 'Z',
  环: 'H',
  境: 'J',
  源: 'Y',
  第: 'D',
  一: 'Y',
  二: 'E',
  三: 'S',
  四: 'S',
  五: 'W',
  六: 'L',
  七: 'Q',
  八: 'B',
  九: 'J',
  十: 'S',
  中: 'Z',
  党: 'D',
  支: 'Z',
  部: 'B',
  总: 'Z',
  教: 'J',
  师: 'S',
  实: 'S',
  验: 'Y',
  室: 'S',
  可: 'K',
  是: 'S'
};

/** 经典 GB2312 拼音首字母分界字表（按 zh-CN 拼音序，A-Z 不含 I/U/V） */
const PINYIN_BOUNDARIES: Array<[string, string]> = [
  ['A', '阿'],
  ['B', '芭'],
  ['C', '擦'],
  ['D', '搭'],
  ['E', '蛾'],
  ['F', '发'],
  ['G', '噶'],
  ['H', '哈'],
  ['J', '击'],
  ['K', '喀'],
  ['L', '垃'],
  ['M', '妈'],
  ['N', '拿'],
  ['O', '哦'],
  ['P', '啪'],
  ['Q', '期'],
  ['R', '然'],
  ['S', '撒'],
  ['T', '塌'],
  ['W', '挖'],
  ['X', '昔'],
  ['Y', '压'],
  ['Z', '匝']
];

const ZH_COLLATOR = new Intl.Collator('zh-CN');

function chineseCharInitial(ch: string): string {
  if (COMMON_CHAR_INITIALS[ch]) return COMMON_CHAR_INITIALS[ch];
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
  if (!/[\u4e00-\u9fa5]/.test(ch)) return '';

  let letter = '';
  for (const [key, boundary] of PINYIN_BOUNDARIES) {
    if (ZH_COLLATOR.compare(ch, boundary) >= 0) {
      letter = key;
    } else {
      break;
    }
  }
  return letter || 'Z';
}

/** 根据党支部名称生成 2~6 位大写英文缩写（如「智感硕博党支部」→「ZGSB」） */
export function getBranchAbbreviation(branchName?: string): string {
  const raw = (branchName ?? '').trim();
  if (!raw) return 'DZB';

  const stripped = raw
    .replace(/(中共|中国共产党)/g, '')
    .replace(/(研究生|本科生|学生)?(临时)?(党支部|党总支|支部委员会|支部|党委)$/g, '')
    .replace(/[与和及的之·\-_\s()（）【】[\]]+/g, '');

  const source = stripped || raw.replace(/[·\-_\s()（）【】[\]]+/g, '');
  const letters: string[] = [];

  for (const ch of source) {
    if (/[A-Za-z0-9]/.test(ch)) {
      letters.push(ch.toUpperCase());
    } else {
      const init = chineseCharInitial(ch);
      if (init) letters.push(init);
    }
    if (letters.length >= 6) break;
  }

  const abbr = letters.join('').replace(/[^A-Z0-9]/g, '');
  if (abbr.length >= 2) return abbr.slice(0, 6);
  return 'DZB';
}

/** 格式化为「支部缩写 + 三位数字」（超过 999 自动顺延四位） */
export function formatMemberCode(prefix: string, seq: number): string {
  const cleanPrefix = prefix.trim().toUpperCase() || 'DZB';
  const num = Math.max(1, Math.floor(seq));
  return `${cleanPrefix}${String(num).padStart(3, '0')}`;
}

/** 生成当前支部下一个未使用的编号（支部缩写 + 3 位数字，如 ZGSB001） */
export function generateNextMemberCode(branchName: string | undefined, existingCodes: Iterable<string>): string {
  const prefix = getBranchAbbreviation(branchName);
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let maxSeq = 0;

  for (const code of existingCodes) {
    const match = (code ?? '').trim().match(re);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxSeq) {
        maxSeq = n;
      }
    }
  }

  return formatMemberCode(prefix, maxSeq + 1);
}

/** 身份证号自动脱敏掩码（保留前 4 位与后 4 位） */
export function maskIdCard(idCard?: string): string {
  const clean = (idCard ?? '').trim();
  if (!clean) return '—';
  if (clean.length <= 8) return '*'.repeat(clean.length);
  return `${clean.slice(0, 4)}${'*'.repeat(clean.length - 8)}${clean.slice(-4)}`;
}

/** 联系电话轻度脱敏 */
export function maskPhone(phone?: string): string {
  const clean = (phone ?? '').trim();
  if (!clean) return '—';
  if (clean.length === 11) return `${clean.slice(0, 3)}****${clean.slice(7)}`;
  return clean;
}
