/**
 * 本地口令哈希（应用锁用）
 *
 * SHA-256 + 固定盐；file:// 等非安全上下文回退到 FNV-1a。
 * 注意：本地锁是隐私遮挡而非加密防护，数据安全性依赖系统盘加密。
 */
export async function sha256(text: string): Promise<string> {
  const salted = `sct::${text}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(salted);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 回退：FNV-1a 32bit（仅兜底）
  let hash = 0x811c9dc5;
  for (let i = 0; i < salted.length; i += 1) {
    hash ^= salted.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv-${hash.toString(16)}`;
}
