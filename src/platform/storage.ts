import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';

/** Small key-value store kept on this phone only. */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const PREFIX = 'g2a:';

/** The Even App's per-plugin storage (survives WebView cache clears). */
export function evenKV(bridge: EvenAppBridge): KV {
  return {
    async get(key) {
      const v = await bridge.getLocalStorage(PREFIX + key);
      return v ? v : null;
    },
    async set(key, value) {
      await bridge.setLocalStorage(PREFIX + key, value);
    },
    async remove(key) {
      await bridge.setLocalStorage(PREFIX + key, '');
    },
  };
}

export function browserKV(store: Storage = localStorage): KV {
  return {
    async get(key) {
      return store.getItem(PREFIX + key);
    },
    async set(key, value) {
      store.setItem(PREFIX + key, value);
    },
    async remove(key) {
      store.removeItem(PREFIX + key);
    },
  };
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    async get(key) {
      return m.get(key) ?? null;
    },
    async set(key, value) {
      m.set(key, value);
    },
    async remove(key) {
      m.delete(key);
    },
  };
}
