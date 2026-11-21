import { waitForEvenAppBridge, type EvenAppBridge } from '@evenrealities/even_hub_sdk';

/** True when running inside the Even App WebView (as opposed to a desktop browser preview). */
export function isEvenApp(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview;
}

/** The Even App bridge, or null in a plain browser (preview / development). */
export async function connectBridge(timeoutMs = 5000): Promise<EvenAppBridge | null> {
  if (!isEvenApp()) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  return Promise.race([waitForEvenAppBridge(), timeout]);
}
