import { OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { Assistant } from './app';
import { formatTokens } from './core/format';
import { MODES, type ContextMode } from './core/modes';
import { MODELS, type SttMode } from './core/types';
import { connectBridge } from './platform/bridge';
import { looksLikeAnthropicKey, looksLikeOpenAIKey, maskKey, SecretStore } from './platform/secrets';
import { browserKV, evenKV } from './platform/storage';
import { describeError, makeClient, verifyKey } from './services/claude';
import { PreviewSink } from './glasses/previewSink';
import type { AgentSessionInfo } from './services/sessions';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function say(target: HTMLElement, text: string, error = false): void {
  target.textContent = text;
  target.classList.toggle('error', error);
}

async function main(): Promise<void> {
  const bridge = await connectBridge();
  const kv = bridge ? evenKV(bridge) : browserKV();
  const secrets = new SecretStore(kv);
  const app = new Assistant({ bridge, kv, secrets });
  app.addSink(new PreviewSink($<HTMLCanvasElement>('mirror')));
  await app.init();

  // ------------------------------------------------------------ mirror controls (same gestures as the glasses)
  const ptt = $<HTMLButtonElement>('ptt');
  let holding = false;
  const press = (e: Event) => {
    e.preventDefault();
    if (holding) return;
    holding = true;
    ptt.classList.add('active');
    app.handleInput(OsEventTypeList.LONG_PRESS_EVENT);
  };
  const release = () => {
    if (!holding) return;
    holding = false;
    ptt.classList.remove('active');
    app.handleInput(OsEventTypeList.LONG_PRESS_RELEASE_EVENT);
  };
  ptt.addEventListener('pointerdown', press);
  ptt.addEventListener('pointerup', release);
  ptt.addEventListener('pointerleave', release);
  ptt.addEventListener('pointercancel', release);
  ptt.addEventListener('contextmenu', (e) => e.preventDefault());
  $('page-next').onclick = () => app.handleInput(OsEventTypeList.CLICK_EVENT);
  $('stop').onclick = () => {
    if (app.stage === 'listening' || app.stage === 'answering') app.handleInput(OsEventTypeList.DOUBLE_CLICK_EVENT);
  };

  $<HTMLFormElement>('ask-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $<HTMLInputElement>('ask-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void app.ask(text);
  };

  // ------------------------------------------------------------ Claude key
  const keyInput = $<HTMLInputElement>('key-input');
  const keyMessage = $('key-message');
  const showKeyState = async () => {
    const key = await secrets.get('anthropic');
    $('key-state').textContent = key ? `등록됨 (${maskKey(key)})` : '미등록';
    $('pill-key').className = `pill ${key ? 'ok' : 'bad'}`;
    if (!secrets.persistent) say(keyMessage, '이 화면은 암호화 저장을 지원하지 않아, 키는 앱을 닫으면 지워집니다.', true);
  };
  $<HTMLFormElement>('key-form').onsubmit = async (e) => {
    e.preventDefault();
    const key = keyInput.value.trim();
    if (!looksLikeAnthropicKey(key)) return say(keyMessage, 'Claude API 키는 sk-ant- 로 시작해요.', true);
    say(keyMessage, '키 확인 중…');
    try {
      await verifyKey(makeClient(key));
    } catch (err) {
      return say(keyMessage, `저장하지 않았어요: ${describeError(err)}`, true);
    }
    await secrets.set('anthropic', key);
    keyInput.value = '';
    say(keyMessage, '확인하고 저장했어요.');
    await showKeyState();
    await app.keyChanged();
  };
  $('key-delete').onclick = async () => {
    if (!confirm('이 휴대폰에 저장된 Claude API 키를 삭제할까요?')) return;
    await secrets.remove('anthropic');
    say(keyMessage, '삭제했어요.');
    await showKeyState();
    await app.keyChanged();
  };

  // ------------------------------------------------------------ speech recognition
  const sttMode = $<HTMLSelectElement>('stt-mode');
  sttMode.value = app.settings.stt;
  sttMode.onchange = () => void app.saveSettings({ stt: sttMode.value as SttMode });
  const sttModel = $<HTMLInputElement>('stt-model');
  sttModel.value = app.settings.sttModel;
  sttModel.onchange = () => sttModel.value.trim() && void app.saveSettings({ sttModel: sttModel.value.trim() });
  const openaiInput = $<HTMLInputElement>('openai-input');
  const showOpenAIState = async () => {
    const key = await secrets.get('openai');
    $('openai-state').textContent = key ? `OpenAI 키 등록됨 (${maskKey(key)})` : 'OpenAI 키 미등록';
  };
  $<HTMLFormElement>('openai-form').onsubmit = async (e) => {
    e.preventDefault();
    const key = openaiInput.value.trim();
    if (!looksLikeOpenAIKey(key)) return say($('notice'), 'OpenAI 키는 sk- 로 시작해요.', true);
    await secrets.set('openai', key);
    openaiInput.value = '';
    await showOpenAIState();
  };
  $('openai-delete').onclick = async () => {
    await secrets.remove('openai');
    await showOpenAIState();
  };

  // ------------------------------------------------------------ model & tokens
  const model = $<HTMLSelectElement>('model');
  for (const m of MODELS) model.append(el('option', { value: m.id, textContent: m.label }));
  model.value = app.settings.model;
  model.onchange = () => void app.saveSettings({ model: model.value });
  const budget = $<HTMLInputElement>('budget');
  budget.value = String(app.settings.monthlyBudget);
  budget.onchange = () => void app.saveSettings({ monthlyBudget: Math.max(0, Math.floor(Number(budget.value) || 0)) });
  $('usage-reset').onclick = () => confirm('이번 달 토큰 사용량 기록을 초기화할까요?') && void app.resetUsage();

  // ------------------------------------------------------------ situation mode
  const modeSelect = $<HTMLSelectElement>('mode');
  for (const [id, m] of Object.entries(MODES)) modeSelect.append(el('option', { value: id, textContent: `${m.label} (고정)` }));
  modeSelect.value = app.settings.mode;
  modeSelect.onchange = () => void app.saveSettings({ mode: modeSelect.value as ContextMode | 'auto' });

  // ------------------------------------------------------------ sessions
  let agents: AgentSessionInfo[] = [];
  $('session-new').onclick = async () => {
    await app.sessions.create();
    app.render();
  };
  $('agent-load').onclick = async () => {
    say($('agent-message'), '불러오는 중…');
    try {
      agents = await app.listAgentSessions();
      say($('agent-message'), agents.length ? '' : '진행 중인 에이전트 세션이 없어요.');
    } catch (err) {
      say($('agent-message'), `불러오지 못했어요: ${describeError(err)}`, true);
    }
    app.render();
  };

  const renderSessions = () => {
    const active = app.sessions.active;
    const current =
      active.kind === 'agent' ? `에이전트 · ${active.title}` : (app.sessions.current()?.title ?? '새 대화');
    $('active-session').textContent = current;

    const list = $('session-list');
    list.replaceChildren(
      ...app.sessions.sessions.map((s) => {
        const isCurrent = active.kind === 'local' && active.id === s.id;
        const pick = el('button', { type: 'button', textContent: isCurrent ? '사용 중' : '선택', disabled: isCurrent });
        pick.onclick = async () => {
          await app.sessions.select({ kind: 'local', id: s.id });
          app.render();
        };
        const del = el('button', { type: 'button', className: 'danger', textContent: '삭제' });
        del.onclick = async () => {
          if (!confirm(`"${s.title}" 대화를 삭제할까요?`)) return;
          await app.sessions.remove(s.id);
          app.render();
        };
        return el(
          'li',
          { className: isCurrent ? 'current' : '' },
          el('span', { className: 'title', textContent: s.title }),
          el('small', { textContent: `${Math.ceil(s.turns.length / 2)}턴` }),
          pick,
          del,
        );
      }),
    );

    $('agent-list').replaceChildren(
      ...agents.map((a) => {
        const isCurrent = active.kind === 'agent' && active.id === a.id;
        const pick = el('button', { type: 'button', textContent: isCurrent ? '사용 중' : '선택', disabled: isCurrent });
        pick.onclick = async () => {
          await app.sessions.select({ kind: 'agent', id: a.id, title: a.title });
          app.render();
        };
        return el(
          'li',
          { className: isCurrent ? 'current' : '' },
          el('span', { className: 'title', textContent: `🤖 ${a.title}` }),
          el('small', { textContent: a.status }),
          pick,
        );
      }),
    );

    const s = app.sessions.current();
    $('transcript').replaceChildren(
      ...(s?.turns ?? []).map((t) => el('li', { className: t.role, textContent: t.text })),
    );
  };

  // ------------------------------------------------------------ live state
  let lastSessionsKey = '';
  app.onChange(() => {
    const g = $('pill-glasses');
    if (!bridge) {
      g.textContent = '미리보기';
      g.className = 'pill';
    } else {
      g.textContent = app.device.connected ? `안경 ${app.device.battery ?? '--'}%` : '안경 연결 안 됨';
      g.className = `pill ${app.device.connected ? 'ok' : 'bad'}`;
    }
    ptt.classList.toggle('active', app.stage === 'listening');
    $('companion-state').textContent = app.companion ? `연결됨 · 지금 ${MODES[app.mode].label}` : `연결 안 됨 — ${app.companionError}`;
    say($('notice'), app.notice, !!app.notice);
    const u = app.usage;
    $('usage').textContent =
      `이번 달(${u.month}): 입력 ${formatTokens(u.input)} · 출력 ${formatTokens(u.output)} · ${u.requests}회` +
      (app.settings.monthlyBudget ? ` · 남은 예산 ${formatTokens(Math.max(0, app.settings.monthlyBudget - app.usedTokens()))}` : '');
    // Session lists only change on user actions or finished answers; skip rebuilding them every tick.
    const key = JSON.stringify([app.sessions.active, app.sessions.sessions.map((s) => [s.id, s.turns.length, s.title]), agents.length, app.stage]);
    if (key !== lastSessionsKey) {
      lastSessionsKey = key;
      renderSessions();
    }
  });

  await showKeyState();
  await showOpenAIState();
  app.render();
}

void main().catch((e) => {
  console.error(e);
  document.body.prepend(Object.assign(document.createElement('p'), { className: 'message error', textContent: `시작 실패: ${e}` }));
});
