// The Claude key lives in the G2 Context Android app (Android Keystore). The glasses app receives it
// over the paired local connection and keeps it in memory only, so these just check and mask it.

/** "sk-ant-api03-abcdef…wxyz" → "sk-ant-…wxyz". */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 10) return '•'.repeat(k.length);
  const head = k.startsWith('sk-ant-') ? 'sk-ant-' : k.slice(0, 3);
  return `${head}…${k.slice(-4)}`;
}

export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}
