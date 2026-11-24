import type Anthropic from '@anthropic-ai/sdk';
import {
  AppLocationAccuracy,
  DeviceConnectType,
  OsEventTypeList,
  type DeviceStatus,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import { mediaLine, statusLine } from './core/format';
import { MODES, type ContextMode, type Health, type Media } from './core/modes';
import { addFix, dashboard, emptyTrack, REST_MS, splitNotice, type Dash, type Track } from './core/dashboard';
import { isParkingQuestion, parkingAnswer, type Parking } from './core/parking';
import { replyPages } from './core/reply';
import { DEFAULT_SETTINGS, type DeviceState, type Settings, type TempRange } from './core/types';
import { addUsage, emptyUsage, parseUsage, rollUsage, totalTokens, type UsageState } from './core/usage';
import { GlassesSink } from './glasses/glassesSink';
import { POPUP, SCREEN } from './glasses/layout';
import { Renderer, type Sink } from './glasses/renderer';
import type { KV } from './platform/storage';
import { askClaude, describeError, makeClient } from './services/claude';
import {
  agentNeedsAction,
  askAgent,
  appendTurn,
  finishedSessions,
  listAgentSessions,
  SessionStore,
  type AgentSessionInfo,
} from './services/sessions';
import { GlassesMicRecognizer, SttUnavailableError } from './services/stt';
import { DEFAULT_LOCATION, fetchTodayRange, type GeoPoint } from './services/weather';
import { fetchContext, transcribe } from './services/context';
import { smartThingsTools } from './services/smartthings';
import { fetchLyrics, lineAt, searchTerms, type LyricLine } from './services/lyrics';
import { ellipsize } from './core/textlayout';

type Stage = 'idle' | 'listening' | 'transcribing' | 'answering';

const TICK_MS = 1000;
const WEATHER_TTL = 30 * 60_000;
const MAX_LISTEN_MS = 60_000;
const CONTEXT_POLL_MS = 5000;
const AGENT_POLL_MS = 30_000;
const REMIND_BEFORE_MS = 10 * 60_000;
const NO_KEY = 'G2 Context 앱에서 Claude API 키를 등록하고, 이 화면 설정에 연결 코드를 넣어 주세요.';
/** How long the conversation popup stays open after the last answer or message. */
const ANSWER_HOLD_MS = 20_000;
// Driving has the Drive HUD's own location tracking; two users of the same GPS stream would fight.
const GPS_MODES = new Set<ContextMode>(['running']);
/** Text width of the Drive HUD's now-playing box (src/drive/hud/layout.ts, 'media'). */
const HUD_MEDIA_WIDTH = 360;
/** Lyrics appear this much before they are sung, to make singing along easier. */
export const LYRIC_LEAD_MS = 100;
/** The host may deliver one touch as both a text and a sys event: drop repeats this close together. */
const DEDUPE_MS = 150;

/** The embedded Drive HUD (src/drive), which owns the glasses while driving. */
export interface DriveSide {
  /** `onExit`: the wearer left the HUD (double tap or its "운전 모드 끝내기" menu). */
  startDriving(onExit: () => void): void;
  stopDriving(): void;
  /** What's playing and the current lyric for the HUD's top-left (two lines, or ''). */
  setMedia(text: string): void;
}

export interface AppDeps {
  bridge: EvenAppBridge | null;
  kv: KV;
  drive?: DriveSide;
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
  /** Next calendar event (from G2 Context), and the one already reminded of. */
  nextEvent: { title: string; start: number } | undefined;
  /** Samsung Health values from G2 Context. */
  health: Health | undefined;
  /** SmartThings is signed in on G2 Context, so Claude gets the device tools. */
  smartThings = false;
  private remindedKey = '';
  /** Running: last whole kilometre announced, and when it was reached. */
  private splitKm = 0;
  private splitAt = Date.now();
  /** Where the car was left when the last drive ended. */
  parking: Parking | null = null;
  /** Agent session statuses at the last look, to notice when one finishes. */
  private agentPrev: Map<string, string> | null = null;
  /** The Drive HUD has the glasses. */
  driving = false;
  /** The wearer left the HUD; stay out of it until G2 Context stops saying 운전. */
  private driveSnoozed = false;
  /** The Claude key from G2 Context (needs the pairing code). Memory only. */
  claudeKey: string | undefined;
  /** What's playing on the phone, from the companion (needs the pairing code), and when it was read. */
  media: Media | undefined;
  private mediaAt = 0;
  /** Synced lyrics of the current track (null: none found or still loading), keyed by title|artist. */
  private lyrics: LyricLine[] | null = null;
  private lyricsKey = '';
  /** Fires at the next lyric change: the 1 s tick alone would show lines up to a second late. */
  private lyricTimer: ReturnType<typeof setTimeout> | undefined;
  /** Dashboard state for the current mode. */
  private modeSince = Date.now();
  private track: Track = emptyTrack();
  private sets = 0;
  private restUntil = 0;
  private meetingEnd: number | undefined;
  private gpsOn = false;
  /** When the reply panel last showed something new (an answer, a message, a page turn). */
  private replyAt = 0;

  private glasses: GlassesSink | null = null;
  private glassesMic: GlassesMicRecognizer | null = null;
  private recognizer: GlassesMicRecognizer | null = null;
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
    try {
      this.parking = JSON.parse((await kv.get('parking')) ?? 'null');
    } catch {
      /* none saved */
    }
    await this.sessions.load();
    await this.showWelcome();

    if (bridge) {
      this.glasses = new GlassesSink(bridge);
      this.renderer.addSink(this.glasses);
      this.glassesMic = new GlassesMicRecognizer(bridge, (pcm) => transcribe(pcm, this.settings.companionKey));
      bridge.onEvenHubEvent((e) => this.onGlassesEvent(e));
      bridge.onDeviceStatusChanged((s) => this.onDevice(s));
      bridge.onAppLocationChanged((l) => {
        if (!this.gpsOn) return;
        this.track = addFix(this.track, { lat: l.latitude, lon: l.longitude, accuracy: l.accuracy, speed: l.speed });
        const km = Math.floor(this.track.distance / 1000);
        if (this.mode === 'running' && km > this.splitKm) {
          const now = Date.now();
          this.notify(splitNotice(km, now - this.splitAt, now - this.modeSince, this.track.distance));
          this.splitKm = km;
          this.splitAt = now;
        }
      });
      bridge
        .getDeviceInfo()
        .then((info) => info && this.onDevice(info.status))
        .catch(() => undefined);
    }
    this.render();
    setInterval(() => this.tick(), TICK_MS);
    void this.refreshWeather();
    setInterval(() => void this.refreshWeather(), WEATHER_TTL);
    void this.refreshMode();
    setInterval(() => void this.refreshMode(), CONTEXT_POLL_MS);
    setInterval(() => void this.pollAgents(), AGENT_POLL_MS);
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
    if (patch.companionKey != null) void this.refreshMode();
    this.render();
  }

  /** Follows the G2 Context app: mode, meeting end, what's playing and the Claude key. */
  async refreshMode(): Promise<void> {
    const r = await fetchContext(this.settings.companionKey);
    const ctx = 'error' in r ? null : r;
    this.companion = !!ctx;
    this.companionError = 'error' in r ? r.error : '';
    const next = ctx?.mode ?? 'assistant';
    if (next !== 'driving') this.driveSnoozed = false;
    this.syncDrive(next === 'driving' && !this.driveSnoozed);
    this.meetingEnd = ctx?.end;
    this.nextEvent = ctx?.next;
    this.health = ctx?.health;
    this.smartThings = !!ctx?.smartthings;
    // Kept in memory only; it disappears when G2 Context removes it or stops answering.
    if (ctx?.claudeKey !== this.claudeKey) {
      const hadKey = !!this.claudeKey;
      this.claudeKey = ctx?.claudeKey;
      if (!hadKey && this.claudeKey && this.stage === 'idle') this.closePopup(); // drop the "register a key" message
    }
    this.media = ctx?.media;
    this.mediaAt = Date.now();
    this.loadLyrics();
    // After the key handling above, which closes the popup when the key first arrives.
    this.remindUpcoming();
    if (next === this.mode) return this.render();
    if (this.mode === 'driving') void this.saveParking();
    this.mode = next;
    this.splitKm = 0;
    this.splitAt = Date.now();
    this.modeSince = Date.now();
    this.track = emptyTrack();
    this.sets = 0;
    this.restUntil = 0;
    void this.setGps(GPS_MODES.has(next));
    this.render();
  }

  private loadLyrics(): void {
    const m = this.media;
    const key = m ? `${m.title}|${m.artist ?? ''}` : '';
    if (key === this.lyricsKey) return;
    this.lyricsKey = key;
    this.lyrics = null;
    if (!m) return;
    fetchLyrics(m)
      .then((lines) => {
        if (this.lyricsKey === key) this.lyrics = lines;
      })
      .catch(() => undefined); // no lyrics is fine
  }

  /**
   * "앱 · 제목 - 가수  1:23/3:45" and, when synced lyrics exist, the line being sung. Position advances
   * between polls. `compact` (the HUD's narrow box) drops the app name and tags like "(Official MV)".
   */
  mediaLines(width: number, compact = false): [string, string] {
    const m = this.media;
    if (!m) return ['', ''];
    const pos = (m.pos ?? 0) + (Date.now() - this.mediaAt);
    const lyric = this.lyrics ? lineAt(this.lyrics, pos + LYRIC_LEAD_MS) : '';
    const shown = compact ? { ...m, title: searchTerms(m).track, app: undefined } : m;
    return [mediaLine({ ...shown, pos: m.pos != null ? pos : undefined }, width), lyric ? ellipsize(lyric, width) : ''];
  }

  /** Re-renders exactly when the next lyric line is due (minus the lead), if that's before the next tick. */
  private scheduleLyric(): void {
    clearTimeout(this.lyricTimer);
    const m = this.media;
    if (!m || m.pos == null || !this.lyrics) return;
    const pos = m.pos + (Date.now() - this.mediaAt) + LYRIC_LEAD_MS;
    const next = this.lyrics.find((l) => l.t > pos);
    if (next && next.t - pos < TICK_MS) this.lyricTimer = setTimeout(() => this.render(), next.t - pos + 5);
  }

  /**
   * A short popup for things that happen on their own (a reminder, a split, a finished agent).
   * Not while the HUD has the glasses or a conversation is going. Returns whether it was shown.
   */
  private notify(text: string): boolean {
    if (this.driving || this.stage !== 'idle') return false;
    this.resetReply(text);
    this.render();
    return true;
  }

  /** Pops up the next event once, 10 minutes before it starts. */
  private remindUpcoming(): void {
    const n = this.nextEvent;
    if (!n) return;
    const left = n.start - Date.now();
    const key = `${n.title}|${n.start}`;
    if (left <= 0 || left > REMIND_BEFORE_MS || key === this.remindedKey) return;
    const at = new Date(n.start);
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    if (this.notify(`${Math.ceil(left / 60_000)}분 후 일정: ${n.title} (${clock})`)) this.remindedKey = key;
  }

  /** Where the car is: saved when a drive ends. */
  private async saveParking(): Promise<void> {
    const loc = await this.deps.bridge
      ?.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: 10_000 })
      .catch(() => null);
    if (!loc) return;
    this.parking = { lat: loc.latitude, lon: loc.longitude, at: Date.now() };
    await this.deps.kv.set('parking', JSON.stringify(this.parking));
    this.notify('주차 위치를 저장했어요. "차 어디 있어?"라고 물어보세요.');
  }

  /** Answers "차 어디 있어?" from the saved spot, without asking Claude. */
  private async answerParking(q: string): Promise<void> {
    this.stage = 'answering';
    this.question = q;
    this.answer = '위치 확인 중…';
    this.layoutReply(false);
    this.render();
    const loc = this.parking
      ? await this.deps.bridge?.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: 8000 }).catch(() => null)
      : null;
    this.answer = parkingAnswer(this.parking, loc ? { lat: loc.latitude, lon: loc.longitude } : null, Date.now());
    this.stage = 'idle';
    this.layoutReply(false);
    this.render();
  }

  /** Tells the wearer when a Claude agent session finishes or stops to wait for an approval. */
  private async pollAgents(): Promise<void> {
    const c = await this.client();
    if (!c) return;
    let list: AgentSessionInfo[];
    try {
      list = await listAgentSessions(c);
    } catch {
      return; // no Managed Agents on this key, or offline
    }
    const done = finishedSessions(this.agentPrev, list);
    this.agentPrev = new Map(list.map((s) => [s.id, s.status]));
    for (const id of done) {
      const s = list.find((x) => x.id === id)!;
      const needs = await agentNeedsAction(c, id).catch(() => false);
      this.notify(`${needs ? '에이전트 승인 필요' : '에이전트 작업 완료'}: ${s.title}`);
    }
  }

  /** Hands the glasses to the Drive HUD and back. No conversation while driving. */
  private syncDrive(on: boolean): void {
    const { drive } = this.deps;
    if (!drive || on === this.driving) return;
    this.driving = on;
    if (on) {
      if (this.stage === 'listening') this.cancelListening();
      else if (this.stage === 'answering') this.abort?.abort();
      this.glasses?.pause();
      drive.startDriving(() => {
        this.driveSnoozed = true;
        this.syncDrive(false);
      });
    } else {
      drive.stopDriving();
      this.glasses?.resume();
      this.renderer.relayout();
    }
    this.render();
  }

  private async setGps(on: boolean): Promise<void> {
    const { bridge } = this.deps;
    if (!bridge || on === this.gpsOn) return;
    this.gpsOn = on;
    try {
      if (on) await bridge.startAppLocationUpdates({ accuracy: AppLocationAccuracy.High, intervalMs: 2000 });
      else await bridge.stopAppLocationUpdates();
    } catch (e) {
      console.warn('[gps]', e);
    }
  }

  /** The conversation popup is open while talking, and for a while after the last answer or message. */
  popupOpen(): boolean {
    return this.stage !== 'idle' || Date.now() - this.replyAt < ANSWER_HOLD_MS;
  }

  private closePopup(): void {
    this.replyAt = 0;
    this.render();
  }

  /** The mode's dashboard, the screen under the popup. */
  private dashboardView(): Dash | null {
    return dashboard(
      {
        mode: this.mode,
        since: this.modeSince,
        track: this.track,
        sets: this.sets,
        restUntil: this.restUntil,
        meetingEnd: this.meetingEnd,
        next: this.nextEvent,
        targetPace: this.settings.targetPace,
        health: this.health,
      },
      Date.now(),
    );
  }

  async resetUsage(): Promise<void> {
    this.usage = emptyUsage(new Date());
    await this.deps.kv.set('usage', JSON.stringify(this.usage));
    this.render();
  }

  usedTokens(): number {
    return totalTokens(rollUsage(this.usage, new Date()));
  }

  async client(): Promise<Anthropic | null> {
    const key = this.claudeKey;
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
    if (!c) throw new Error(NO_KEY);
    return listAgentSessions(c);
  }

  // ---------------------------------------------------------------- glasses input

  private onGlassesEvent(e: EvenHubEvent): void {
    if (this.driving) return; // the Drive HUD handles the glasses' input while it has them
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
    if (this.driving) return;
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
        else if (this.stage !== 'idle') break;
        // Popup: next page, and close after the last one.
        else if (this.popupOpen()) {
          if (this.page < this.pages.length - 1) this.turnPage(1);
          else this.closePopup();
        } else if (this.mode === 'workout') {
          this.sets++;
          this.restUntil = Date.now() + REST_MS;
          this.render();
        } else if (this.question) {
          this.replyAt = Date.now(); // reopen the last answer
          this.render();
        }
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (this.popupOpen()) this.turnPage(1);
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (this.popupOpen()) this.turnPage(-1);
        break;
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        if (this.stage === 'listening') this.cancelListening();
        else if (this.stage === 'answering') this.abort?.abort();
        else if (this.popupOpen()) this.closePopup();
        else this.glasses?.exit();
        break;
      case OsEventTypeList.FOREGROUND_ENTER_EVENT:
        this.renderer.redraw();
        break;
    }
  }

  private turnPage(delta: number): void {
    const p = Math.max(0, Math.min(this.pages.length - 1, this.page + delta));
    if (p === this.page) return;
    this.page = p;
    this.replyAt = Date.now();
    this.render();
  }

  // ---------------------------------------------------------------- talking

  async startListening(): Promise<void> {
    if (this.stage !== 'idle') return;
    if (!this.claudeKey) return this.fail(NO_KEY);
    if (!this.glassesMic) return this.fail('안경을 길게 눌러 말할 수 있어요. 휴대폰에서는 글로 물어보세요.');
    this.recognizer = this.glassesMic;
    await this.glasses?.ready;
    this.stage = 'listening';
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
    this.closePopup();
    this.render();
  }

  /** Sends a question (spoken on the glasses or typed on the phone) to the active session. */
  async ask(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.stage !== 'idle') return;
    if (isParkingQuestion(q)) return this.answerParking(q);
    const client = await this.client();
    if (!client) return this.fail('휴대폰 화면에서 Claude API 키를 먼저 등록해 주세요.');
    this.stage = 'answering';
    this.question = q;
    this.answer = '';
    this.layoutReply(false);
    this.render();
    this.abort = new AbortController();
    const onText = (delta: string) => {
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
        const tools = this.smartThings ? smartThingsTools(this.settings.companionKey) : [];
        const r = await askClaude(client, this.settings.model, s.turns, onText, this.abort.signal, MODES[this.mode].hint, tools);
        this.usage = addUsage(this.usage, r.usage, new Date());
        void this.deps.kv.set('usage', JSON.stringify(this.usage));
        this.answer = r.refused ? '그 요청에는 답할 수 없어요.' : r.text || '(빈 응답)';
        await this.sessions.update(appendTurn(this.sessions.current() ?? s, { role: 'assistant', text: this.answer }));
      }
      this.notice = '';
    } catch (e) {
      this.notice = describeError(e);
      this.answer = this.answer ? `${this.answer}\n\n(${this.notice})` : this.notice;
    } finally {
      this.abort = null;
      this.stage = 'idle';
      this.layoutReply(false);
      this.render();
    }
  }

  // ---------------------------------------------------------------- screen

  private fail(message: string): void {
    this.notice = message;
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
    this.pages = replyPages(this.question, this.answer, POPUP.textWidth, POPUP.lines);
    this.page = follow ? this.pages.length - 1 : 0;
    this.replyAt = Date.now();
  }

  /** Opens the popup with setup help until the Claude key is entered. */
  private async showWelcome(): Promise<void> {
    // The key arrives with the first G2 Context poll; give it a moment before asking for it.
    await this.refreshMode();
    if (!this.claudeKey) this.resetReply(NO_KEY);
  }

  private tick(): void {
    this.render();
  }

  render(): void {
    const dash = this.dashboardView();
    const popup = this.popupOpen();
    const [mediaLine1, lyric] = this.mediaLines(SCREEN.w - 16);
    if (this.driving) this.deps.drive?.setMedia(this.mediaLines(HUD_MEDIA_WIDTH, true).filter(Boolean).join('\n'));
    this.renderer.render({
      status: statusLine({
        mode: MODES[this.mode].label,
        device: this.device,
        temp: this.temp,
        now: new Date(),
        used: this.usedTokens(),
        budget: this.settings.monthlyBudget,
      }),
      // The popup covers the lyric line, and the glasses would show both through each other.
      media: popup ? mediaLine1 : [mediaLine1, lyric].filter(Boolean).join('\n'),
      // Under an open popup nothing is drawn: the glasses add light, so anything behind would show through.
      hero: popup || !dash?.big ? null : { big: dash.big, caption: dash.caption, progress: dash.progress },
      detail: popup || !dash ? '' : dash.detail,
      popup: popup ? (this.pages[this.page] ?? '') : null,
    });
    this.scheduleLyric();
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
