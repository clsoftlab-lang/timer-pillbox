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

로 바꾸면 앱의 AI 기능이 실제 Claude(`claude-opus-5`)로 동작합니다.

## 엔드포인트

`POST /api/ai`  — body: `{ "task": "chat"|"optimize"|"explain", "payload": {...} }`
→ `text/plain` 스트리밍 응답.

## 보안 원칙

- **API 키는 서버에만.** 브라우저·저장소·`ai/config.js` 어디에도 키를 두지 않습니다.
- `.env` 는 `.gitignore` 로 제외됩니다.
- CI 는 이 서버를 **설치/실행/호출하지 않습니다.**

> ※ 본 앱의 모든 AI 응답은 일반 정보이며 의학적 조언이 아닙니다.
