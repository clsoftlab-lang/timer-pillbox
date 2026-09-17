// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — Claude API 보안 프록시 (비용 합리적 · 무인 지향).
// 브라우저는 이 서버로만 요청하고, ANTHROPIC_API_KEY 는 서버 환경변수에만 존재한다.
// 절대 키를 프런트엔드/저장소에 두지 말 것. NOT medical advice.
//
// 비용 최적화:
//   - 기본 모델은 저비용 우선(claude-haiku-4-5). AI_MODEL 로 상향 가능
//     (더 높은 품질이 필요하면 claude-sonnet-5 또는 claude-opus-5).
//   - 안정적인 시스템 프롬프트를 prompt caching(cache_control:ephemeral)으로 재사용.
//   - 태스크별 modest max_tokens(기본 ~700).
//   - 비용 가드레일: 분당 per-IP rate limit + 월간 토큰 예산(초과 시 429 {fallback:true}).
//
// 실행: (server 폴더에서) `cp .env.example .env` 후 키 입력 → `npm install` → `npm start`
// CI에서는 절대 npm install / 실행 / API 호출하지 않는다.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

// 비용 우선 기본 모델. 더 높은 품질이 필요하면 AI_MODEL 을
// claude-sonnet-5 또는 claude-opus-5 로 올릴 수 있다.
const MODEL = process.env.AI_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 700;
const EFFORT = process.env.AI_EFFORT || "low";

// 비용 가드레일 설정
const RATE_LIMIT_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN) || 20;
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP) || 2000000;

const SYSTEM_PROMPT = [
  "당신은 시니어·만성질환자를 돕는 '타이머 알약통' 앱의 복약 도우미입니다.",
  "항상 한국어로, 쉽고 큰 글씨에 어울리는 짧은 문장으로 답하세요.",
  "당신은 의사가 아닙니다. 진단·처방 변경을 지시하지 말고 일반 정보만 제공하세요.",
  "모든 답변 끝에 '※ 의학적 조언이 아닙니다. 의사·약사와 상의하세요.'를 붙이세요.",
].join("\n");

function buildMessages(task, payload) {
  const p = payload || {};
  const meds = Array.isArray(p.meds) ? p.meds : [];
  const medLines = meds.map((m) =>
    `- ${m.name} (성분: ${(m.ingredients || []).join(", ") || "미상"}, 시간대: ${(m.slots || []).join("/")})`
  ).join("\n");
  let user;
  if (task === "optimize") {
    user = `다음 약 목록에 맞는 하루 복약 시간대(아침/점심/저녁/취침) 배분을 제안해 주세요.\n${medLines}`;
  } else if (task === "explain") {
    const w = Array.isArray(p.warnings) ? p.warnings : [];
    user = `다음 상호작용/중복 경고를 시니어도 이해하기 쉽게 설명해 주세요.\n${JSON.stringify(w, null, 2)}`;
  } else if (task === "digest") {
    // 무인(autonomous) 온-로드 다이제스트: '오늘 복약 요약 + 주의사항'
    const prog = p.progress || {};
    const upcoming = Array.isArray(p.upcoming) ? p.upcoming : [];
    const warnings = Array.isArray(p.warnings) ? p.warnings : [];
    user = [
      "오늘의 복약 상황을 시니어가 이해하기 쉽게 3~4줄로 요약하고, 주의사항이 있으면 부드럽게 안내해 주세요.",
      `진행률: ${JSON.stringify(prog)}`,
      `남은 복용: ${JSON.stringify(upcoming)}`,
      `주의(상호작용/중복): ${JSON.stringify(warnings)}`,
      `등록 약:\n${medLines || "(없음)"}`,
    ].join("\n");
  } else {
    user = `등록된 약:\n${medLines || "(없음)"}\n\n질문: ${p.question || "복약 관리에 대해 도와주세요."}`;
  }
  return [{ role: "user", content: user }];
}

/* ---------- 비용 가드레일: per-IP rate limit (in-memory) ---------- */
const rateBuckets = new Map(); // ip -> { count, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + 60000 };
    rateBuckets.set(ip, b);
  }
  b.count += 1;
  return b.count > RATE_LIMIT_PER_MIN;
}

/* ---------- 비용 가드레일: 월간 토큰 예산 (in-memory) ---------- */
let usedTokens = 0;
function budgetExceeded() {
  return usedTokens >= MONTHLY_TOKEN_CAP;
}
function accrue(usage) {
  if (!usage) return;
  usedTokens +=
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
}

function send429Fallback(res) {
  res.writeHead(429, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ fallback: true }));
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method !== "POST" || !req.url.startsWith("/api/ai")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY 가 설정되지 않았습니다." }));
    return;
  }

  // 비용 가드레일은 스트리밍(200) 시작 전에 확인한다.
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) { send429Fallback(res); return; }
  if (budgetExceeded()) { send429Fallback(res); return; }

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { task, payload } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

    // 안정적인 시스템 프롬프트는 prompt caching 으로 재사용 → 반복 호출 비용 절감
    const requestOpts = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: buildMessages(task, payload),
    };
    // Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(400 방지).
    // 그 외 모델(sonnet-5, opus-5 등)에는 adaptive thinking + effort 를 사용한다.
    if (!MODEL.startsWith("claude-haiku")) {
      requestOpts.thinking = { type: "adaptive" };
      requestOpts.output_config = { effort: EFFORT };
    }

    const client = new Anthropic({ apiKey });
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });

    const stream = client.messages.stream(requestOpts);
    stream.on("text", (t) => res.write(t));
    const finalMessage = await stream.finalMessage();
    // 스트림 최종 메시지의 usage 로 월간 토큰 사용량 누적
    accrue(finalMessage && finalMessage.usage);
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`[timer-pillbox] AI proxy listening on :${PORT} (model=${MODEL})`);
});
