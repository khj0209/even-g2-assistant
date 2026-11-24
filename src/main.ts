import { OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { Assistant } from './app';
import { formatTokens } from './core/format';
import { MODES } from './core/modes';
import { MODELS } from './core/types';
import { connectBridge } from './platform/bridge';
import { maskKey } from './platform/secrets';
import { browserKV, evenKV } from './platform/storage';
import { describeError } from './services/claude';
import { PreviewSink } from './glasses/previewSink';
import { App as DriveApp } from './drive/app';
import { PreviewSink as DrivePreviewSink } from './drive/hud/preview';
import { initDriveUi } from './drive/ui';
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
  // The Drive HUD (ported from even-g2-HUD) owns the glasses only while G2 Context says 운전.
  const drive = new DriveApp(new DrivePreviewSink($<HTMLCanvasElement>('drive-mirror')));
  initDriveUi(drive);
  drive.start();
  if (bridge) await drive.attachBridge(bridge);
  const app = new Assistant({ bridge, kv, drive });
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

  // ------------------------------------------------------------ model & tokens
  const model = $<HTMLSelectElement>('model');
  for (const m of MODELS) model.append(el('option', { value: m.id, textContent: m.label }));
  model.value = app.settings.model;
  model.onchange = () => void app.saveSettings({ model: model.value });
  const budget = $<HTMLInputElement>('budget');
  budget.value = String(app.settings.monthlyBudget);
  budget.onchange = () => void app.saveSettings({ monthlyBudget: Math.max(0, Math.floor(Number(budget.value) || 0)) });
  $('usage-reset').onclick = () => confirm('이번 달 토큰 사용량 기록을 초기화할까요?') && void app.resetUsage();

  // ------------------------------------------------------------ running target pace ("5:30" ↔ 330 s/km)
  const pace = $<HTMLInputElement>('target-pace');
  const t = app.settings.targetPace;
  pace.value = t ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '';
  pace.onchange = () => {
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(pace.value.trim());
    void app.saveSettings({ targetPace: m ? Number(m[1]) * 60 + Number(m[2]) : 0 });
    if (!m) pace.value = '';
  };

  // ------------------------------------------------------------ G2 Context pairing (the mode itself is chosen in that app)
  const companionKey = $<HTMLInputElement>('companion-key');
  companionKey.value = app.settings.companionKey;
  companionKey.onchange = () => void app.saveSettings({ companionKey: companionKey.value.trim().toUpperCase() });

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
    $('now-mode').textContent = MODES[app.mode].label;
    $('mirror').hidden = app.driving;
    $('parking-state').textContent = app.parking
      ? `주차 위치 저장됨 (${new Date(app.parking.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}) — 안경에 "차 어디 있어?"`
      : '';
    $('drive-mirror').hidden = !app.driving;
    $('companion-state').textContent = app.companion ? 'G2 Context 연결됨' : `G2 Context 연결 안 됨 — ${app.companionError}`;
    $('key-state').textContent = app.claudeKey
      ? `받음 (${maskKey(app.claudeKey)})`
      : !app.companion ? 'G2 Context 연결 필요' : app.settings.companionKey ? 'G2 Context에 키가 없거나 연결 코드가 달라요' : '연결 코드를 입력하세요';
    $('pill-key').className = `pill ${app.claudeKey ? 'ok' : 'bad'}`;
    $('now-media').textContent = app.mediaLines(10_000).filter(Boolean).join('\n');
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

  app.render();
}

void main().catch((e) => {
  console.error(e);
  document.body.prepend(Object.assign(document.createElement('p'), { className: 'message error', textContent: `시작 실패: ${e}` }));
});
