// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — AI 접근 계층.
// AI_ENDPOINT 가 비어 있으면 결정론적 한국어 MockProvider(로컬 엔진 재사용)로 동작.
// 값이 있으면 백엔드 프록시(server/index.mjs)로 POST + 스트리밍.
// 어떤 경우에도 브라우저에 API 키를 두지 않는다. NOT medical advice.

import { AI_ENDPOINT } from "./config.js";
import { analyzeMeds, highestSeverity } from "../interactions.js";
import { suggestSchedule, occurrencesForDate, statusForOccurrences, progressOf } from "../schedule.js";

const DISCLAIMER = "※ 본 안내는 일반 정보이며 의학적 조언이 아닙니다. 복약 결정은 반드시 의사·약사와 상의하세요.";

const SEVERITY_KO = { high: "높음", medium: "주의", low: "낮음" };

/**
 * 결정론적 Mock 응답 생성기 — 로컬 스케줄/상호작용 엔진을 재사용한다.
 * task: "chat" | "optimize" | "explain"
 * payload: { question?, meds?, table?, warnings?, now? }
 * @returns {string}
 */
export function mockRespond(task, payload = {}) {
  const meds = Array.isArray(payload.meds) ? payload.meds : [];
  const table = payload.table || { rules: [], duplicateGroups: [] };

  if (task === "optimize") {
    const { bySlot, tips } = suggestSchedule(meds);
    const lines = ["[복약 스케줄 최적화 제안 · 데모]"];
    for (const [slot, names] of Object.entries(bySlot)) {
      const label = { morning: "아침", lunch: "점심", evening: "저녁", bedtime: "취침" }[slot];
      lines.push(`- ${label}: ${names.length ? names.join(", ") : "(없음)"}`);
    }
    lines.push("");
    for (const t of tips) lines.push("• " + t);
    lines.push("");
    lines.push(DISCLAIMER);
    return lines.join("\n");
  }

  if (task === "explain") {
    const warnings = Array.isArray(payload.warnings)
      ? payload.warnings
      : analyzeMeds(meds, table);
    if (warnings.length === 0) {
      return `현재 등록된 약들 사이에서 알려진 상호작용/중복 규칙에 걸리는 항목은 없습니다.\n\n${DISCLAIMER}`;
    }
    const lines = ["[상호작용 경고 쉬운 설명 · 데모]"];
    for (const w of warnings) {
      const sev = SEVERITY_KO[w.severity] || w.severity;
      const kind = w.type === "duplicate" ? "중복" : "상호작용";
      lines.push(`\n■ (${sev}) ${kind}: ${(w.meds || []).join(" + ")}`);
      lines.push(`  왜? ${w.message}`);
      if (w.advice) lines.push(`  어떻게? ${w.advice}`);
    }
    lines.push("");
    lines.push(DISCLAIMER);
    return lines.join("\n");
  }

  // task === "chat" (기본)
  const q = String(payload.question || "").trim();
  const warnings = analyzeMeds(meds, table);
  const sev = highestSeverity(warnings);
  const lower = q.toLowerCase();

  let body;
  if (/놓|빠|missed|건너|잊/.test(q)) {
    body = "복용을 한 번 놓쳤다면, 다음 복용 시간이 많이 남지 않았을 때는 한 번 건너뛰고 다음 시간에 정상 복용하는 것이 일반적으로 권장됩니다. 두 번 분량을 한꺼번에 복용하지 마세요. 약마다 규칙이 다르니 반드시 약사와 확인하세요.";
  } else if (/부작용|side|어지|메스|속쓰/.test(lower + q)) {
    body = "부작용이 의심되면 증상·발생 시점·복용 약을 기록해 두면 상담에 도움이 됩니다. 심한 증상(호흡곤란, 심한 발진, 출혈 등)은 즉시 의료기관에 연락하세요.";
  } else if (/상호작용|같이|함께|interaction/.test(lower + q)) {
    body = warnings.length
      ? `현재 등록된 약에서 ${warnings.length}건의 주의 항목이 감지되었습니다(최고 심각도: ${SEVERITY_KO[sev] || sev}). '상호작용 경고' 탭에서 상세 설명을 확인하세요.`
      : "현재 등록된 약들 사이에 규칙상 감지되는 상호작용은 없습니다. 다만 새 약을 추가할 때마다 다시 확인하는 것이 좋습니다.";
  } else if (/언제|시간|스케줄|schedule/.test(lower + q)) {
    body = "일정한 시간에 복용하면 순응도가 올라갑니다. '스케줄' 탭에서 아침/점심/저녁/취침 시간대를 지정하고, 알림 권한을 허용하면 정해진 시간에 브라우저 알림을 받을 수 있습니다.";
  } else {
    body = q
      ? "질문 주신 내용은 일반적인 복약 관리 관점에서 답변드릴 수 있습니다. 등록된 약과 복용 시간을 기준으로 규칙적인 복용, 상호작용 확인, 기록 유지가 핵심입니다. 구체적인 진단·처방 변경은 전문가와 상의하세요."
      : "무엇이 궁금하신가요? 예: '약을 놓쳤을 때는?', '이 약들 같이 먹어도 되나요?', '복용 시간 추천해줘'.";
  }
  return `${body}\n\n${DISCLAIMER}`;
}

/**
 * askAI — 통합 진입점.
 * @param {"chat"|"optimize"|"explain"} task
 * @param {object} payload
 * @param {{onToken?:(t:string)=>void}} [opts]
 * @returns {Promise<string>} 전체 응답 텍스트
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  // 데모 모드: 엔드포인트 없음 → MockProvider (결정론적, 로컬 엔진)
  if (!AI_ENDPOINT) {
    const text = mockRespond(task, payload);
    if (typeof onToken === "function") {
      // 스트리밍 흉내: 문장 단위로 흘려보낸다.
      for (const chunk of text.split(/(?<=\n)/)) onToken(chunk);
    }
    return text;
  }

  // 실 연동 모드: 백엔드 프록시로 POST (키는 서버에만 존재)
  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, payload }),
  });
  if (!res.ok) {
    throw new Error(`AI 백엔드 오류: ${res.status}`);
  }

  // 스트리밍(text/event-stream 또는 청크 텍스트) 처리
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = decoder.decode(value, { stream: true });
      full += piece;
      if (typeof onToken === "function") onToken(piece);
    }
    return full;
  }

  const text = await res.text();
  if (typeof onToken === "function") onToken(text);
  return text;
}
