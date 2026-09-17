// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — 빌드 없는(no-build) 프로젝트 검증기.
// 실행: `node check.mjs`
//  1) data/*.json 파싱
//  2) 모든 JS(ai/, server/ 포함) `node --check`
//  3) index.html 필수 컨테이너 존재
//  4) interactions / schedule 순수 엔진 단위 테스트
//  5) AI MockProvider 결정론(deterministic) 테스트
//  6) 보안: AI_ENDPOINT 비어있음 + 저장소에 sk-ant 없음

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

let pass = 0, fail = 0;
const fails = [];
function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function bad(name, detail) { fail++; fails.push(name); console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
function assert(cond, name, detail) { cond ? ok(name) : bad(name, detail); }

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git") continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

console.log("== 1) data/*.json 파싱 ==");
for (const f of readdirSync(join(root, "data")).filter((n) => n.endsWith(".json"))) {
  try { JSON.parse(readFileSync(join(root, "data", f), "utf8")); ok(`data/${f} 파싱`); }
  catch (e) { bad(`data/${f} 파싱`, e.message); }
}

console.log("== 2) node --check (모든 .js/.mjs, ai/+server/ 포함) ==");
const jsFiles = walk(root).filter((p) => /\.(js|mjs)$/.test(p) && !p.endsWith("check.mjs"));
let sawAi = false, sawServer = false;
for (const f of jsFiles) {
  if (f.includes(`${join("", "ai")}`) && f.replace(/\\/g, "/").includes("/ai/")) sawAi = true;
  if (f.replace(/\\/g, "/").includes("/server/")) sawServer = true;
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); ok(`node --check ${f.replace(root, ".")}`); }
  catch (e) { bad(`node --check ${f.replace(root, ".")}`, String(e.stderr || e.message).slice(0, 200)); }
}
assert(sawAi, "ai/ 폴더 JS 검사됨");
assert(sawServer, "server/ 폴더 JS 검사됨");

console.log("== 3) index.html 필수 컨테이너 ==");
const html = readFileSync(join(root, "index.html"), "utf8");
const requiredIds = [
  "tab-today", "tab-schedule", "tab-interactions", "tab-adherence", "tab-ai", "tab-device",
  "today-list", "progress-bar", "med-form", "med-list", "warnings",
  "adherence-chart", "ai-chat", "device-spec", "bom-table", "slot-choices", "day-choices",
];
for (const id of requiredIds) {
  assert(html.includes(`id="${id}"`), `index.html #${id} 존재`);
}
assert(/의학적 조언이 아닙니다/.test(html), "index.html 의학 고지 포함");
assert(/용인대학교/.test(html) && /Yongin University/.test(html), "index.html 아이디어 출처 포함");

console.log("== 4) interactions.js 단위 테스트 ==");
const intx = await import("./interactions.js");
const table = JSON.parse(readFileSync(join(root, "data", "interactions.json"), "utf8"));
{
  const warfarin = { name: "와파린", ingredients: ["warfarin"] };
  const ibu = { name: "이부프로펜", ingredients: ["ibuprofen", "nsaid"] };
  const amlo = { name: "암로디핀", ingredients: ["amlodipine"] };
  const w = intx.analyzeMeds([warfarin, ibu], table);
  assert(w.length >= 1, "와파린+이부프로펜 경고 감지", `got ${w.length}`);
  assert(intx.highestSeverity(w) === "high", "최고 심각도 high");
  // 순서 무관
  const w2 = intx.analyzeMeds([ibu, warfarin], table);
  assert(w2.length === w.length, "성분 쌍 순서 무관");
  // 무관한 조합은 경고 없음
  const none = intx.analyzeMeds([amlo], table);
  assert(none.length === 0, "단일 약 경고 없음");
  // 중복 계열: 두 NSAID
  const nap = { name: "나프록센", ingredients: ["naproxen", "nsaid"] };
  const dup = intx.analyzeMeds([ibu, nap], table);
  assert(dup.some((x) => x.type === "duplicate"), "NSAID 중복 감지");
  // 결정론: 두 번 호출 동일
  assert(JSON.stringify(intx.analyzeMeds([warfarin, ibu], table)) === JSON.stringify(w), "analyzeMeds 결정론적");
}

console.log("== 5) schedule.js 단위 테스트 ==");
const sch = await import("./schedule.js");
{
  const med = { id: "x", name: "테스트약", dose: "1정", slots: ["morning", "evening"], days: sch.DAY_KEYS };
  const monday = new Date(2026, 0, 5); // 2026-01-05 = 월요일
  const occ = sch.occurrencesForDate([med], monday);
  assert(occ.length === 2, "월요일 발생 2건", `got ${occ.length}`);
  assert(occ[0].minutes <= occ[1].minutes, "발생 시간순 정렬");
  // 요일 필터
  const medMonOnly = { id: "y", name: "월요일약", slots: ["morning"], days: ["mon"] };
  const sunday = new Date(2026, 0, 4); // 일요일
  assert(sch.occurrencesForDate([medMonOnly], sunday).length === 0, "요일 필터 동작");
  // 상태/진행률
  const dk = sch.dateKey(monday);
  const noon = new Date(2026, 0, 5, 12, 0);
  const taken = new Set([sch.occurrenceKey(dk, "x", "morning")]);
  const st = sch.statusForOccurrences(occ, noon, taken, dk);
  const prog = sch.progressOf(st);
  assert(prog.taken === 1 && prog.total === 2 && prog.percent === 50, "진행률 50% 계산", JSON.stringify(prog));
  const morn = st.find((o) => o.slot === "morning");
  assert(morn.status === "taken", "복용 완료 상태");
  const eve = st.find((o) => o.slot === "evening");
  assert(eve.status === "upcoming", "저녁은 예정 상태", eve.status);
  // 순응도 이력
  const hist = sch.adherenceHistory([med], taken, monday, 7);
  assert(hist.length === 7 && hist[hist.length - 1].date === dk, "순응도 7일 이력");
  // 최적화 제안 결정론
  const s1 = JSON.stringify(sch.suggestSchedule([med]));
  const s2 = JSON.stringify(sch.suggestSchedule([med]));
  assert(s1 === s2, "suggestSchedule 결정론적");
}

console.log("== 6) AI MockProvider 결정론 테스트 ==");
const ai = await import("./ai/ai.js");
{
  const meds = JSON.parse(readFileSync(join(root, "data", "meds.json"), "utf8")).meds;
  const payload = { meds, table };
  const chatA = await ai.askAI("chat", { ...payload, question: "약을 놓쳤어요" });
  const chatB = await ai.askAI("chat", { ...payload, question: "약을 놓쳤어요" });
  assert(typeof chatA === "string" && chatA.length > 0, "chat mock 응답 존재");
  assert(chatA === chatB, "chat mock 결정론적");
  assert(/의학적 조언이 아닙니다/.test(chatA), "chat 응답에 의학 고지 포함");
  const opt = await ai.askAI("optimize", payload);
  assert(/아침|점심|저녁|취침/.test(opt), "optimize 응답에 시간대 포함");
  assert(opt === await ai.askAI("optimize", payload), "optimize 결정론적");
  const exp = await ai.askAI("explain", payload);
  assert(exp === await ai.askAI("explain", payload), "explain 결정론적");
  // 스트리밍 콜백 누적 == 반환값
  let streamed = "";
  const full = await ai.askAI("chat", { ...payload, question: "상호작용 알려줘" }, { onToken: (t) => (streamed += t) });
  assert(streamed === full, "onToken 스트림 == 전체 응답");
}

console.log("== 7) 보안 검사 ==");
const cfg = readFileSync(join(root, "ai", "config.js"), "utf8");
assert(/export\s+const\s+AI_ENDPOINT\s*=\s*""\s*;/.test(cfg), "ai/config.js AI_ENDPOINT 빈 문자열");
{
  // .gitignore 가 .env 를 제외하는지 확인 (키/시크릿 커밋 방지)
  const gi = readFileSync(join(root, ".gitignore"), "utf8");
  assert(/(^|\n)\s*\.env\s*($|\n)/.test(gi), ".gitignore 가 .env 제외");
}
{
  // 저장소 전체에 실제 키(sk-ant-...) 없음.
  // 패턴 문자열을 분리 구성해 이 파일(README의 sk-ant… 설명 포함)이 자기 자신에
  // 오탐되지 않도록 하고, {20,} 로 실제 키 길이만 매칭한다.
  const files = walk(root).filter((p) => !/LICENSE$/.test(p));
  let leak = null;
  const keyPat = new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}');
  for (const f of files) {
    if (f === resolve(root, "check.mjs")) continue;
    let txt;
    try { txt = readFileSync(f, "utf8"); } catch { continue; }
    if (keyPat.test(txt)) { leak = f; break; }
  }
  assert(!leak, "저장소에 실제 sk-ant 키 없음", leak || "");
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
if (fail > 0) { console.error("실패 항목:", fails.join(", ")); process.exit(1); }
console.log("모든 검사 통과 ✅");
