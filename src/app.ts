import type Anthropic from '@anthropic-ai/sdk';
import {
  AppLocationAccuracy,
  DeviceConnectType,
  OsEventTypeList,
  type DeviceStatus,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { statusLine } from './core/format';
import { MODES, type ContextMode } from './core/modes';
import { replyPages } from './core/reply';
import { DEFAULT_SETTINGS, type DeviceState, type Mood, type Settings, type TempRange } from './core/types';
import { addUsage, emptyUsage, parseUsage, rollUsage, totalTokens, type UsageState } from './core/usage';
import { GlassesSink } from './glasses/glassesSink';
import { REPLY } from './glasses/layout';
import { Renderer, type Sink } from './glasses/renderer';
import type { SecretStore } from './platform/secrets';
import type { KV } from './platform/storage';
import { askClaude, describeError, makeClient, PET_NAME } from './services/claude';
import { askAgent, appendTurn, listAgentSessions, SessionStore, type AgentSessionInfo } from './services/sessions';
import {
  chooseStt,
  GlassesMicRecognizer,
  PhoneSpeechRecognizer,
  phoneSpeechSupported,
  SttUnavailableError,
  type Recognizer,
} from './services/stt';
import { DEFAULT_LOCATION, fetchTodayRange, type GeoPoint } from './services/weather';
import { fetchContext } from './services/context';

type Stage = 'idle' | 'listening' | 'transcribing' | 'answering';

const TICK_MS = 450;
const WEATHER_TTL = 30 * 60_000;
const MAX_LISTEN_MS = 60_000;
const CONTEXT_POLL_MS = 5000;
/** The host may deliver one touch as both a text and a sys event: drop repeats this close together. */
const DEDUPE_MS = 150;

export interface AppDeps {
  bridge: EvenAppBridge | null;
  kv: KV;
  secrets: SecretStore;
}

/** Everything the assistant does, shared by the glasses and the phone screen. */
export class Assistant {
  settings: Settings = { ...DEFAULT_SETTINGS };
  device: DeviceState = { connected: false, battery: null, charging: false };
  temp: TempRange | null = null;
  usage: UsageState = emptyUsage(new Date());
  readonly sessions: SessionStore;
  readonly renderer = new Renderer();
  stage: Stage = 'idle';
  mood: Mood = 'idle';
  question = '';
  answer = '';
  pages: string[] = [''];
  page = 0;
  /** Last error shown, for the phone screen. */
  notice = '';
  /** Current situation, and whether the Android companion app answered the last poll. */
  mode: ContextMode = 'assistant';
  companion = false;
  /** Why the last poll failed, for the phone screen. */
  companionError = '';

  private frame = 0;
  private moodSince = Date.now();
  private glasses: GlassesSink | null = null;
  private glassesMic: GlassesMicRecognizer | null = null;
  private recognizer: Recognizer | null = null;
  private abort: AbortController | null = null;
  private listenTimer: ReturnType<typeof setTimeout> | null = null;
  private clients = new Map<string, Anthropic>();
  private listeners = new Set<() => void>();
  private lastInput = { key: '', at: 0 };
  /** Whether the touchpad is held right now (a release can arrive while the mic is still starting). */
  private pressed = false;

  constructor(private deps: AppDeps) {
    this.sessions = new SessionStore(deps.kv);
  }

  get bridge(): EvenAppBridge | null {
    return this.deps.bridge;
  }

  async init(): Promise<void> {
    const { kv, bridge } = this.deps;
    try {
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse((await kv.get('settings')) ?? '{}') };
    } catch {
      /* keep defaults */
    }
    this.usage = parseUsage(await kv.get('usage'), new Date());
    await this.sessions.load();
    this.resetReply(await this.welcome());

    if (bridge) {
      this.glasses = new GlassesSink(bridge);
      this.renderer.addSink(this.glasses);
      this.glassesMic = new GlassesMicRecognizer(bridge, () => this.deps.secrets.get('openai'), this.settings.sttModel);
      bridge.onEvenHubEvent((e) => this.onGlassesEvent(e));
      bridge.onDeviceStatusChanged((s) => this.onDevice(s));
      bridge
        .getDeviceInfo()
        .then((info) => info && this.onDevice(info.status))
        .catch(() => undefined);
    }
    this.renderer.start();
    this.render();
    setInterval(() => this.tick(), TICK_MS);
    void this.refreshWeather();
    setInterval(() => void this.refreshWeather(), WEATHER_TTL);
    void this.refreshMode();
    setInterval(() => void this.refreshMode(), CONTEXT_POLL_MS);
  }

  addSink(sink: Sink): void {
    this.renderer.addSink(sink);
  }

  /** Called whenever something the phone screen shows has changed. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ---------------------------------------------------------------- settings & usage

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.deps.kv.set('settings', JSON.stringify(this.settings));
    if (patch.mode) void this.refreshMode();
    if (this.deps.bridge && patch.sttModel) {
      this.glassesMic = new GlassesMicRecognizer(this.deps.bridge, () => this.deps.secrets.get('openai'), this.settings.sttModel);
    }
    this.render();
  }

  /** Follows the companion app (setting 'auto') or the mode fixed on the phone. */
  async refreshMode(): Promise<void> {
    const r = await fetchContext();
    const ctx = 'error' in r ? null : r;
    this.companion = !!ctx;
    this.companionError = 'error' in r ? r.error : '';
    const fixed = this.settings.mode;
    const next = fixed !== 'auto' ? fixed : (ctx?.mode ?? 'assistant');
    if (next === this.mode) return this.render();
    this.mode = next;
    if (this.stage === 'idle') {
      this.setMood('happy');
      this.resetReply(`${MODES[next].label} 모드로 바꿨어요.`);
    }
    this.render();
  }

  async resetUsage(): Promise<void> {
    this.usage = emptyUsage(new Date());
    await this.deps.kv.set('usage', JSON.stringify(this.usage));
    this.render();
  }

  usedTokens(): number {
    return totalTokens(rollUsage(this.usage, new Date()));
  }

  /** Called by the phone after the Claude key changed. */
  async keyChanged(): Promise<void> {
    this.clients.clear();
    if (this.stage === 'idle') this.resetReply(await this.welcome());
    this.render();
  }

  async client(): Promise<Anthropic | null> {
    const key = await this.deps.secrets.get('anthropic');
    if (!key) return null;
    let c = this.clients.get(key);
    if (!c) {
      this.clients.clear();
      c = makeClient(key);
      this.clients.set(key, c);
    }
    return c;
  }

  async listAgentSessions(): Promise<AgentSessionInfo[]> {
    const c = await this.client();
    if (!c) throw new Error('먼저 Claude API 키를 등록해 주세요.');
    return listAgentSessions(c);
  }

  // ---------------------------------------------------------------- glasses input

  private onGlassesEvent(e: EvenHubEvent): void {
    if (e.audioEvent) {
      this.glassesMic?.feed(e.audioEvent.audioPcm);
      return;
    }
    const ev = e.textEvent ?? e.sysEvent ?? e.listEvent;
    if (!ev) return;
    // The host omits zero-valued fields, so a missing eventType means CLICK_EVENT (0).
    const type = ev.eventType ?? OsEventTypeList.CLICK_EVENT;
    const now = Date.now();
    const key = String(type);
    if (key === this.lastInput.key && now - this.lastInput.at < DEDUPE_MS) return;
    this.lastInput = { key, at: now };
    this.handleInput(type);
  }

  /** Touchpad gestures: hold to talk, tap/scroll to page, double tap to cancel or exit. */
  handleInput(type: OsEventTypeList): void {
    switch (type) {
      case OsEventTypeList.LONG_PRESS_EVENT:
        this.pressed = true;
        void this.startListening();
        break;
      case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
        this.pressed = false;
        void this.stopListening();
        break;
      case OsEventTypeList.CLICK_EVENT:
        if (this.stage === 'listening') void this.stopListening();
        else if (this.stage === 'idle') this.turnPage(1, true);
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        this.turnPage(1, false);
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        this.turnPage(-1, false);
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        if (this.stage === 'listening') this.cancelListening();
        else if (this.stage === 'answering') this.abort?.abort();
        else this.glasses?.exit();
        break;
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        this.renderer.redraw();
        break;
    }
  }

  private turnPage(delta: number, wrap: boolean): void {
    if (this.pages.length < 2) return;
    let p = this.page + delta;
    if (wrap) p = (p + this.pages.length) % this.pages.length;
    p = Math.max(0, Math.min(this.pages.length - 1, p));
    if (p === this.page) return;
    this.page = p;
    this.render();
  }

  // ---------------------------------------------------------------- talking

  async startListening(): Promise<void> {
    if (this.stage !== 'idle') return;
    const hasKey = !!(await this.deps.secrets.get('anthropic'));
    if (!hasKey) return this.fail('휴대폰 화면에서 Claude API 키를 먼저 등록해 주세요.');
    const choice = chooseStt(this.settings.stt, {
      hasGlassesMic: !!this.glassesMic,
      hasOpenAIKey: !!(await this.deps.secrets.get('openai')),
      phoneSpeech: phoneSpeechSupported(),
    });
    if (choice.kind === 'none') return this.fail(choice.reason);
    this.recognizer = choice.kind === 'glasses' ? this.glassesMic! : new PhoneSpeechRecognizer();
    if (choice.kind === 'glasses') await this.glasses?.ready;
    this.stage = 'listening';
    this.setMood('listening');
    this.resetReply('말씀하세요…');
    this.render();
    try {
      await this.recognizer.start((partial) => {
        if (this.stage !== 'listening') return;
        this.resetReply(partial || '말씀하세요…');
        this.render();
      });
      this.listenTimer = setTimeout(() => void this.stopListening(), MAX_LISTEN_MS);
      // Released while the microphone was still starting: finish now instead of listening on.
      if (!this.pressed) void this.stopListening();
    } catch (e) {
      this.stage = 'idle';
      this.recognizer = null;
      this.fail(e instanceof SttUnavailableError ? e.message : `음성 인식을 시작할 수 없어요: ${describeError(e)}`);
    }
  }

  async stopListening(): Promise<void> {
    if (this.stage !== 'listening' || !this.recognizer) return;
    if (this.listenTimer) clearTimeout(this.listenTimer);
    const rec = this.recognizer;
    this.recognizer = null;
    this.stage = 'transcribing';
    this.setMood('thinking');
    this.resetReply('알아듣는 중…');
    this.render();
    let text = '';
    try {
      text = await rec.stop();
    } catch (e) {
      this.stage = 'idle';
      return this.fail(e instanceof SttUnavailableError ? e.message : `음성 인식 실패: ${describeError(e)}`);
    }
    this.stage = 'idle';
    if (!text) {
      this.setMood('idle');
      this.resetReply('잘 못 들었어요. 다시 길게 누르고 말해 주세요.');
      this.render();
      return;
    }
    await this.ask(text);
  }

  cancelListening(): void {
    if (this.listenTimer) clearTimeout(this.listenTimer);
    this.recognizer?.cancel();
    this.recognizer = null;
    this.stage = 'idle';
    this.setMood('idle');
    this.resetReply('취소했어요.');
    this.render();
  }

  /** Sends a question (spoken on the glasses or typed on the phone) to the active session. */
  async ask(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.stage !== 'idle') return;
    const client = await this.client();
    if (!client) return this.fail('휴대폰 화면에서 Claude API 키를 먼저 등록해 주세요.');
    this.stage = 'answering';
    this.question = q;
    this.answer = '';
    this.setMood('thinking');
    this.layoutReply(false);
    this.render();
    this.abort = new AbortController();
    const onText = (delta: string) => {
      if (this.mood !== 'talking') this.setMood('talking');
      this.answer += delta;
      this.layoutReply(true);
      this.render();
    };
    try {
      const active = this.sessions.active;
      if (active.kind === 'agent') {
        const r = await askAgent(client, active.id, q, onText, this.abort.signal);
        this.answer = (r.text || '(응답 없음)') + (r.needsAction ? '\n\n(휴대폰에서 승인이 필요해요)' : '');
      } else {
        let s = this.sessions.current()!;
        s = appendTurn(s, { role: 'user', text: q });
        await this.sessions.update(s);
        const r = await askClaude(client, this.settings.model, s.turns, onText, this.abort.signal, MODES[this.mode].hint);
        this.usage = addUsage(this.usage, r.usage, new Date());
        void this.deps.kv.set('usage', JSON.stringify(this.usage));
        this.answer = r.refused ? '그 요청에는 답할 수 없어요.' : r.text || '(빈 응답)';
        await this.sessions.update(appendTurn(this.sessions.current() ?? s, { role: 'assistant', text: this.answer }));
      }
      this.notice = '';
      this.setMood('happy');
    } catch (e) {
      this.notice = describeError(e);
      this.answer = this.answer ? `${this.answer}\n\n(${this.notice})` : this.notice;
      this.setMood('error');
    } finally {
      this.abort = null;
      this.stage = 'idle';
      this.layoutReply(false);
      this.render();
    }
  }

  // ---------------------------------------------------------------- screen

  private setMood(m: Mood): void {
    this.mood = m;
    this.moodSince = Date.now();
    this.frame = 0;
  }

  private fail(message: string): void {
    this.notice = message;
    this.setMood('error');
    this.resetReply(message);
    this.render();
  }

  private resetReply(text: string): void {
    this.question = '';
    this.answer = text;
    this.layoutReply(false);
  }

  /** Re-paginates; `follow` keeps the newest text in view while it streams in. */
  private layoutReply(follow: boolean): void {
    this.pages = replyPages(this.question, this.answer, REPLY.textWidth, REPLY.lines);
    this.page = follow ? this.pages.length - 1 : 0;
  }

  private async welcome(): Promise<string> {
    if (!(await this.deps.secrets.get('anthropic'))) return `안녕하세요, ${PET_NAME}예요!\n휴대폰 화면에서 Claude API 키를 등록해 주세요.`;
    return `안녕하세요, ${PET_NAME}예요!\n안경을 길게 누른 채 말하고, 손을 떼면 대답할게요.`;
  }

  private tick(): void {
    const age = Date.now() - this.moodSince;
    if ((this.mood === 'happy' && age > 4000) || (this.mood === 'error' && age > 8000)) this.setMood('idle');
    if (this.mood === 'idle') {
      // Blink for one tick every ~5 s.
      this.frame = Math.floor(age / TICK_MS) % 11 === 10 ? 1 : 0;
    } else {
      this.frame++;
    }
    this.render();
  }

  render(): void {
    this.renderer.render({
      status: statusLine({
        mode: MODES[this.mode].label,
        device: this.device,
        temp: this.temp,
        now: new Date(),
        used: this.usedTokens(),
        budget: this.settings.monthlyBudget,
      }),
      mood: this.mood,
      frame: this.frame,
      petName: PET_NAME,
      reply: this.pages[this.page] ?? '',
    });
    for (const cb of this.listeners) cb();
  }

  // ---------------------------------------------------------------- device & weather

  private onDevice(s: DeviceStatus): void {
    this.device = {
      connected: s.connectType === DeviceConnectType.Connected,
      battery: s.batteryLevel ?? null,
      charging: !!s.isCharging,
    };
    this.render();
  }

  private async location(): Promise<GeoPoint> {
    const { bridge } = this.deps;
    if (bridge) {
      try {
        const loc = await bridge.getAppLocation({ accuracy: AppLocationAccuracy.Low, timeoutMs: 8000 });
        if (loc) return { lat: loc.latitude, lon: loc.longitude };
      } catch {
        /* fall back */
      }
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      const p = await new Promise<GeoPoint | null>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          () => resolve(null),
          { timeout: 8000, maximumAge: 30 * 60_000 },
        ),
      );
      if (p) return p;
    }
    return DEFAULT_LOCATION;
  }

  async refreshWeather(): Promise<void> {
    const today = new Date().toDateString();
    try {
      const cached = JSON.parse((await this.deps.kv.get('weather')) ?? 'null') as { day: string; at: number; temp: TempRange } | null;
      if (cached && cached.day === today) {
        this.temp = cached.temp;
        this.render();
        if (Date.now() - cached.at < WEATHER_TTL) return;
      }
      const temp = await fetchTodayRange(await this.location());
      if (!temp) return;
      this.temp = temp;
      await this.deps.kv.set('weather', JSON.stringify({ day: today, at: Date.now(), temp }));
      this.render();
    } catch (e) {
      console.warn('[weather]', e);
    }
  }
}
