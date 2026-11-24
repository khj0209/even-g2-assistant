// Situations the assistant adapts to. The Android companion app (G2 Context) detects them;
// the ids are shared with it (android/app/src/main/java/com/khj0209/g2context/Mode.kt).
export type ContextMode = 'assistant' | 'running' | 'workout' | 'driving' | 'dev' | 'meeting';

export const MODES: Record<ContextMode, { label: string; hint: string }> = {
  assistant: { label: '일상', hint: '' },
  running: {
    label: '러닝',
    hint: '사용자는 지금 달리는 중이야. 한두 문장으로 아주 짧게, 숫자(페이스·거리·시간) 위주로 답해.',
  },
  workout: {
    label: '운동',
    hint: '사용자는 지금 운동 중이야. 세트·횟수·휴식 시간·자세 팁처럼 바로 쓸 수 있는 내용만 짧게 답해.',
  },
  driving: {
    label: '운전',
    hint: '사용자는 지금 운전 중이야. 안전이 최우선이니 한 문장으로만 답하고, 긴 설명이나 화면을 오래 봐야 하는 내용은 "정차 후에 알려드릴게요"라고 미뤄.',
  },
  dev: {
    label: '개발',
    hint: '사용자는 지금 개발 중인 소프트웨어 개발자야. 정확한 용어, 명령어, API 이름을 그대로 쓰고, 코드가 필요하면 한두 줄로 핵심만 보여줘.',
  },
  meeting: {
    label: '회의',
    hint: '사용자는 지금 회의 중이야. 상대방 말을 듣는 중일 수 있으니 핵심 사실이나 숫자만 한 문장으로 답해.',
  },
};

export const isMode = (v: unknown): v is ContextMode => typeof v === 'string' && Object.hasOwn(MODES, v);

/** The companion's `GET /mode` reply, or null when it isn't a valid one. */
export function parseContext(json: unknown): { mode: ContextMode; source: string } | null {
  const j = json as { mode?: unknown; source?: unknown } | null;
  return j && isMode(j.mode) ? { mode: j.mode, source: typeof j.source === 'string' ? j.source : '' } : null;
}
