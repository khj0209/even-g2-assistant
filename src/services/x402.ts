import type { ClientTool } from './claude';

/** facilitator-cop demo-ui (proxies the resource server and agent wallet); reached via `adb reverse tcp:4000 tcp:4000`. */
export const X402_BASE = 'http://127.0.0.1:4000';
// Same values demo-ui uses for its demo agent and for the resource URL the delegation policy matches.
const AGENT_ID = 'demo-agent';
const RESOURCE_SERVER = 'http://localhost:4002';
/** DemoCoin has 6 decimals. */
const DEMO_DECIMALS = 6;

const PATH = /^\/(securities|shop)\/[\w\-/]*$/;

/** True when the x402 demo servers answer, so Claude only gets the tool during the demo. */
export async function x402Available(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await fetchFn(`${X402_BASE}/api/rs/health`, { signal: AbortSignal.timeout(800), cache: 'no-store' })).ok;
  } catch {
    return false;
  }
}

async function call(fetchFn: typeof fetch, url: string, method: string, body?: unknown, xPayment?: string) {
  const res = await fetchFn(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(xPayment ? { 'x-payment': xPayment } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/**
 * Calls a paid API the x402 way: unpaid call → 402 with the price → the agent wallet signs
 * (its delegation policy may refuse) → the same call again with X-PAYMENT.
 */
export async function paidCall(method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!PATH.test(path)) throw new Error('path는 /securities/... 또는 /shop/... 이어야 해요');
  if (method !== 'GET' && method !== 'POST') throw new Error('method는 GET 또는 POST예요');
  const url = `${X402_BASE}/api/rs${path}`;
  const first = await call(fetchFn, url, method, body);
  if (first.status !== 402) return JSON.stringify({ status: first.status, paid: null, data: first.data });
  const requirements = first.data?.requirements;
  if (!requirements) throw new Error('402 응답에 결제 요구사항이 없어요');
  const signed = await call(fetchFn, `${X402_BASE}/api/aw/sign-payment`, 'POST', {
    agentId: AGENT_ID,
    resource: RESOURCE_SERVER + path,
    requirements,
  });
  const paid = `${Number(requirements.amount) / 10 ** DEMO_DECIMALS} DEMO`;
  if (signed.status !== 200) {
    return JSON.stringify({ status: signed.status, paid: null, price: paid, walletRefused: signed.data?.error ?? '서명 실패' });
  }
  const second = await call(fetchFn, url, method, body, signed.data.xPayment);
  return JSON.stringify({ status: second.status, paid: second.status < 400 ? paid : null, data: second.data });
}

export function x402Tools(): ClientTool[] {
  return [
    {
      def: {
        name: 'paid_api',
        description:
          "Call the demo securities/shop API, paying per call in DEMO coin from the user's agent wallet (x402, Ethereum Sepolia testnet). " +
          'Endpoints: GET /securities/quotes/{symbol} (AAPL, TSLA, 005930=삼성전자; 0.01 DEMO), GET /securities/portfolio (0.01), ' +
          'POST /securities/orders {symbol, side: "buy"|"sell", quantity} (1 DEMO), GET /shop/products (free), ' +
          'POST /shop/cart/checkout {items: [{productId, quantity}]}, GET /shop/orders/{id} (0.005). ' +
          'The wallet refuses payments over its delegation limit; then tell the user it was refused and why. Mention what was paid.',
        input_schema: {
          type: 'object',
          properties: {
            method: { type: 'string', enum: ['GET', 'POST'] },
            path: { type: 'string' },
            body: { type: 'object' },
          },
          required: ['method', 'path'],
          additionalProperties: false,
        },
        eager_input_streaming: true,
      },
      run: async (input) => {
        const { method, path, body } = (input ?? {}) as { method?: string; path?: string; body?: unknown };
        if (typeof path !== 'string' || typeof method !== 'string') throw new Error('method와 path 값이 필요해요');
        return paidCall(method, path.trim(), body);
      },
    },
  ];
}
