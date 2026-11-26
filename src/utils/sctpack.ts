/**
 * 三尺台专属数据包格式（.sctpack）编码 / 加密 / 解包与选择性导入导出引擎
 *
 * 二进制封装格式（Header 34 字节 + AES-256-GCM 密文）：
 *   [0..4]   Magic: "SCTP" (0x53 0x43 0x54 0x50)
 *   [4]      Format Version: 0x01
 *   [5]      Flags bitmask:
 *              bit0 (0x01) = 用户自定义口令加密（导入时需输入口令）
 *              bit1 (0x02) = 内部明文已 Gzip 压缩
 *   [6..22]  Random Salt (16 bytes)
 *   [22..34] AES-GCM IV (12 bytes)
 *   [34..]   AES-256-GCM Ciphertext + 16-byte Auth Tag
 *
 * - 默认模式：使用内置派生密钥加密，记事本打开完全不可读且防篡改，导入免输密码。
 * - 口令模式：使用用户设定交接口令 + PBKDF2-SHA256 派生密钥，接收人需输入正确口令。
 * - 向下兼容：导入解析同时兼容历史明文 `.json` 备份文件。
 */
import { APP_VERSION } from '@/constants/changelog';
import { DEFAULT_BRANCH_NAME } from '@/constants/workspace-presets';
import { CURRENT_SCHEMA_VERSION, exportBackup, importSelectiveBackup, migrateBackupShape } from '@/db/db';
import type { BackupShape } from '@/db/db';

const MAGIC = new Uint8Array([0x53, 0x43, 0x54, 0x50]); // "SCTP"
const FORMAT_VERSION = 1;
const FLAG_USER_PASSPHRASE = 0x01;
const FLAG_GZIP = 0x02;
const HEADER_LEN = 34;

// 内置混淆基础密钥材料（防普通文本编辑器直接查看，敏感场景建议叠加自定义交接口令）
const BUILTIN_APP_PEPPER = 'SanChiTai::OfflineWorkbench::SCTP-v1::9F3A7C2E1B4D8065';

export type ExportCategoryKey = 'core' | 'library' | 'preferences';

export interface SctPackPersonalPrefs {
  localStorageItems: Record<string, string>;
}

export interface SctPackPayload {
  format: 'sctpack';
  packVersion: 1;
  schemaVersion: number;
  appVersion: string;
  exported_at: string;
  branch_name: string;
  categories: ExportCategoryKey[];
  backup?: Partial<BackupShape>;
  preferences?: SctPackPersonalPrefs;
}

export interface SctPackSummary {
  formatLabel: '.sctpack' | '.json（旧版兼容）';
  appVersion: string;
  schemaVersion: number;
  exportedAt: string;
  branchName: string;
  categories: ExportCategoryKey[];
  hasPassphrase: boolean;
  isNewerSchema: boolean;
  counts: {
    members: number;
    calEvents: number;
    feeRecords: number;
    talks: number;
    pointRecords: number;
    docTemplates: number;
    docs: number;
    prefKeys: number;
  };
}

export type InspectPackResult =
  | { status: 'need-passphrase' }
  | { status: 'wrong-passphrase'; message: string }
  | { status: 'invalid'; message: string }
  | {
      status: 'ready';
      payload: SctPackPayload;
      summary: SctPackSummary;
      isLegacyJson: boolean;
    };

const PERSONAL_PREF_KEYS: readonly string[] = [
  'SOY_themeSettings',
  'SOY_darkMode',
  'SOY_themeColor',
  'SOY_lang',
  'sct-dash-widgets',
  'sct:members:visible-columns:v1',
  'sct:dev:collapsed-lanes:v1',
  'sct_pbc_state_v1',
  'sct_pbc_roster_v1'
];

/** 采集个人界面与排版习惯（供 .sctpack 导出及桌面端 preferences.json 持久化） */
export function collectPersonalPreferences(): SctPackPersonalPrefs {
  const localStorageItems: Record<string, string> = {};
  if (typeof localStorage === 'undefined') return { localStorageItems };
  try {
    for (const key of PERSONAL_PREF_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) {
        localStorageItems[key] = val;
      }
    }
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sct:table-layout:')) {
        const val = localStorage.getItem(key);
        if (val !== null) {
          localStorageItems[key] = val;
        }
      }
    }
  } catch {
    /* ignore storage errors */
  }
  return { localStorageItems };
}

/** 将个人习惯写回 localStorage（由调用方决定是否刷新主题/页面） */
export function applyPersonalPreferences(prefs: SctPackPersonalPrefs | undefined): number {
  if (!prefs?.localStorageItems || typeof localStorage === 'undefined') return 0;
  let applied = 0;
  try {
    for (const [key, val] of Object.entries(prefs.localStorageItems)) {
      if (typeof val === 'string') {
        localStorage.setItem(key, val);
        applied += 1;
      }
    }
  } catch {
    /* ignore */
  }
  return applied;
}

function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('当前运行环境不支持 WebCrypto 加密接口');
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const cryptoObj = getCrypto();
  const enc = new TextEncoder();
  const baseKey = await cryptoObj.subtle.importKey('raw', enc.encode(passphrase), { name: 'PBKDF2' }, false, [
    'deriveKey'
  ]);
  const saltBuf = new Uint8Array(salt).buffer as ArrayBuffer;
  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function gzipCompress(input: Uint8Array): Promise<{ bytes: Uint8Array; compressed: boolean }> {
  if (typeof CompressionStream === 'undefined') {
    return { bytes: input, compressed: false };
  }
  try {
    const cs = new CompressionStream('gzip');
    const readPromise = new Response(cs.readable).arrayBuffer();
    const writer = cs.writable.getWriter();
    const writePromise = writer.write(new Uint8Array(input)).then(() => writer.close());
    const [out] = await Promise.all([readPromise, writePromise]);
    return { bytes: new Uint8Array(out), compressed: true };
  } catch {
    return { bytes: input, compressed: false };
  }
}

async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持 Gzip 解压');
  }
  const ds = new DecompressionStream('gzip');
  const readPromise = new Response(ds.readable).arrayBuffer();
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(new Uint8Array(input)).then(() => writer.close());
  const [out] = await Promise.all([readPromise, writePromise]);
  return new Uint8Array(out);
}

function hasMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LEN) return false;
  return bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3];
}

/** 将 SctPackPayload 编码并加密为 .sctpack 二进制字节流 */
export async function encodeSctPackBytes(payload: SctPackPayload, passphrase?: string): Promise<Uint8Array> {
  const cryptoObj = getCrypto();
  const cleanPwd = (passphrase ?? '').trim();
  const hasUserPwd = cleanPwd.length > 0;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(payload));
  const { bytes: bodyBytes, compressed } = await gzipCompress(jsonBytes);

  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const keyMaterial = hasUserPwd ? `${BUILTIN_APP_PEPPER}::${cleanPwd}` : BUILTIN_APP_PEPPER;
  const iterations = hasUserPwd ? 100_000 : 20_000;
  const aesKey = await deriveAesKey(keyMaterial, salt, iterations);

  const cipherBuf = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    aesKey,
    new Uint8Array(bodyBytes)
  );
  const cipherBytes = new Uint8Array(cipherBuf);

  const flags = (hasUserPwd ? FLAG_USER_PASSPHRASE : 0) | (compressed ? FLAG_GZIP : 0);
  const output = new Uint8Array(HEADER_LEN + cipherBytes.length);
  output.set(MAGIC, 0);
  output[4] = FORMAT_VERSION;
  output[5] = flags;
  output.set(salt, 6);
  output.set(iv, 22);
  output.set(cipherBytes, HEADER_LEN);
  return output;
}

/** 构建按分组勾选的数据包对象 */
export async function buildSelectiveSctPackPayload(
  categories: ExportCategoryKey[],
  prebuiltBackup?: BackupShape
): Promise<SctPackPayload> {
  const uniqueCats = Array.from(new Set(categories));
  const needDb = uniqueCats.includes('core') || uniqueCats.includes('library');
  const full = needDb ? (prebuiltBackup ?? (await exportBackup())) : null;

  const partialBackup: Partial<BackupShape> = {};
  if (full && uniqueCats.includes('core')) {
    partialBackup.schemaVersion = full.schemaVersion;
    partialBackup.app_version = full.app_version;
    partialBackup.exported_at = full.exported_at;
    partialBackup.branch_name = full.branch_name;
    partialBackup.members = full.members;
    partialBackup.seat_maps = full.seat_maps;
    partialBackup.cal_events = full.cal_events;
    partialBackup.dev_stages = full.dev_stages;
    partialBackup.fee_records = full.fee_records;
    partialBackup.talks = full.talks;
    partialBackup.attendance = full.attendance;
    partialBackup.point_records = full.point_records;
    partialBackup.point_vetoes = full.point_vetoes;
    partialBackup.point_rules = full.point_rules;
    partialBackup.point_schemes = full.point_schemes;
    partialBackup.point_year_scheme = full.point_year_scheme;
    partialBackup.point_year_snapshots = full.point_year_snapshots;
    partialBackup.transfer_records = full.transfer_records;
    partialBackup.volunteer_activities = full.volunteer_activities;
    partialBackup.workspace_config = full.workspace_config;
    partialBackup.party_groups = full.party_groups;
    partialBackup.youth_committee_slots = full.youth_committee_slots;
  }

  if (full && uniqueCats.includes('library')) {
    partialBackup.schemaVersion = full.schemaVersion;
    partialBackup.app_version = full.app_version;
    partialBackup.exported_at = full.exported_at;
    partialBackup.branch_name = partialBackup.branch_name || full.branch_name;
    partialBackup.doc_templates = full.doc_templates;
    partialBackup.docs = full.docs;
    partialBackup.academy_flow = full.academy_flow;
    partialBackup.knowledge_custom_items = full.knowledge_custom_items;
    partialBackup.policy_cards = full.policy_cards;
    partialBackup.policy_files = full.policy_files;
  }

  const preferences = uniqueCats.includes('preferences') ? collectPersonalPreferences() : undefined;

  return {
    format: 'sctpack',
    packVersion: 1,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exported_at: full?.exported_at || new Date().toISOString(),
    branch_name: full?.branch_name || DEFAULT_BRANCH_NAME,
    categories: uniqueCats,
    backup: needDb ? partialBackup : undefined,
    preferences
  };
}

/** 一步完成：按所选分组构建并封装为 .sctpack 二进制数据 */
export async function exportSctPackBytes(options: {
  categories: ExportCategoryKey[];
  passphrase?: string;
  prebuiltBackup?: BackupShape;
}): Promise<{ bytes: Uint8Array; payload: SctPackPayload }> {
  const payload = await buildSelectiveSctPackPayload(options.categories, options.prebuiltBackup);
  const bytes = await encodeSctPackBytes(payload, options.passphrase);
  return { bytes, payload };
}

function buildSummary(payload: SctPackPayload, hasPassphrase: boolean, isLegacyJson: boolean): SctPackSummary {
  const b = payload.backup ?? {};
  const prefKeys = Object.keys(payload.preferences?.localStorageItems ?? {}).length;
  return {
    formatLabel: isLegacyJson ? '.json（旧版兼容）' : '.sctpack',
    appVersion: payload.appVersion || '未知版本',
    schemaVersion: payload.schemaVersion || 1,
    exportedAt: payload.exported_at || '',
    branchName: payload.branch_name || '未知支部',
    categories: payload.categories,
    hasPassphrase,
    isNewerSchema: (payload.schemaVersion || 1) > CURRENT_SCHEMA_VERSION,
    counts: {
      members: Array.isArray(b.members) ? b.members.length : 0,
      calEvents: Array.isArray(b.cal_events) ? b.cal_events.length : 0,
      feeRecords: Array.isArray(b.fee_records) ? b.fee_records.length : 0,
      talks: Array.isArray(b.talks) ? b.talks.length : 0,
      pointRecords: Array.isArray(b.point_records) ? b.point_records.length : 0,
      docTemplates: Array.isArray(b.doc_templates) ? b.doc_templates.length : 0,
      docs: Array.isArray(b.docs) ? b.docs.length : 0,
      prefKeys
    }
  };
}

/** 解析并校验导入文件（同时支持 .sctpack 专属格式与旧版 .json 备份） */
export async function inspectImportBytes(bytes: Uint8Array, passphrase?: string): Promise<InspectPackResult> {
  if (hasMagicHeader(bytes)) {
    const version = bytes[4];
    if (version !== FORMAT_VERSION) {
      return {
        status: 'invalid',
        message: `不支持的数据包封装版本（v${version}），请升级三尺台后再导入`
      };
    }
    const flags = bytes[5];
    const hasUserPwd = (flags & FLAG_USER_PASSPHRASE) !== 0;
    const isGzip = (flags & FLAG_GZIP) !== 0;
    const cleanPwd = (passphrase ?? '').trim();

    if (hasUserPwd && !cleanPwd) {
      return { status: 'need-passphrase' };
    }

    const salt = bytes.slice(6, 22);
    const iv = bytes.slice(22, 34);
    const cipherBytes = bytes.slice(HEADER_LEN);

    try {
      const cryptoObj = getCrypto();
      const keyMaterial = hasUserPwd ? `${BUILTIN_APP_PEPPER}::${cleanPwd}` : BUILTIN_APP_PEPPER;
      const iterations = hasUserPwd ? 100_000 : 20_000;
      const aesKey = await deriveAesKey(keyMaterial, salt, iterations);
      const plainBuf = await cryptoObj.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        aesKey,
        new Uint8Array(cipherBytes)
      );
      const rawPlain = new Uint8Array(plainBuf);
      const utf8Bytes = isGzip ? await gzipDecompress(rawPlain) : rawPlain;
      const parsed = JSON.parse(new TextDecoder().decode(utf8Bytes)) as SctPackPayload;

      if (!parsed || parsed.format !== 'sctpack' || !Array.isArray(parsed.categories)) {
        return { status: 'invalid', message: '数据包内部结构损坏或格式无效' };
      }

      return {
        status: 'ready',
        payload: parsed,
        summary: buildSummary(parsed, hasUserPwd, false),
        isLegacyJson: false
      };
    } catch {
      if (hasUserPwd) {
        return { status: 'wrong-passphrase', message: '交接口令不正确或文件已损坏' };
      }
      return { status: 'invalid', message: '数据包校验失败：文件可能已被篡改或损坏' };
    }
  }

  // 向下兼容旧版明文 .json 备份文件
  try {
    const text = new TextDecoder().decode(bytes);
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.members)) {
      return { status: 'invalid', message: '未识别的文件格式：请导入 .sctpack 数据包或旧版 .json 备份' };
    }
    const migrated = migrateBackupShape(raw);
    const legacyPayload: SctPackPayload = {
      format: 'sctpack',
      packVersion: 1,
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 4,
      appVersion: typeof raw.app_version === 'string' ? raw.app_version : 'v0.2.5 或更早',
      exported_at: migrated.exported_at,
      branch_name: migrated.branch_name || DEFAULT_BRANCH_NAME,
      categories: ['core', 'library'],
      backup: migrated
    };
    return {
      status: 'ready',
      payload: legacyPayload,
      summary: buildSummary(legacyPayload, false, true),
      isLegacyJson: true
    };
  } catch {
    return { status: 'invalid', message: '文件解析失败：不是有效的 .sctpack 或 .json 备份文件' };
  }
}

/** 按所选模块执行精准导入（仅替换包内已选分组，不动未勾选分组） */
export async function applySctPackImport(
  payload: SctPackPayload,
  selectedCategories?: ExportCategoryKey[]
): Promise<{ appliedCategories: ExportCategoryKey[]; prefsApplied: number }> {
  const targets = (selectedCategories?.length ? selectedCategories : payload.categories).filter(cat =>
    payload.categories.includes(cat)
  );

  const importCore = targets.includes('core');
  const importLibrary = targets.includes('library');
  if ((importCore || importLibrary) && payload.backup) {
    await importSelectiveBackup(payload.backup as BackupShape, {
      core: importCore,
      library: importLibrary
    });
  }

  let prefsApplied = 0;
  if (targets.includes('preferences') && payload.preferences) {
    prefsApplied = applyPersonalPreferences(payload.preferences);
  }

  return { appliedCategories: targets, prefsApplied };
}

/** 将字节数组转为标准 Base64（供桌面端保存升级前保护快照用） */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
