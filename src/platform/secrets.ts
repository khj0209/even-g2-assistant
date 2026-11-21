import type { KV } from './storage';

// API keys are stored only on this phone, encrypted at rest:
// - the ciphertext (AES-GCM, random IV) lives in the plugin's key-value storage;
// - the AES key is a *non-extractable* WebCrypto key kept in IndexedDB, so page script can use
//   it to decrypt but can never read its bytes, and a copy of the key-value storage alone
//   (backup, log, debug dump) does not reveal the API key.
// Keys are never sent anywhere except the API host they belong to, never logged, and the UI
// only ever shows a masked form.

const DB = 'g2-assistant-vault';
const STORE = 'keys';
const KEY_ID = 'master';

export type SecretName = 'anthropic' | 'openai';

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

async function masterKey(): Promise<CryptoKey> {
  const existing = await idb<CryptoKey | undefined>((s) => s.get(KEY_ID), 'readonly');
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb((s) => s.put(key, KEY_ID), 'readwrite');
  return key;
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

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

export function looksLikeOpenAIKey(key: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

export class SecretStore {
  /** Decrypted values, kept in memory only for this page's lifetime. */
  private cache = new Map<SecretName, string>();
  /** False when this WebView has no WebCrypto/IndexedDB: secrets then live in memory only. */
  readonly persistent: boolean;

  constructor(private kv: KV) {
    this.persistent = typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
  }

  async get(name: SecretName): Promise<string | null> {
    if (this.cache.has(name)) return this.cache.get(name)!;
    if (!this.persistent) return null;
    const stored = await this.kv.get(`secret:${name}`);
    if (!stored) return null;
    try {
      const [iv, ct] = stored.split('.').map(unb64);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await masterKey(), ct);
      const value = new TextDecoder().decode(plain);
      this.cache.set(name, value);
      return value;
    } catch {
      // The vault key is gone (site data cleared) or the record is corrupt: the secret is unrecoverable.
      await this.kv.remove(`secret:${name}`);
      return null;
    }
  }

  async set(name: SecretName, value: string): Promise<void> {
    const v = value.trim();
    this.cache.set(name, v);
    if (!this.persistent) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await masterKey(), new TextEncoder().encode(v)));
    await this.kv.set(`secret:${name}`, `${b64(iv)}.${b64(ct)}`);
  }

  async remove(name: SecretName): Promise<void> {
    this.cache.delete(name);
    await this.kv.remove(`secret:${name}`);
  }
}
