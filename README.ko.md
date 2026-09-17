<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 타이머 알약통 (Timer Pillbox)

[English README →](./README.md)

시니어·만성질환자를 위한 **빌드 불필요(no-build) 정적** 복약 알림 웹앱과,
물리 **타이머 알약통** 하드웨어 컨셉의 **디바이스 스펙 페이지**입니다.
모든 기능은 브라우저에서 동작하고 데이터는 `localStorage` 에 저장되며 UI는 한국어입니다.

**🔗 라이브 데모: https://clsoftlab-lang.github.io/timer-pillbox/**

> ⚠️ **이 앱은 의학적 조언이 아닙니다.** 모든 약·상호작용 규칙·AI 답변은 **가상/교육용
> 데모**입니다. 실제 복약 결정은 반드시 의사·약사와 상의하세요.

## 주요 기능

- **복약 스케줄 등록** — 약 이름·용량·성분·시간대(아침/점심/저녁/취침)·요일.
- **복약 알림** — due 시간에 브라우저 **알림(Notification API, 권한 요청)** + 소리, "복용함" 체크로 기록.
- **오늘의 복약 현황** — 진행률(복용/전체, %) 실시간 표시.
- **상호작용/중복 경고 엔진** — 등록 약들의 성분을 규칙 표와 대조해 실제로 경고를 산출(`interactions.js`, 비의료).
- **복약 순응도 그래프** — 최근 7일 순응도 막대 그래프.
- **큰 글씨 옵션** — 시니어 배려 글자 확대, 라이트/다크 테마.
- **디바이스 스펙 페이지** — 칸별 타이머, LED/부저, BLE 앱 연동 + 개략 **BOM**.

## 구성 파일

| 파일 | 역할 |
|------|------|
| `index.html` | 앱 셸 + 모든 컨테이너 |
| `styles.css` | 모바일 우선, 라이트/다크, 큰 글씨 |
| `app.js` | UI 컨트롤러(ES module) |
| `schedule.js` | **순수** 스케줄 엔진(DOM 없음) |
| `interactions.js` | **순수** 상호작용/중복 엔진(DOM 없음) |
| `ai/config.js` | `AI_ENDPOINT`(빈 값 ⇒ 데모/목업) |
| `ai/ai.js` | `askAI(task, payload, {onToken})` — 목업 또는 백엔드 프록시 스트리밍 |
| `server/` | 선택적 Claude API 프록시(키는 서버에만) |
| `data/*.json` | 시드 약·상호작용 규칙·디바이스 스펙/BOM |
| `check.mjs` | 검증기(JSON 파싱, `node --check`, 단위 테스트, 보안) |

## 🤖 AI 기능 (API 연동)

3가지 AI 기능 (**모두 의학적 조언 아님** 라벨):

1. **AI 복약 상담 챗봇** — 스케줄/부작용/복용 놓쳤을 때 등 일반 안내.
2. **복약 스케줄 최적화 제안** — 등록 약 목록으로 시간대 배분 제안.
3. **상호작용 경고 자연어 설명** — 경고를 쉬운 말로 설명.

**데모 모드 경계(중요):**

- **라이브 데모에서는 `AI_ENDPOINT` 가 비어 있어** AI가 전부 **결정론적 로컬 MockProvider**
  (스케줄/상호작용 엔진 재사용)로 동작합니다. 네트워크·키 없음.
- **API 키는 브라우저/저장소에 절대 두지 않습니다. 키는 서버에만 존재합니다.**
- **실제 Claude 연동**: `server/` 실행([`server/README.md`](./server/README.md)) →
  서버 환경변수 **`ANTHROPIC_API_KEY`** 설정 → 모델 **`claude-opus-5`** →
  `ai/config.js` 의 `AI_ENDPOINT` 를 프록시 URL로 설정. **키는 서버 측에만 둡니다.**

## 로컬 실행

```bash
python -m http.server 9016
# http://localhost:9016/ 접속
node check.mjs   # 전체 검증
```

CI는 모든 JS에 `node --check` + `check.mjs` 만 실행합니다. **`npm install`·서버 실행·API
호출을 절대 하지 않습니다.**

## 🎓 아이디어 출처

이 아이디어는 **이일국 박사(Dr. Lee Il-guk)**의 **용인대학교(Yongin University)** 창업
수업에서 나온 한 우수 학생의 발표에서 영감을 받았습니다. 원본 자료·문장·개인정보는 사용하지
않은 **클린룸 재구성**이며 데모 데이터는 모두 가상입니다. 아이디어를 나눠 준 학생에게
감사드립니다.

## 기여자

- **이일국 박사(Dr. Lee Il-guk)** — 아이디어 관리, 프로젝트 리드
- **LWJ**, **LMJ** — 기여자
- **Claude**(Anthropic) — 구현 보조

## 라이선스

- 코드: **Apache-2.0** ([`LICENSE`](./LICENSE))
- 문서/콘텐츠: **CC BY 4.0**

> **Anthropic 공식 제품이 아닙니다. (Not an official Anthropic product.)**
