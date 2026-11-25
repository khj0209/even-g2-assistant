import { describe, expect, it, vi } from 'vitest';
import { paidCall } from '../src/services/x402';

const requirements = { scheme: 'exact', network: 'ethereum', amount: '10000', asset: '0xa', payTo: '0xb', maxTimeoutSeconds: 300 };
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

describe('paidCall (x402)', () => {
  it('pays on 402: asks the wallet to sign, then retries with X-PAYMENT', async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/api/aw/sign-payment')) return json(200, { xPayment: 'PAY' });
      return (init.headers as Record<string, string>)['x-payment'] === 'PAY' ? json(200, { price: 81200 }) : json(402, { requirements });
    });
    const r = JSON.parse(await paidCall('GET', '/securities/quotes/005930', undefined, fetchFn as unknown as typeof fetch));
    expect(r).toEqual({ status: 200, paid: '0.01 DEMO', data: { price: 81200 } });
    const sign = JSON.parse(fetchFn.mock.calls[1][1].body as string);
    expect(sign).toEqual({ agentId: 'demo-agent', resource: 'http://localhost:4002/securities/quotes/005930', requirements });
  });

  it('reports a wallet refusal without retrying', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.endsWith('/sign-payment') ? json(403, { error: 'amount exceeds maxAmountPerTx' }) : json(402, { requirements: { ...requirements, amount: '1000000' } }),
    );
    const r = JSON.parse(await paidCall('POST', '/securities/orders', { symbol: 'AAPL', side: 'buy', quantity: 1 }, fetchFn as unknown as typeof fetch));
    expect(r).toMatchObject({ status: 403, paid: null, price: '1 DEMO', walletRefused: 'amount exceeds maxAmountPerTx' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('passes free endpoints through and rejects other paths', async () => {
    const fetchFn = vi.fn(async () => json(200, { products: [] }));
    expect(JSON.parse(await paidCall('GET', '/shop/products', undefined, fetchFn as unknown as typeof fetch)).paid).toBeNull();
    await expect(paidCall('GET', '/../wallets', undefined, fetchFn as unknown as typeof fetch)).rejects.toThrow();
  });
});
