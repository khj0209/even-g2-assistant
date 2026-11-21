import type Anthropic from '@anthropic-ai/sdk';
import type { KV } from '../platform/storage';
import type { ChatTurn } from './claude';

/** A conversation kept on this phone and sent to the Messages API. */
export interface LocalSession {
  id: string;
  title: string;
  updatedAt: number;
  turns: ChatTurn[];
}

/** A Claude Managed Agents session on the account (the cloud agent sessions the API key can reach). */
export interface AgentSessionInfo {
  id: string;
  title: string;
  agentName: string;
  status: string;
  updatedAt: string;
}

export type ActiveSession = { kind: 'local'; id: string } | { kind: 'agent'; id: string; title: string };

const MAX_SESSIONS = 30;
/** Turns sent as context (and stored) per local session. */
export const MAX_TURNS = 40;

export function newSession(now = Date.now()): LocalSession {
  return { id: `l_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`, title: '새 대화', updatedAt: now, turns: [] };
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 24 ? `${t.slice(0, 24)}…` : t || '새 대화';
}

/** Appends a turn, naming the session after its first question and trimming old turns. */
export function appendTurn(s: LocalSession, turn: ChatTurn, now = Date.now()): LocalSession {
  let turns = [...s.turns, turn];
  if (turns.length > MAX_TURNS) {
    turns = turns.slice(-MAX_TURNS);
    // The Messages API needs the conversation to start with a user turn.
    while (turns.length && turns[0].role !== 'user') turns.shift();
  }
  const title = s.turns.length === 0 && turn.role === 'user' ? titleFrom(turn.text) : s.title;
  return { ...s, title, turns, updatedAt: now };
}

export class SessionStore {
  sessions: LocalSession[] = [];
  active: ActiveSession = { kind: 'local', id: '' };

  constructor(private kv: KV) {}

  async load(): Promise<void> {
    try {
      const raw = await this.kv.get('sessions');
      const list = raw ? (JSON.parse(raw) as LocalSession[]) : [];
      this.sessions = Array.isArray(list) ? list.filter((s) => s && s.id && Array.isArray(s.turns)) : [];
    } catch {
      this.sessions = [];
    }
    try {
      const a = JSON.parse((await this.kv.get('active')) ?? 'null') as ActiveSession | null;
      if (a && (a.kind === 'agent' || this.sessions.some((s) => s.id === a.id))) this.active = a;
    } catch {
      /* ignore */
    }
    if (this.active.kind === 'local' && !this.sessions.some((s) => s.id === this.active.id)) {
      const s = this.sessions[0] ?? newSession();
      if (!this.sessions.length) this.sessions.push(s);
      this.active = { kind: 'local', id: s.id };
    }
  }

  current(): LocalSession | null {
    const a = this.active;
    return a.kind === 'local' ? (this.sessions.find((s) => s.id === a.id) ?? null) : null;
  }

  async update(s: LocalSession): Promise<void> {
    this.sessions = [s, ...this.sessions.filter((x) => x.id !== s.id)].slice(0, MAX_SESSIONS);
    await this.save();
  }

  async create(): Promise<LocalSession> {
    const s = newSession();
    this.sessions.unshift(s);
    this.active = { kind: 'local', id: s.id };
    await this.save();
    return s;
  }

  async select(a: ActiveSession): Promise<void> {
    this.active = a;
    await this.save();
  }

  async remove(id: string): Promise<void> {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.active.kind === 'local' && this.active.id === id) {
      const next = this.sessions[0] ?? newSession();
      if (!this.sessions.length) this.sessions.push(next);
      this.active = { kind: 'local', id: next.id };
    }
    await this.save();
  }

  private async save(): Promise<void> {
    await this.kv.set('sessions', JSON.stringify(this.sessions));
    await this.kv.set('active', JSON.stringify(this.active));
  }
}

export async function listAgentSessions(client: Anthropic): Promise<AgentSessionInfo[]> {
  const page = await client.beta.sessions.list({ limit: 20, order: 'desc' });
  return page.data
    .filter((s) => !s.archived_at && s.status !== 'terminated')
    .map((s) => ({
      id: s.id,
      title: s.title || s.agent.name || s.id,
      agentName: s.agent.name,
      status: s.status,
      updatedAt: s.updated_at,
    }));
}

export interface AgentReply {
  text: string;
  /** Set when the turn ended waiting for something only the phone can give (e.g. a tool approval). */
  needsAction: boolean;
}

/** Sends one message to a Managed Agents session and streams its reply until it goes idle. */
export async function askAgent(
  client: Anthropic,
  sessionId: string,
  text: string,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<AgentReply> {
  // Stream first, then send, so no event of this turn is missed.
  const stream = await client.beta.sessions.events.stream(sessionId, undefined, { signal });
  await client.beta.sessions.events.send(
    sessionId,
    { events: [{ type: 'user.message', content: [{ type: 'text', text }] }] },
    { signal },
  );
  let out = '';
  let started = false;
  for await (const event of stream) {
    switch (event.type) {
      case 'user.message':
        started = true;
        break;
      case 'agent.message':
        for (const block of event.content) {
          if (block.type !== 'text') continue;
          const piece = (out ? '\n' : '') + block.text;
          out += piece;
          onText(piece);
        }
        break;
      case 'session.status_idle':
        // An idle left over from before our message arrived doesn't end this turn.
        if (!started && !out) break;
        return { text: out.trim(), needsAction: event.stop_reason.type === 'requires_action' };
      case 'session.status_terminated':
        return { text: out.trim() || '세션이 종료되었어요.', needsAction: false };
      case 'session.error':
        throw new Error('에이전트 세션에서 오류가 발생했어요.');
    }
  }
  return { text: out.trim(), needsAction: false };
}
