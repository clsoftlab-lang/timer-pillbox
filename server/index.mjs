// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — Claude API 보안 프록시.
// 브라우저는 이 서버로만 요청하고, ANTHROPIC_API_KEY 는 서버 환경변수에만 존재한다.
// 절대 키를 프런트엔드/저장소에 두지 말 것. NOT medical advice.
//
// 실행: (server 폴더에서) `cp .env.example .env` 후 키 입력 → `npm install` → `npm start`
// CI에서는 절대 npm install / 실행 / API 호출하지 않는다.

import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";

const PORT = process.env.PORT || 8787;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

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
  } else {
    user = `등록된 약:\n${medLines || "(없음)"}\n\n질문: ${p.question || "복약 관리에 대해 도와주세요."}`;
  }
  return [{ role: "user", content: user }];
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

  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { task, payload } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

    const client = new Anthropic({ apiKey });
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    });

    const stream = client.messages.stream({
      model: "claude-opus-5",
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: buildMessages(task, payload),
    });

    stream.on("text", (t) => res.write(t));
    await stream.finalMessage();
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
  console.log(`[timer-pillbox] AI proxy listening on :${PORT}`);
});
