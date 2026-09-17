<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 타이머 알약통 — AI 보안 프록시 (server/)

브라우저에서 **직접 Claude API 를 호출하지 않습니다.** 이 작은 Node 서버가
`ANTHROPIC_API_KEY` 를 **서버 환경변수로만** 보관하고, 프런트엔드는 이 서버로만 요청합니다.

## 실행 방법

```bash
cd server
cp .env.example .env      # .env 를 열어 ANTHROPIC_API_KEY 를 실제 키로 채웁니다
npm install               # @anthropic-ai/sdk 설치
npm start                 # http://localhost:8787 에서 대기
```

그런 다음 저장소 루트의 `ai/config.js` 에서:

```js
export const AI_ENDPOINT = "http://localhost:8787/api/ai";
```

로 바꾸면 앱의 AI 기능이 실제 Claude로 동작합니다.

## 비용 합리적(cost-first) 설정

기본 모델은 **저비용 우선 `claude-haiku-4-5`** 입니다. 환경변수로 조정합니다:

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AI_MODEL` | `claude-haiku-4-5` | 더 높은 품질이 필요하면 `claude-sonnet-5` 또는 `claude-opus-5` 로 상향 |
| `AI_MAX_TOKENS` | `700` | 태스크별 출력 상한(비용 절감) |
| `AI_EFFORT` | `low` | 비-Haiku 모델의 사고(effort) 수준 |
| `AI_RATE_LIMIT_PER_MIN` | `20` | per-IP 분당 요청 제한 |
| `AI_MONTHLY_TOKEN_CAP` | `2000000` | 월간 토큰 예산(초과 시 `429 {fallback:true}`) |

비용 최적화 요소:

- **프롬프트 캐싱**: 안정적인 시스템 프롬프트를 `cache_control:{type:"ephemeral"}` 로 재사용해 반복 호출 비용을 낮춥니다.
- **Thinking/effort 안전 처리**: `claude-haiku*` 모델에는 `thinking`/`effort` 를 **보내지 않습니다**(Haiku 4.5 는 adaptive thinking/effort 미지원 → 400 방지). 그 외 모델은 `thinking:{type:"adaptive"}` + `output_config.effort` 를 사용합니다.
- **가드레일**: per-IP rate limit + 월간 토큰 예산. 초과 시 `429 {fallback:true}` 를 반환하고, 프런트(`ai/ai.js`)는 자동으로 로컬 목업으로 폴백합니다(무인).

## 엔드포인트

`POST /api/ai`  — body: `{ "task": "chat"|"optimize"|"explain"|"digest", "payload": {...} }`
→ `text/plain` 스트리밍 응답. (예산/레이트리밋 초과 시 `429 {fallback:true}`.)

## 무인(autonomous) — Cloudflare Workers 무료 배포

상시 서버를 관리하지 않고도 실 AI를 무료 티어로 가동하려면 `worker.js` + `wrangler.toml` 을 사용합니다.
Worker는 Anthropic REST(`POST https://api.anthropic.com/v1/messages`)를 직접 호출하며, 위와 동일한
태스크 라우팅·모델·캐싱 규칙을 따릅니다.

```bash
npm i -g wrangler
cd server
wrangler secret put ANTHROPIC_API_KEY   # 실제 키 입력 — 저장소에 저장되지 않음
wrangler deploy                          # 무료 티어, 관리할 서버 없음
```

배포 후 출력된 Worker URL을 `ai/config.js` 의 `AI_ENDPOINT` 에 `/api/ai` 경로로 설정합니다:

```js
export const AI_ENDPOINT = "https://timer-pillbox-ai.<계정>.workers.dev/api/ai";
```

모델/토큰 상한은 `wrangler.toml` 의 `[vars]`(`AI_MODEL`, `AI_MAX_TOKENS`, `AI_EFFORT`)로 조정합니다.

## 보안 원칙

- **API 키는 서버에만.** 브라우저·저장소·`ai/config.js` 어디에도 키를 두지 않습니다. (Node 프록시는 환경변수, Worker는 `wrangler secret`.)
- `.env` 는 `.gitignore` 로 제외됩니다.
- CI 는 이 서버를 **설치/실행/호출하지 않습니다.**

> ※ 본 앱의 모든 AI 응답은 일반 정보이며 의학적 조언이 아닙니다.
