// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — Cloudflare Workers 변형 (무인 · 무료 호스팅).
// Anthropic REST(POST /v1/messages)를 직접 호출한다. 키는 Worker secret
// `ANTHROPIC_API_KEY` 로만 존재하며 브라우저/저장소에 노출되지 않는다.
// 서버를 상시 관리할 필요가 없어(무인) 데모를 저비용으로 상시 가동할 수 있다.
// NOT medical advice.
//
// 배포:
//   npm i -g wrangler
//   wrangler secret put ANTHROPIC_API_KEY     # 실제 키 입력 (저장소에 저장되지 않음)
//   wrangler deploy
// 그런 다음 ai/config.js 의 AI_ENDPOINT 를 배포된 Worker URL(+ /api/ai)로 설정.

// 비용 우선 기본 모델. env.AI_MODEL 로 claude-sonnet-5 / claude-opus-5 상향 가능.
const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_EFFORT = "low";

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

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": (env && env.ALLOW_ORIGIN) || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || !url.pathname.startsWith("/api/ai")) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const apiKey = env && env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY secret 이 없습니다." }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const MODEL = (env && env.AI_MODEL) || DEFAULT_MODEL;
    const MAX_TOKENS = Number(env && env.AI_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
    const EFFORT = (env && env.AI_EFFORT) || DEFAULT_EFFORT;

    let task, payload;
    try {
      const body = await request.json();
      task = body.task;
      payload = body.payload;
    } catch {
      return new Response(JSON.stringify({ error: "잘못된 요청 본문" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 안정적 시스템 프롬프트를 prompt caching 으로 재사용 → 반복 호출 비용 절감
    const reqBody = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: buildMessages(task, payload),
    };
    // Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(400 방지).
    if (!MODEL.startsWith("claude-haiku")) {
      reqBody.thinking = { type: "adaptive" };
      reqBody.output_config = { effort: EFFORT };
    }

    let apiRes;
    try {
      apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(reqBody),
      });
    } catch {
      // 네트워크 오류 → 프런트가 목업으로 폴백하도록 429 {fallback:true}
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!apiRes.ok) {
      // 레이트리밋/오류 → 무인 폴백 신호
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await apiRes.json();
    const text = (Array.isArray(data.content) ? data.content : [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("");

    return new Response(text, {
      status: 200,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
