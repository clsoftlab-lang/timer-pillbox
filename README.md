<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 타이머 알약통 · Timer Pillbox

[한국어 README →](./README.ko.md)

A **no-build, static** medication-reminder web app for seniors and people with chronic
conditions — plus a **hardware device spec page** for the physical timer-pillbox concept.
Everything runs client-side; data lives in `localStorage`; the UI is in Korean.

**🔗 LIVE DEMO: https://clsoftlab-lang.github.io/timer-pillbox/**

> ⚠️ **This app is NOT medical advice.** All medications, interaction rules and AI
> answers are **fictional / educational demos**. Always consult a doctor or pharmacist.

## What it does

- **복약 스케줄 등록** — name, dose, ingredients, time slots (아침/점심/저녁/취침), weekdays.
- **복약 알림** — browser **Notification API** (permission requested) + a sound beep when a
  dose is due; tap **"복용함"** to record it.
- **오늘의 복약 현황** — live progress bar (taken / total, %).
- **상호작용 / 중복 경고 엔진** — a real, rule-based engine (`interactions.js`) that compares
  the ingredients of registered meds against a rules table and flags interactions & duplicate
  drug classes (non-medical, educational).
- **복약 순응도 그래프** — 7-day adherence bar chart from your check-off history.
- **큰 글씨 옵션** — senior-friendly text scaling, plus light/dark themes.
- **디바이스 스펙 페이지** — the physical timer-pillbox (per-slot timers, LED/buzzer, BLE app
  sync) with a rough **BOM**.

## Architecture

| File | Role |
|------|------|
| `index.html` | App shell + all containers |
| `styles.css` | Mobile-first, light/dark, large-text |
| `app.js` | UI controller (ES module) |
| `schedule.js` | **Pure** schedule engine (no DOM) — occurrences, status, progress, adherence |
| `interactions.js` | **Pure** interaction/duplicate engine (no DOM) |
| `ai/config.js` | `AI_ENDPOINT` (empty ⇒ demo/mock) |
| `ai/ai.js` | `askAI(task, payload, {onToken})` — mock or backend-proxy streaming |
| `server/` | Optional Claude API proxy (key stays server-side) |
| `data/*.json` | Seed meds, interaction rules, device spec/BOM |
| `check.mjs` | Verifier (JSON parse, `node --check`, unit tests, security) |

## 🤖 AI 기능 (API 연동)

Three AI features, **all labelled NOT medical advice**:

1. **AI 복약 상담 챗봇** — questions about schedule / side-effects / what-if-you-missed-a-dose → general guidance.
2. **복약 스케줄 최적화 제안** — suggests a time-slot distribution from your meds list.
3. **상호작용 경고 자연어 설명** — explains the interaction warnings in plain Korean.

**DEMO-MODE boundaries (very important):**

- **In the live demo, `AI_ENDPOINT` is empty**, so AI runs entirely on a **deterministic local
  MockProvider** that reuses the `schedule.js` / `interactions.js` engines. No network, no key.
- **No API key is ever placed in the browser or the repository.** Keys live **server-side only.**
- To enable **real Claude**: run `server/` (see [`server/README.md`](./server/README.md)),
  set **`ANTHROPIC_API_KEY`** as a server env var, use model **`claude-opus-5`**, then set
  `AI_ENDPOINT` in `ai/config.js` to your proxy URL. **Keep the key server-side only.**

## Run locally

```bash
# from the repo root — any static server works
python -m http.server 9016
# then open http://localhost:9016/
```

Verify everything:

```bash
node check.mjs        # JSON parse + node --check (incl. ai/ + server/) + unit tests + security
```

CI (`.github/workflows/ci.yml`) runs `node --check` on all JS and `node check.mjs`. **CI never
runs `npm install`, never starts the server, and never calls the API.**

## Idea origin / 🎓 아이디어 출처

This concept was inspired by a **standout student's pitch in Dr. Lee Il-guk's entrepreneurship
class at Yongin University (용인대학교)**. This is a **clean-room reconstruction** — no copied
sentences, no personal data, fictional demo data only. With gratitude to the student who shared
the idea. (한국어 설명은 앱 하단 및 [README.ko.md](./README.ko.md) 참고.)

## Contributors

- **Dr. Lee Il-guk (이일국)** — idea steward, project lead
- **LWJ**, **LMJ** — contributors
- **Claude** (Anthropic) — implementation assistant

## License

- Code: **Apache-2.0** (see [`LICENSE`](./LICENSE))
- Docs/content: **CC BY 4.0**

SPDX headers: `Apache-2.0` · `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`

> **Not an official Anthropic product.**
