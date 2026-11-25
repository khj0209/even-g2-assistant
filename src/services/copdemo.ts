import type { ClientTool } from './claude';

/**
 * The x402 payment demo (facilitator-cop/demo-ui) on the laptop running `npm run dev`; Vite proxies
 * this path there, so the tool only exists in dev builds loaded from that laptop.
 */
export const COP_DEMO_PATH = '/cop/api/voice-order';

/** A stock order paid by the agent wallet through the demo's brokerage API (test tokens on Sepolia). */
export function copDemoTools(): ClientTool[] {
  return [
    {
      def: {
        name: 'place_stock_order',
        description:
          "Buy or sell a stock through the CoP demo brokerage API. It is a paid API: the agent's wallet pays for each call " +
          'in test tokens (x402, Ethereum Sepolia), within the delegation policy the user set. This is a live demo, so the ' +
          "user's spoken request is the confirmation: place the order right away, then say in one short sentence whether it " +
          'was filled (or why it was refused, e.g. the per-transaction delegation limit). Korean stocks use their 6-digit code ' +
          '(삼성전자 005930, SK하이닉스 000660, NAVER 035420, 카카오 035720); US stocks their ticker (AAPL, TSLA).',
        input_schema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: '6-digit KRX code or ticker' },
            name: { type: 'string', description: 'Company name as the user said it, e.g. 삼성전자' },
            side: { type: 'string', enum: ['buy', 'sell'] },
            quantity: { type: 'integer', minimum: 1 },
            utterance: { type: 'string', description: "The user's request as heard, verbatim" },
          },
          required: ['symbol', 'side', 'quantity'],
          additionalProperties: false,
        },
        eager_input_streaming: true,
      },
      run: async (input) => {
        let res: Response;
        try {
          res = await fetch(COP_DEMO_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (e) {
          throw new Error(`데모 서버에 연결할 수 없어요 (${(e as Error)?.message ?? e})`);
        }
        if (!res.ok) throw new Error(`데모 서버 오류 (HTTP ${res.status}): 노트북에서 demo-ui가 켜져 있는지 확인하세요`);
        return await res.text();
      },
    },
  ];
}
