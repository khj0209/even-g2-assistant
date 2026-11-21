# G2 Assistant

Even Realities G2 안경에서 쓰는 AI 어시스턴트입니다. 안경 왼쪽의 작은 픽셀 말티즈 **몽이**가 Claude의 답을 전해 줍니다.

```
┌──────────────────────────────────────────────────────────┐
│ 안경 82%   3°/11°   14:07   AI 90%                        │  ← 상단 상태 줄
│            > 오늘 서울 날씨 어때?                          │
│   (몽이)                                                  │
│  ▒▓██▓▒    서울은 오늘 맑고 최저 3도, 최고 11도예요.       │  ← 답변 (쪽 넘김)
│  ▓█▀▀█▓    오후에는 바람이 조금 불어요.                    │
│   몽이                                          1/2       │
└──────────────────────────────────────────────────────────┘
```

## 기능 (MVP)

| | |
| --- | --- |
| 상단 상태 줄 | 안경 배터리 · 오늘 최저/최고 기온(Open-Meteo) · 현재 시각 · AI 토큰 잔여(월 예산 대비 %) |
| 말티즈 캐릭터 | 24×24 픽셀 스프라이트. 대기(눈 깜빡임) · 듣는 중(소리 물결) · 생각 중(?) · 말하는 중(입 움직임) · 완료(하트) · 오류(!) |
| 음성 대화 | 안경 터치패드를 **길게 누른 채 말하고 손을 떼면** 답합니다 (push-to-talk) |
| API 키 | 휴대폰 화면에서 직접 입력, 이 휴대폰에만 암호화 저장 |
| 세션 선택 | 휴대폰에서 대화 세션(로컬) 또는 Claude 에이전트 세션(Managed Agents)을 골라 이어서 대화 |
| 안경 화면 미러 | 휴대폰 화면 맨 위에 안경 화면을 그대로 보여주고, 같은 조작(누르고 말하기·다음 쪽·취소)도 가능 |

## 안경 조작

- **길게 누르기 → 떼기**: 말하기 → 답변
- **탭 / 위·아래 스크롤**: 답이 길 때 쪽 넘기기
- **두 번 탭**: 듣는 중이면 취소, 답하는 중이면 중단, 그 외에는 앱 종료

## 휴대폰 화면

1. **Claude API 키**: `sk-ant-…` 키를 넣고 "확인 후 저장". 키가 실제로 동작하는지 먼저 확인한 뒤에만 저장합니다.
2. **음성 인식**: Claude API는 음성을 직접 받지 않으므로 음성을 글자로 바꾸는 단계가 필요합니다.
   - *안경 마이크 + OpenAI*: OpenAI 키를 등록하면 안경 마이크 소리를 OpenAI 음성 인식(`gpt-4o-mini-transcribe`, 변경 가능)으로 바꿉니다. 가장 정확합니다.
   - *휴대폰 음성인식*: 키 없이 휴대폰의 음성인식(Web Speech API)을 씁니다. 휴대폰 마이크를 쓰고, WebView에 따라 지원하지 않을 수 있습니다.
   - *자동*(기본): OpenAI 키가 있으면 안경 마이크, 없으면 휴대폰 음성인식.
3. **세션**: "새 대화"로 대화를 나누고 목록에서 이전 대화를 골라 이어갈 수 있습니다. "Claude 에이전트 세션 불러오기"는 같은 API 키 계정의 Managed Agents 세션 목록을 가져오고, 선택하면 안경에서 한 말이 그 세션으로 전달됩니다.
4. **모델 · 토큰**: 모델(기본 Claude Opus 5.5, Sonnet 5.5, Haiku 5.5)과 월 토큰 예산을 정합니다.

### "AI 잔여 토큰"에 대해

Anthropic API는 일반 API 키로 계정 잔액을 조회하는 기능을 제공하지 않습니다. 그래서 이 앱은 **이 휴대폰에서 쓴 토큰**(응답의 `usage`)을
달마다 세고, 휴대폰에서 정한 월 예산 대비 남은 비율을 `AI 90%` 처럼 보여줍니다. 예산을 0으로 두면 사용한 토큰 수(`AI 12K`)를 보여줍니다.
실제 결제 한도는 [Console](https://console.anthropic.com/settings/limits)에서 워크스페이스 월 한도로 거는 것을 권장합니다.

### "Claude Code 세션 선택"에 대해

claude.ai/code 의 Claude Code 세션은 API 키로 접근할 수 있는 공개 API가 없어 MVP에서는 다루지 않습니다. 대신 API 키로 접근할 수 있는
**Claude Managed Agents 세션**(Anthropic이 호스팅하는 에이전트 세션)을 목록에서 골라 안경으로 대화할 수 있게 했습니다.
에이전트가 도구 사용 승인을 기다리면 안경에 "(휴대폰에서 승인이 필요해요)"가 표시됩니다(승인 UI는 다음 단계).

## 보안

- **키는 이 휴대폰에만**: Claude/OpenAI 키는 Even 앱의 플러그인 저장소에 **AES-GCM으로 암호화**되어 저장됩니다. 암호화 키는 IndexedDB의
  *추출 불가능한* WebCrypto 키라서 페이지 코드도 키 바이트를 읽을 수 없고, 저장소 사본만으로는 API 키를 복원할 수 없습니다.
  암호화 저장을 지원하지 않는 환경에서는 디스크에 쓰지 않고 메모리에만 둡니다.
- **보낼 곳 제한**: Claude 키는 `api.anthropic.com`, OpenAI 키는 `api.openai.com` 으로만 전송됩니다. 빌드된 페이지에는
  `connect-src` CSP가 들어가 그 외 호스트로의 네트워크 요청을 막고, `app.json` 의 네트워크 화이트리스트도 같은 호스트만 허용합니다.
- **노출 최소화**: 저장 후 입력칸을 비우고, 화면에는 `sk-ant-…wxyz` 처럼 앞뒤 일부만 보여주며, 키를 로그에 남기지 않습니다.
  저장 전에 키가 실제로 동작하는지 확인합니다.
- 위치는 날씨 조회에만 쓰며 소수점 둘째 자리(약 1 km)로 반올림해 보냅니다.
- 서버가 없는 구조라 API는 휴대폰에서 직접 호출합니다(SDK의 `dangerouslyAllowBrowser`). 키가 사용자 본인의 휴대폰에서 입력되고
  본인 계정으로만 쓰이므로 의도된 사용입니다. 이 앱을 다른 사람이 키를 넣는 공개 웹페이지로 배포하지는 마세요.

## 개발

```bash
npm install
npm run dev     # http://localhost:5173 — 일반 브라우저에서도 안경 미러와 함께 동작(미리보기 모드)
npm run qr      # Even 앱으로 스캔해서 실제 안경에서 개발 버전 실행
npm run sim     # Even Hub 시뮬레이터
npm test        # 단위 테스트
npm run typecheck  # 타입 검사 (CI에서도 실행)
npm run pack    # g2-assistant.ehpk 생성
```

`build`/`pack` 은 타입 검사 없이 Vite로만 빌드합니다. TypeScript 7은 네이티브 컴파일러라 Android(Termux)용 실행 파일이 없어서,
휴대폰 Termux에서도 `npm run pack` 이 되도록 타입 검사는 `npm run typecheck`(그리고 CI)로 분리했습니다.

## 배포 (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`): 모든 push/PR에서 버전·아이콘 검사, 타입 검사, 테스트, 빌드, `.ehpk` 패키징 후 아티팩트로 올립니다.
- **Release to Even Hub** (`.github/workflows/release.yml`): 작업 브랜치(`claude/g2-ai-assistant-skkzlq`)에서 `app.json` 이 바뀌면
  (= 버전을 올리면) 자동으로 패키징 → Even Hub 업로드 → 베타 지정까지 합니다. `v*` 태그 push나 Actions 탭 수동 실행도 됩니다.
  별도 `main` 브랜치 없이 이 브랜치에서 바로 작업하고 배포합니다.

```bash
npm version patch --no-git-tag-version   # package.json + app.json 버전을 함께 올림
git commit -am "v$(node scripts/version.mjs get)" && git push   # → 자동 배포
```

### 처음 한 번만

1. 맥에서 Even Hub 로그인 후, 앱을 Even Hub에 처음 등록합니다.
   ```bash
   npx evenhub login
   npm run pack
   npx evenhub create g2-assistant.ehpk --name "G2 Assistant" --tagline "픽셀 말티즈 AI 어시스턴트"
   ```
   (휴대폰 Termux에서도 됩니다. `build`/`pack` 은 Termux에서 동작하도록 타입 검사를 분리해 두었습니다.)
2. 로그인 정보를 저장소 시크릿으로 등록합니다.
   ```bash
   pbcopy < ~/.config/evenhub/credentials.yaml               # 맥
   termux-clipboard-set < ~/.config/evenhub/credentials.yaml # Termux (Termux:API 필요), 또는 cat 으로 출력해 복사
   ```
   GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret 에서 이름을 `EVENHUB_CREDENTIALS` 로 하고 붙여넣습니다.
3. Even Hub는 로그인을 갱신할 때마다 이전 토큰을 폐기하므로, 워크플로가 갱신된 로그인을 시크릿에 다시 저장합니다. GitHub → Settings(개인)
   → Developer settings → Fine-grained tokens 에서 이 저장소만 대상으로 **Secrets: Read and write** 권한을 준 토큰을 만들어
   `EVENHUB_SECRET_WRITER` 시크릿으로 등록합니다.

- 워크플로가 로그인을 갱신하면 맥에 저장된 로그인은 폐기됩니다. 맥에서 직접 CLI를 쓰려면 다시 로그인하세요.
- 맥에서 다시 로그인하면 반대로 시크릿의 로그인이 폐기될 수 있으니, 그때는 `EVENHUB_CREDENTIALS` 도 새로 등록하세요.

## 구조

```
src/
  core/       표시 형식, 글자 줄바꿈·쪽 나누기, 토큰 사용량, PCM→WAV
  platform/   Even 앱 브리지, 저장소, 암호화 키 보관함
  services/   Claude(Messages API · Managed Agents 세션), 음성 인식, 날씨
  glasses/    화면 배치, 말티즈 스프라이트, 렌더러(바뀐 것만 전송), 안경/휴대폰 미러 출력
  app.ts      전체 조율 (길게 누르기 → 음성 인식 → Claude → 몽이)
  main.ts     휴대폰 설정 화면
scripts/      버전·아이콘 검사, 릴리스 노트, 아이콘 생성
```

## 알려진 제약 · 확인 필요

- 실제 G2 하드웨어에서는 아직 검증하지 않았습니다. 브라우저 미리보기와 단위 테스트, `.ehpk` 패키징까지 확인했습니다.
- 안경 마이크 PCM은 16 kHz · 16-bit · mono로 가정합니다(SDK 문서에 형식이 명시되어 있지 않음). 인식 결과가 이상하면 이 값부터 확인하세요.
- 안경 글꼴 폭은 웹에서 측정할 수 없어 글자 종류별 추정치로 줄을 나눕니다. 실제 화면에서 줄이 넘치면 `src/core/textlayout.ts` 의 폭을 조정하세요.
- 휴대폰 음성인식(Web Speech API)은 Even 앱 WebView에서 지원되지 않을 수 있습니다. 그 경우 OpenAI 키를 등록해 안경 마이크를 쓰세요.
