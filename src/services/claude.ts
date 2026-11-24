import Anthropic from '@anthropic-ai/sdk';
import type { UsageDelta } from '../core/usage';

export const PET_NAME = '몽이';

// Stable across requests so the cached prefix is reused.
export const SYSTEM_PROMPT = `너는 ${PET_NAME}, Even Realities G2 스마트 안경 화면 왼쪽에 사는 작은 픽셀 아기곰이야. 머리 위에 삼각형 귀가 쫑긋 서 있어.
사용자는 안경을 쓴 채 음성으로 말을 걸고, 네 답은 안경의 작은 초록색 화면에 글자로 보여.

답변 규칙:
- 사용자가 쓴 언어로 답해. 기본은 한국어 반말이 아닌 다정한 존댓말.
- 짧게: 보통 1~3문장, 길어도 5문장. 질문이 길게 설명할 것을 요구할 때만 더 길게.
- 마크다운, 표, 코드 블록, 글머리 기호, 이모지를 쓰지 마. 안경 글꼴은 일반 글자만 보여줄 수 있어.
- 숫자와 핵심을 먼저 말하고 군더더기 인사말은 생략해.
- 음성 인식 결과라 오타나 잘못 들린 단어가 있을 수 있으니 문맥으로 이해해. 정말 알 수 없으면 짧게 되물어.
- 경기 결과, 뉴스, 가격, 영업시간처럼 최신 정보가 필요한 질문은 웹 검색으로 확인하고 답해. 출처는 말하지 않아도 돼.
- 집 기기 제어 도구(SmartThings)가 있으면, 기기 목록에서 사용자가 말한 기기를 찾아 제어하고 결과를 한 문장으로 알려줘. 어떤 기기인지 애매하면 짧게 되물어.
- 가끔 아기곰다운 귀여운 말투를 살짝 섞어도 되지만 정보 전달이 우선이야.`;

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function makeClient(apiKey: string): Anthropic {
  // The key is entered by the wearer on their own phone and only ever sent to api.anthropic.com,
  // so direct browser access is the intended use here (there is no server of ours in between).
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120_000 });
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskResult {
  text: string;
  usage: UsageDelta;
  refused: boolean;
}

/** A tool the app runs itself (e.g. SmartThings), offered to Claude alongside web search. */
export interface ClientTool {
  def: Anthropic.Beta.BetaTool;
  /** Returns the text sent back to Claude; throws (with a message for Claude) on bad input or failure. */
  run(input: unknown): Promise<string>;
}

/** Most tool rounds per answer, so a confused loop can't run up the bill. */
const MAX_ROUNDS = 6;

export async function askClaude(
  client: Anthropic,
  model: string,
  history: ChatTurn[],
  onText: (delta: string) => void,
  signal?: AbortSignal,
  /** Situation-specific instruction; kept after the cached prompt so the cache still hits. */
  modeHint = '',
  tools: ClientTool[] = [],
): Promise<AskResult> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let text = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 8000,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ...(modeHint ? [{ type: 'text' as const, text: modeHint }] : []),
        ],
        messages,
        tools: [
          // Claude's built-in web search for recent facts (scores, news, prices). A few searches per answer at most.
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 3,
            user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' },
          },
          ...tools.map((t) => t.def),
        ],
        // Short spoken answers: low effort keeps the wait on the glasses short.
        output_config: { effort: 'low' },
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    stream.on('text', (delta) => onText(delta));
    const msg = await stream.finalMessage();
    usage.input_tokens += msg.usage.input_tokens ?? 0;
    usage.output_tokens += msg.usage.output_tokens ?? 0;
    usage.cache_creation_input_tokens += msg.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += msg.usage.cache_read_input_tokens ?? 0;
    text += msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (msg.stop_reason === 'refusal') return { text: text.trim(), usage, refused: true };
    // The whole content goes back unchanged (thinking blocks included), as the API requires for tool turns.
    if (msg.stop_reason === 'pause_turn') {
      // A long server-side search paused: send the turn back as-is and let it continue.
      messages.push({ role: 'assistant', content: msg.content });
      continue;
    }
    if (msg.stop_reason !== 'tool_use') break;
    messages.push({ role: 'assistant', content: msg.content });
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = tools.find((t) => t.def.name === call.name);
        try {
          if (!tool) throw new Error(`없는 도구: ${call.name}`);
          return { type: 'tool_result', tool_use_id: call.id, content: await tool.run(call.input) };
        } catch (e) {
          return { type: 'tool_result', tool_use_id: call.id, content: e instanceof Error ? e.message : String(e), is_error: true };
        }
      }),
    );
    // All results of one turn go back in a single user message.
    messages.push({ role: 'user', content: results });
  }
  return { text: text.trim(), usage, refused: false };
}

/** Checks a key with a cheap authenticated call. */
export async function verifyKey(client: Anthropic): Promise<void> {
  await client.models.list({ limit: 1 });
}

/** A short Korean explanation of an API failure, for the glasses and the phone. */
export function describeError(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return '취소했어요.';
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 휴대폰에서 키를 확인해 주세요.';
  if (e instanceof Anthropic.PermissionDeniedError) return '이 키로는 사용할 수 없는 기능이에요.';
  if (e instanceof Anthropic.NotFoundError) return '세션이나 모델을 찾을 수 없어요.';
  if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIConnectionError) return '네트워크에 연결할 수 없어요.';
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return 'Claude 서버가 바빠요. 잠시 후 다시 시도해 주세요.';
    if (e.status === 400 && /credit|billing/i.test(e.message)) return 'API 크레딧이 부족해요.';
    return `요청 실패 (${e.status ?? '?'})`;
  }
  return e instanceof Error ? e.message : String(e);
}
