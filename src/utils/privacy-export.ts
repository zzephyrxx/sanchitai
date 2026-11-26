/**
 * 全局隐私脱敏与双版本导出工具（脱敏公示版 vs 全量报送版）
 */

export function maskIdCard(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 2)}****`;
  return `${raw.slice(0, 4)}**********${raw.slice(-4)}`;
}

export function maskPhone(value?: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (raw.length < 7) return `${raw.slice(0, 2)}****`;
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

export function formatIdCardForExport(value: string | undefined, mode: Sct.ExportPrivacyMode): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  return mode === 'full' ? raw : maskIdCard(raw);
}

export function formatPhoneForExport(value: string | undefined, mode: Sct.ExportPrivacyMode): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  return mode === 'full' ? raw : maskPhone(raw);
}

export function privacyModeLabel(mode: Sct.ExportPrivacyMode): string {
  return mode === 'full' ? '全量报送版' : '脱敏公示版';
}

export function privacyModeFileSuffix(mode: Sct.ExportPrivacyMode): string {
  return mode === 'full' ? '_全量报送' : '_脱敏公示';
}
