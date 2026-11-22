/**
 * 成员批量导入核心工具（纯函数 + 按需动态加载 xlsx）
 *
 * 特性：
 * - 支持 .xlsx / .xls / .csv（自动识别 UTF-8 与 Windows WPS 常见的 GB18030/GBK 编码）
 * - 自动探测真正表头行（跳过顶部大标题/说明行）
 * - 内置高校党建同义词库 + 内容特征智能映射列，默认忽略敏感与未知列
 * - 兼容多种中文/斜杠/点分/Excel 序列号日期，自动联动入党/转正时间计算党员身份
 */
import dayjs from 'dayjs';
import { FEE_STANDARD } from '@/constants/sanchitai';
import {
  computeDefaultFullDate,
  isPartyStatusAutoComputed,
  resolveEffectiveFullDate,
  resolveMemberTypeByDates
} from '@/utils/member-status';

export type MemberStandardField =
  | 'name'
  | 'join_date'
  | 'full_date'
  | 'type'
  | 'code'
  | 'role'
  | 'group'
  | 'grade'
  | 'level'
  | 'major'
  | 'advisor'
  | 'fee_category'
  | 'fee_monthly'
  | 'note';

export type ImportTargetField = MemberStandardField | '__note_append__' | '__ignore__';
export type DuplicateStrategy = 'merge' | 'skip' | 'append';

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
}

export interface ColumnMapping {
  colIndex: number;
  header: string;
  samples: string[];
  target: ImportTargetField;
  sensitive: boolean;
  autoMatched: boolean;
}

export interface ImportFieldMeta {
  key: MemberStandardField;
  label: string;
  required?: boolean;
  hint: string;
}

export const IMPORT_FIELD_LIST: ImportFieldMeta[] = [
  { key: 'name', label: '姓名', required: true, hint: '必填，成员真实/登记姓名' },
  { key: 'join_date', label: '入党时间', hint: '接收为预备党员日期，填入后自动推算转正与身份' },
  { key: 'full_date', label: '转正时间', hint: '转为正式党员日期（不填默认按入党满 1 年计算）' },
  { key: 'type', label: '身份 / 发展阶段', hint: '未填入党/转正时间时生效（申请人/积极分子/发展对象等）' },
  { key: 'code', label: '编号 / 学号', hint: '成员唯一编号或学号，可用于查重匹配' },
  { key: 'role', label: '党内职务 / 角色', hint: '如党支部书记、组织委员等' },
  { key: 'group', label: '研究方向组 / 党小组', hint: '实验室组别、研究方向或党小组' },
  { key: 'grade', label: '年级', hint: '如 2025级、2024' },
  { key: 'level', label: '培养层次', hint: '如 硕士在读、博士在读、本科' },
  { key: 'major', label: '专业', hint: '学科专业名称' },
  { key: 'advisor', label: '导师', hint: '指导教师姓名' },
  { key: 'fee_category', label: '党费类别', hint: '学生党员 / 在职党员' },
  { key: 'fee_monthly', label: '月应缴党费（元）', hint: '数字，学生默认 0.2 元/月' },
  { key: 'note', label: '备注', hint: '补充说明' }
];

const SENSITIVE_HEADER_RE =
  /身份证|证件号|id[_\s-]?card|手机|电话|联系方式|phone|mobile|tel|住址|家庭地址|家庭住址|银行卡/i;

const FIELD_SYNONYMS: Record<MemberStandardField, string[]> = {
  name: ['姓名', '成员姓名', '党员姓名', '名字', 'name', 'fullname', 'full name'],
  join_date: [
    '入党时间',
    '入党日期',
    '接收为预备党员时间',
    '接收预备党员时间',
    '接收预备党员日期',
    '支部大会通过时间',
    '发展时间',
    'join_date',
    'joindate',
    'join date'
  ],
  full_date: [
    '转正时间',
    '转正日期',
    '转为正式党员时间',
    '正式党员时间',
    '预备期满时间',
    '预备期满日期',
    '预计转正时间',
    'full_date',
    'fulldate',
    'full date'
  ],
  type: ['类型', '党员类型', '政治面貌', '身份', '党员身份', '发展阶段', '当前阶段', '面貌', 'type', 'status', 'stage'],
  code: ['编号', '学号', '工号', '学工号', '人员编号', '序号编号', 'code', 'student_id', 'student id'],
  role: ['角色', '职务', '党内职务', '支委职务', '支部职务', '任职', 'role', 'position'],
  group: ['研究方向组', '研究方向', '方向组', '党小组', '小组', '分组', '课题组', '实验室', '方向', 'group', 'team'],
  grade: ['年级', '入学年份', '届别', '级', 'grade', 'cohort'],
  level: ['层次', '培养层次', '学历层次', '学位类型', '学位类别', '类别层次', '学历', 'level', 'degree'],
  major: ['专业', '学科专业', '所属专业', '专业名称', 'major'],
  advisor: ['导师', '指导教师', '导师姓名', '辅导员', 'advisor', 'supervisor'],
  fee_category: ['党费类别', '缴费类别', '党员类别', 'fee_category'],
  fee_monthly: ['月应缴党费', '月缴党费', '党费标准', '月党费', '应缴党费', '党费金额', '党费', 'fee_monthly', 'dues'],
  note: ['备注', '说明', '其他说明', 'note', 'remark', 'remarks']
};

export function isSensitiveHeader(header: string): boolean {
  return SENSITIVE_HEADER_RE.test(header.trim());
}

function normalizeHeaderText(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[（(].*?[）)]/g, m => m)
    .trim();
}

function simplifyKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s:：*·\-_/]+/g, '');
}

/** 轻量 RFC-4180 CSV 解析器（支持引号内逗号与换行） */
export function parseCsvText(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r') {
      if (clean[i + 1] === '\n') i += 1;
      row.push(field.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.some(cell => cell !== '')) {
    rows.push(row);
  }
  return rows;
}

/** 读取并解码 CSV（UTF-8 优先，失败自动回退 Windows GB18030/GBK） */
async function readCsvFile(file: File): Promise<ParsedWorkbook> {
  const buf = await file.arrayBuffer();
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('gb18030').decode(buf);
  }
  return {
    fileName: file.name,
    sheets: [{ name: file.name.replace(/\.csv$/i, '') || 'CSV', rows: parseCsvText(text) }]
  };
}

/** 解析用户上传的 Excel (.xlsx/.xls) 或 CSV 文件 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedWorkbook> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    return readCsvFile(file);
  }

  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const sheets: ParsedSheet[] = wb.SheetNames.map(name => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: ''
    });
    return {
      name,
      rows: rows.filter(r => Array.isArray(r) && r.some(cell => String(cell ?? '').trim() !== ''))
    };
  }).filter(s => s.rows.length > 0);

  return {
    fileName: file.name,
    sheets
  };
}

function matchHeaderSynonym(header: string): { field: MemberStandardField; score: number } | null {
  const simple = simplifyKey(header);
  if (!simple) return null;
  if (isSensitiveHeader(header)) return null;

  let best: { field: MemberStandardField; score: number } | null = null;
  for (const meta of IMPORT_FIELD_LIST) {
    const synonyms = FIELD_SYNONYMS[meta.key];
    for (const syn of synonyms) {
      const synKey = simplifyKey(syn);
      if (simple === synKey) {
        const score = 100 + synKey.length;
        if (!best || score > best.score) best = { field: meta.key, score };
      } else if (synKey.length >= 2 && (simple.includes(synKey) || synKey.includes(simple))) {
        const score = 50 + synKey.length;
        if (!best || score > best.score) best = { field: meta.key, score };
      }
    }
  }
  return best;
}

/** 自动探测真正的表头所在行（跳过“XX党支部党员名册”等合并大标题行） */
export function detectHeaderRowIndex(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 10);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < maxScan; i += 1) {
    const row = rows[i] ?? [];
    const nonEmpty = row.map(c => normalizeHeaderText(c)).filter(Boolean);
    if (nonEmpty.length <= 1) continue;

    let score = 0;
    const matchedFields = new Set<string>();
    for (const cell of nonEmpty) {
      const hit = matchHeaderSynonym(cell);
      if (hit && !matchedFields.has(hit.field)) {
        matchedFields.add(hit.field);
        score += hit.field === 'name' ? 12 : 6;
      }
    }
    // 偏好包含“姓名”且列数适中的行
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/** 灵活解析各种日期格式（含 Excel 数字序列、点分/斜杠/中文/仅年月） */
export function parseFlexibleDate(raw: unknown): { value: string; warning?: string } {
  if (raw === null || raw === undefined || raw === '') {
    return { value: '' };
  }

  // Excel 序列号日期（1954 ~ 2091 年区间，避免把 2024 年级当成日期）
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 20000 && raw <= 75000) {
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw) * 86_400_000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return { value: `${yyyy}-${mm}-${dd}` };
    }
  }

  const text = String(raw).trim();
  if (!text || text === '—' || text === '-' || text === '/' || text === '无') {
    return { value: '' };
  }

  // 纯数字序列字符串（如 CSV 导出 Excel 序列）
  if (/^\d{5}$/.test(text)) {
    const num = Number(text);
    if (num >= 20000 && num <= 75000) {
      return parseFlexibleDate(num);
    }
  }

  // 8 位纯数字：YYYYMMDD
  const compact8 = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact8) {
    const iso = `${compact8[1]}-${compact8[2]}-${compact8[3]}`;
    if (dayjs(iso).isValid()) return { value: iso };
  }

  // 标准年月日：YYYY-M-D / YYYY/M/D / YYYY.M.D / YYYY年M月D日
  const fullMatch = text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (fullMatch) {
    const iso = `${fullMatch[1]}-${fullMatch[2].padStart(2, '0')}-${fullMatch[3].padStart(2, '0')}`;
    if (dayjs(iso).isValid()) return { value: iso };
  }

  // 仅含年月：YYYY-M / YYYY.M / YYYY/M / YYYY年M月 / YYYYMM
  const ymMatch = text.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/) ?? text.match(/^(\d{4})(\d{2})$/);
  if (ymMatch) {
    const month = Number(ymMatch[2]);
    if (month >= 1 && month <= 12) {
      const iso = `${ymMatch[1]}-${String(month).padStart(2, '0')}-01`;
      return { value: iso, warning: `日期「${text}」仅含年月，已按 01 日补齐` };
    }
  }

  // 兜底 dayjs 解析（如 ISO 时间戳）
  const parsed = dayjs(text);
  if (parsed.isValid() && /^\d{4}/.test(text)) {
    return { value: parsed.format('YYYY-MM-DD') };
  }

  return { value: '', warning: `日期「${text}」格式无法识别，已留空` };
}

/** 归一化政治面貌/成员类型文本 */
export function normalizeMemberTypeText(raw: string): Sct.MemberType | '' {
  const s = raw.trim();
  if (!s) return '';
  if (/预备/.test(s)) return '预备党员';
  if (/正式|中共党员|^党员$/.test(s)) return '正式党员';
  if (/发展对象/.test(s)) return '发展对象';
  if (/积极分子/.test(s)) return '入党积极分子';
  if (/申请|群众|团员|共青团/.test(s)) return '申请人';
  return '';
}

function normalizeGrade(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^20\d{2}$/.test(s)) return `${s}级`;
  return s;
}

function normalizeFeeCategory(raw: string): Sct.FeeCategory | '' {
  const s = raw.trim();
  if (!s) return '';
  if (/在职|教工|教师|职工/.test(s)) return '在职党员';
  if (/学生|硕士|博士|本科|研究生/.test(s)) return '学生党员';
  return '';
}

function parseFeeMonthly(raw: unknown): { value?: number; warning?: string } {
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return { value: Number(raw.toFixed(1)) };
  }
  const text = String(raw).trim();
  if (!text) return {};
  const cleaned = text.replace(/[¥￥元/月\s]/g, '');
  const num = Number(cleaned);
  if (!Number.isNaN(num) && num >= 0) {
    return { value: Number(num.toFixed(1)) };
  }
  return { warning: `党费金额「${text}」无法识别，已采用默认标准` };
}

function cellPreviewText(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && raw >= 20000 && raw <= 75000 && Number.isInteger(raw)) {
    const parsed = parseFlexibleDate(raw);
    return parsed.value || String(raw);
  }
  return String(raw).trim();
}

/** 根据表头与样例数据生成初始智能列映射 */
export function buildInitialColumnMappings(rows: unknown[][], headerRowIndex: number): ColumnMapping[] {
  const headerRow = rows[headerRowIndex] ?? [];
  const dataRows = rows.slice(headerRowIndex + 1);
  const colCount = Math.max(headerRow.length, ...dataRows.slice(0, 20).map(r => (Array.isArray(r) ? r.length : 0)));

  const usedFields = new Set<MemberStandardField>();
  const mappings: ColumnMapping[] = [];

  for (let colIndex = 0; colIndex < colCount; colIndex += 1) {
    const rawHeader = normalizeHeaderText(headerRow[colIndex]);
    const header = rawHeader || `未命名列 ${colIndex + 1}`;
    const samples: string[] = [];
    for (const r of dataRows) {
      if (samples.length >= 3) break;
      const val = cellPreviewText(r?.[colIndex]);
      if (val) samples.push(val);
    }

    // 整列全空且无表头则跳过展示
    if (!rawHeader && samples.length === 0) continue;

    const sensitive = isSensitiveHeader(header);
    let target: ImportTargetField = '__ignore__';
    let autoMatched = false;

    if (!sensitive) {
      const hit = matchHeaderSynonym(header);
      if (hit && !usedFields.has(hit.field)) {
        target = hit.field;
        usedFields.add(hit.field);
        autoMatched = true;
      } else if (
        !usedFields.has('type') &&
        samples.length > 0 &&
        samples.every(s => Boolean(normalizeMemberTypeText(s)))
      ) {
        target = 'type';
        usedFields.add('type');
        autoMatched = true;
      }
    }

    mappings.push({
      colIndex,
      header,
      samples,
      target,
      sensitive,
      autoMatched
    });
  }

  return mappings;
}

export interface ImportRowData {
  name: string;
  type: Sct.MemberType;
  code: string;
  role: string;
  group: string;
  grade: string;
  level: string;
  major: string;
  advisor: string;
  join_date: string;
  full_date: string;
  fee_category?: Sct.FeeCategory;
  fee_monthly?: number;
  note: string;
}

export interface ImportPreviewRow {
  rowNumber: number;
  data: ImportRowData;
  errors: string[];
  warnings: string[];
  matchedExisting?: Sct.Member;
  matchReason?: 'code' | 'name';
  autoComputedType: boolean;
}

/** 按当前列映射解析全部数据行并生成校验预览 */
export function buildImportPreviewRows(
  rows: unknown[][],
  headerRowIndex: number,
  mappings: ColumnMapping[],
  existingMembers: Sct.Member[],
  today: string = dayjs().format('YYYY-MM-DD')
): ImportPreviewRow[] {
  const dataRows = rows.slice(headerRowIndex + 1);
  const byCode = new Map<string, Sct.Member>();
  const byName = new Map<string, Sct.Member>();
  existingMembers.forEach(m => {
    if (m.code?.trim()) byCode.set(m.code.trim().toLowerCase(), m);
    if (m.name?.trim()) byName.set(m.name.trim(), m);
  });

  const seenNamesInFile = new Set<string>();
  const preview: ImportPreviewRow[] = [];

  dataRows.forEach((rawRow, idx) => {
    if (!Array.isArray(rawRow)) return;
    const hasAnyValue = mappings.some(m => m.target !== '__ignore__' && String(rawRow[m.colIndex] ?? '').trim() !== '');
    if (!hasAnyValue) return;

    const errors: string[] = [];
    const warnings: string[] = [];
    const fields: Partial<Record<MemberStandardField, unknown>> = {};
    const extraNotes: string[] = [];

    for (const m of mappings) {
      if (m.target === '__ignore__') continue;
      const cell = rawRow[m.colIndex];
      if (m.target === '__note_append__') {
        const text = cellPreviewText(cell);
        if (text) extraNotes.push(`${m.header}: ${text}`);
      } else {
        fields[m.target] = cell;
      }
    }

    const name = String(fields.name ?? '').trim();
    if (!name) {
      errors.push('缺少姓名（将跳过）');
    } else if (seenNamesInFile.has(name)) {
      warnings.push('导入文件内存在同名行');
    } else {
      seenNamesInFile.add(name);
    }

    const code = String(fields.code ?? '').trim();
    const role = String(fields.role ?? '').trim();
    const group = String(fields.group ?? '').trim();
    const grade = normalizeGrade(String(fields.grade ?? ''));
    const level = String(fields.level ?? '').trim();
    const major = String(fields.major ?? '').trim();
    const advisor = String(fields.advisor ?? '').trim();

    const parsedJoin = parseFlexibleDate(fields.join_date);
    if (parsedJoin.warning) warnings.push(`入党时间：${parsedJoin.warning}`);
    const parsedFull = parseFlexibleDate(fields.full_date);
    if (parsedFull.warning) warnings.push(`转正时间：${parsedFull.warning}`);

    const joinDate = parsedJoin.value;
    const fullDate = parsedFull.value || (joinDate ? computeDefaultFullDate(joinDate) : '');

    const rawTypeText = String(fields.type ?? '').trim();
    const parsedType = normalizeMemberTypeText(rawTypeText);
    if (rawTypeText && !parsedType) {
      warnings.push(`身份「${rawTypeText}」未识别，已按默认规则处理`);
    }

    const baseType: Sct.MemberType = parsedType || '申请人';
    const autoComputedType = isPartyStatusAutoComputed(joinDate, fullDate);
    const finalType = resolveMemberTypeByDates(baseType, joinDate, fullDate, today);

    const parsedFeeCat = normalizeFeeCategory(String(fields.fee_category ?? ''));
    const parsedFeeMonthly = parseFeeMonthly(fields.fee_monthly);
    if (parsedFeeMonthly.warning) warnings.push(parsedFeeMonthly.warning);

    let feeCategory: Sct.FeeCategory | undefined = parsedFeeCat || undefined;
    let feeMonthly = parsedFeeMonthly.value;
    if (!feeCategory && typeof feeMonthly === 'number' && feeMonthly > FEE_STANDARD.studentMonthly) {
      feeCategory = '在职党员';
    }
    if (feeCategory === '学生党员' && feeMonthly === undefined) {
      feeMonthly = FEE_STANDARD.studentMonthly;
    }

    const baseNote = String(fields.note ?? '').trim();
    const combinedNote = [baseNote, ...extraNotes].filter(Boolean).join('；');

    // 查重：编号优先，其次姓名
    let matchedExisting: Sct.Member | undefined;
    let matchReason: 'code' | 'name' | undefined;
    if (code && byCode.has(code.toLowerCase())) {
      matchedExisting = byCode.get(code.toLowerCase());
      matchReason = 'code';
    } else if (name && byName.has(name)) {
      matchedExisting = byName.get(name);
      matchReason = 'name';
    }

    const effectiveFull = resolveEffectiveFullDate(joinDate, fullDate);

    preview.push({
      rowNumber: headerRowIndex + idx + 2,
      data: {
        name,
        type: finalType,
        code,
        role,
        group,
        grade,
        level,
        major,
        advisor,
        join_date: joinDate,
        full_date: effectiveFull,
        fee_category: feeCategory,
        fee_monthly: feeMonthly,
        note: combinedNote
      },
      errors,
      warnings,
      matchedExisting,
      matchReason,
      autoComputedType
    });
  });

  return preview;
}

/** 生成标准 Excel 导入模板（含示例数据与填写说明） */
export async function buildImportTemplateBlob(): Promise<Blob> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const sampleRows = [
    [
      '姓名',
      '编号',
      '入党时间',
      '转正时间',
      '政治面貌',
      '党内职务',
      '研究方向组',
      '年级',
      '培养层次',
      '专业',
      '导师',
      '党费类别',
      '月应缴党费',
      '备注'
    ],
    [
      '陈示例',
      'DY99',
      '2022-06-05',
      '2023-06-05',
      '正式党员',
      '',
      '视算一组',
      '2025级',
      '硕士在读',
      '计算机技术',
      '张老师',
      '学生党员',
      0.2,
      '示例：填写入党/转正时间后自动计算身份'
    ],
    [
      '林示例',
      'FZ99',
      '',
      '',
      '入党积极分子',
      '',
      '软件组',
      '2026级',
      '博士在读',
      '软件工程',
      '李老师',
      '',
      '',
      '示例：非党员可留空入党时间'
    ]
  ];

  const guideRows = [
    ['字段', '是否必填', '说明'],
    ['姓名', '必填', '成员姓名；其余列均可按需增删，系统支持导入时自由映射列名'],
    [
      '入党时间',
      '选填',
      '支持 2022-06-05 / 2022.6.5 / 2022年6月5日 等格式；填写后系统自动按满1年推算转正时间与正式/预备身份'
    ],
    ['转正时间', '选填', '若预备期有延长或提前可手动填写；已届满自动判定为正式党员，未届满判定为预备党员'],
    ['政治面貌', '选填', '未填入党/转正时间时生效，支持：正式党员 / 预备党员 / 发展对象 / 入党积极分子 / 申请人'],
    ['隐私说明', '提示', '请勿在表格中保留身份证号等高敏列；若原表包含，导入向导会默认忽略']
  ];

  const wsMain = XLSX.utils.aoa_to_sheet(sampleRows);
  wsMain['!cols'] = [
    { wch: 10 },
    { wch: 10 },
    { wch: 13 },
    { wch: 13 },
    { wch: 13 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 11 },
    { wch: 16 },
    { wch: 10 },
    { wch: 11 },
    { wch: 11 },
    { wch: 28 }
  ];

  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 68 }];

  XLSX.utils.book_append_sheet(wb, wsMain, '成员信息表');
  XLSX.utils.book_append_sheet(wb, wsGuide, '填写说明');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
}
