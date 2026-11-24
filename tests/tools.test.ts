import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askClaude, type ClientTool } from '../src/services/claude';
import { fetchContext } from '../src/services/context';
import { smartThingsTools } from '../src/services/smartthings';

afterEach(() => vi.unstubAllGlobals());

/** A stand-in client that replays canned responses and records what was sent. */
function fakeClient(responses: object[]) {
  const sent: { messages: Anthropic.Beta.BetaMessageParam[]; tools: { name: string }[] }[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: { messages: Anthropic.Beta.BetaMessageParam[]; tools: { name: string }[] }) {
          sent.push({ messages: structuredClone(params.messages), tools: params.tools });
          const msg = responses.shift() as { content: { type: string; text?: string }[] };
          return {
            on(ev: string, fn: (t: string) => void) {
              if (ev === 'text') for (const b of msg.content) if (b.type === 'text') fn(b.text!);
            },
            finalMessage: async () => msg,
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

const usage = { input_tokens: 10, output_tokens: 5 };

describe('askClaude tool loop', () => {
  it('runs tools, sends the results back and returns the final answer', async () => {
    const { client, sent } = fakeClient([
      { stop_reason: 'tool_use', usage, content: [{ type: 'text', text: '확인할게요. ' }, { type: 'tool_use', id: 't1', name: 'lights', input: { on: false } }] },
      { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '거실 불을 껐어요.' }] },
    ]);
    const run = vi.fn(async () => '{"ok":true}');
    const tool: ClientTool = { def: { name: 'lights', input_schema: { type: 'object' } }, run };
    let streamed = '';
    const r = await askClaude(client, 'claude-opus-5-5', [{ role: 'user', text: '거실 불 꺼' }], (d) => (streamed += d), undefined, '', [tool]);
    expect(run).toHaveBeenCalledWith({ on: false });
    expect(r.text).toBe('확인할게요. 거실 불을 껐어요.');
    expect(streamed).toBe(r.text);
    expect(r.usage.input_tokens).toBe(20);
    expect(sent[0].tools.map((t) => t.name)).toEqual(['web_search', 'lights']);
    const second = sent[1].messages;
    expect(second.at(-2)?.role).toBe('assistant');
    expect(second.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] });
  });

  it('reports tool errors to Claude and resumes a paused turn', async () => {
    const { client, sent } = fakeClient([
      { stop_reason: 'pause_turn', usage, content: [{ type: 'text', text: '' }] },
      { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't2', name: 'nope', input: {} }] },
      { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: '그 기기는 없어요.' }] },
    ]);
    const r = await askClaude(client, 'claude-haiku-5-5', [{ role: 'user', text: 'x' }], () => {}, undefined, '', []);
    expect(r.text).toBe('그 기기는 없어요.');
    expect(sent).toHaveLength(3);
    expect(sent[2].messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: '없는 도구: nope', is_error: true }] });
  });
});

describe('SmartThings tools', () => {
  it('check input before calling G2 Context, and send the pairing code', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/mode')) return new Response(JSON.stringify({ mode: 'assistant' }));
      return new Response(JSON.stringify({ ok: true }));
    });
    await fetchContext('K');
    const [devices, status, command] = smartThingsTools('K');
    await expect(command.run({ device_id: 'd1', command: 'off' })).rejects.toThrow('capability 값이 필요해요');
    await expect(command.run({ device_id: 'd1', capability: 'switch', command: 'off', arguments: 'x' })).rejects.toThrow('배열');
    expect(calls.filter((c) => c.url.includes('/st/'))).toHaveLength(0);
    await devices.run({});
    await status.run({ device_id: 'a b' });
    await command.run({ device_id: 'd1', capability: 'switch', command: 'off' });
    const st = calls.filter((c) => c.url.includes('/st/'));
    expect(st.map((c) => c.url)).toEqual([
      'http://127.0.0.1:8765/st/devices?key=K',
      'http://127.0.0.1:8765/st/status?id=a%20b&key=K',
      'http://127.0.0.1:8765/st/command?key=K',
    ]);
    expect(JSON.parse(st[2].init!.body as string)).toEqual({ deviceId: 'd1', capability: 'switch', command: 'off', arguments: [] });
  });
});
