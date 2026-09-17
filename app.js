// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — 타이머 알약통 UI 컨트롤러 (ES module).
// 순수 엔진(schedule.js, interactions.js)과 AI 계층(ai/ai.js)을 결합한다.
// localStorage 는 try/catch 로 감싸며, 실패해도 앱은 동작한다. NOT medical advice.

import {
  SLOTS, DAY_KEYS, DAY_LABELS, slotLabel,
  occurrencesForDate, statusForOccurrences, dueNow, progressOf,
  adherenceHistory, dateKey, occurrenceKey,
} from "./schedule.js";
import { analyzeMeds, highestSeverity } from "./interactions.js";
import { askAI } from "./ai/ai.js";

const LS_MEDS = "tp.meds.v1";
const LS_TAKEN = "tp.taken.v1";
const LS_PREFS = "tp.prefs.v1";
const SEVERITY_KO = { high: "높음(High)", medium: "주의(Medium)", low: "낮음(Low)" };

const state = {
  meds: [],
  taken: new Set(),
  prefs: { theme: "auto", large: false },
  rules: { rules: [], duplicateGroups: [] },
  device: { spec: [], bom: [] },
  notifiedKeys: new Set(),
};

/* ---------- localStorage helpers (안전) ---------- */
function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 무시 */ }
}

/* ---------- 데이터 로드 ---------- */
async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`load ${path} ${res.status}`);
  return res.json();
}

async function loadSeedMeds() {
  try {
    const d = await loadJSON("./data/meds.json");
    return Array.isArray(d.meds) ? d.meds : [];
  } catch { return []; }
}

/* ---------- 렌더 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function now() { return new Date(); }

function renderToday() {
  const d = now();
  const dk = dateKey(d);
  const occ = occurrencesForDate(state.meds, d);
  const statusList = statusForOccurrences(occ, d, state.taken, dk, 0);
  const prog = progressOf(statusList);

  $("#progress-text").textContent = `${prog.taken} / ${prog.total} 복용`;
  $("#progress-percent").textContent = `${prog.percent}%`;
  const bar = $("#progress-bar");
  bar.style.width = `${prog.percent}%`;
  const track = $(".progress-track");
  if (track) track.setAttribute("aria-valuenow", String(prog.percent));

  const list = $("#today-list");
  list.innerHTML = "";
  if (statusList.length === 0) {
    list.innerHTML = `<li class="dose-item"><div class="dose-main"><div class="name">오늘 복용할 약이 없습니다.</div><div class="sub">‘스케줄’ 탭에서 약을 추가하세요.</div></div></li>`;
    return;
  }
  const statusText = { taken: "복용함", due: "복용 시간", upcoming: "예정", missed: "놓침" };
  for (const o of statusList) {
    const li = document.createElement("li");
    li.className = "dose-item" + (o.status === "taken" ? " is-taken" : "");
    li.innerHTML = `
      <span class="dose-time">${o.time}</span>
      <div class="dose-main">
        <div class="name">${escapeHtml(o.name)} <span class="sub">${escapeHtml(o.dose)}</span></div>
        <div class="sub">${o.slotLabel} · <span class="badge ${o.status}">${statusText[o.status]}</span></div>
      </div>
      <button class="take-btn ${o.status === "taken" ? "done" : ""}" data-key="${o.key}" type="button">
        ${o.status === "taken" ? "✓ 완료" : "복용함"}
      </button>`;
    list.appendChild(li);
  }
  $$(".take-btn", list).forEach((btn) => {
    btn.addEventListener("click", () => toggleTaken(btn.dataset.key));
  });
}

function toggleTaken(key) {
  if (state.taken.has(key)) state.taken.delete(key);
  else state.taken.add(key);
  lsSet(LS_TAKEN, Array.from(state.taken));
  renderToday();
  renderAdherence();
}

function renderMedList() {
  const ul = $("#med-list");
  ul.innerHTML = "";
  if (state.meds.length === 0) {
    ul.innerHTML = `<li class="med-item"><div class="meta">등록된 약이 없습니다.</div></li>`;
    return;
  }
  for (const m of state.meds) {
    const li = document.createElement("li");
    li.className = "med-item";
    const slots = (m.slots || []).map(slotLabel).join(", ") || "-";
    const days = (m.days || []).map((k) => DAY_LABELS[k] || k).join("") || "매일";
    li.innerHTML = `
      <div class="meta">
        <div class="name"><strong>${escapeHtml(m.name)}</strong> ${escapeHtml(m.dose || "")}</div>
        <div class="tags">시간대: ${slots} · 요일: ${days} · 성분: ${escapeHtml((m.ingredients || []).join(", ") || "-")}</div>
      </div>
      <button class="del-btn" data-id="${escapeAttr(m.id)}" type="button">삭제</button>`;
    ul.appendChild(li);
  }
  $$(".del-btn", ul).forEach((btn) => {
    btn.addEventListener("click", () => removeMed(btn.dataset.id));
  });
}

function removeMed(id) {
  state.meds = state.meds.filter((m) => m.id !== id);
  persistMeds();
  renderAll();
}

function renderWarnings() {
  const box = $("#warnings");
  const warnings = analyzeMeds(state.meds, state.rules);
  box.innerHTML = "";
  if (warnings.length === 0) {
    box.innerHTML = `<div class="no-warn">✅ 등록된 약들 사이에서 규칙상 감지되는 상호작용/중복이 없습니다. (규칙 기반 데모, 의학적 조언 아님)</div>`;
    return;
  }
  for (const w of warnings) {
    const div = document.createElement("div");
    div.className = `warn-card ${w.severity}`;
    const kind = w.type === "duplicate" ? "중복" : "상호작용";
    div.innerHTML = `
      <div class="sev">${SEVERITY_KO[w.severity] || w.severity} · ${kind}</div>
      <div class="pair">${escapeHtml((w.meds || []).join(" + "))}</div>
      <div>${escapeHtml(w.message)}</div>
      ${w.advice ? `<div class="muted">→ ${escapeHtml(w.advice)}</div>` : ""}`;
    box.appendChild(div);
  }
}

function renderAdherence() {
  const chart = $("#adherence-chart");
  const hist = adherenceHistory(state.meds, state.taken, now(), 7);
  chart.innerHTML = "";
  const dayShort = ["일", "월", "화", "수", "목", "금", "토"];
  let sumPct = 0, counted = 0;
  for (const h of hist) {
    const col = document.createElement("div");
    col.className = "bar-col";
    const label = dayShort[new Date(h.date + "T00:00:00").getDay()];
    col.innerHTML = `
      <span class="bar-val">${h.total ? h.percent + "%" : "-"}</span>
      <div class="bar" style="height:${h.total ? Math.max(3, h.percent) : 0}%"></div>
      <span class="bar-label">${label}</span>`;
    chart.appendChild(col);
    if (h.total) { sumPct += h.percent; counted++; }
  }
  const avg = counted ? Math.round(sumPct / counted) : 0;
  $("#adherence-summary").textContent = counted
    ? `최근 ${counted}일 평균 순응도 약 ${avg}%. 꾸준함이 가장 중요합니다.`
    : "아직 기록이 없습니다. ‘오늘’ 탭에서 복용을 체크하면 그래프가 채워집니다.";
}

function renderDevice() {
  const specBox = $("#device-spec");
  specBox.innerHTML = `<h3 style="margin-top:0">주요 사양</h3><ul>${
    state.device.spec.map((s) => `<li><strong>${escapeHtml(s.label)}</strong>: ${escapeHtml(s.value)}</li>`).join("")
  }</ul>`;
  const tbody = $("#bom-table tbody");
  tbody.innerHTML = state.device.bom.map((b) =>
    `<tr><td>${escapeHtml(b.part)}</td><td>${escapeHtml(b.spec)}</td><td>${b.qty}</td><td>${escapeHtml(b.cost)}</td></tr>`
  ).join("");
}

function renderAll() {
  renderToday();
  renderMedList();
  renderWarnings();
  renderAdherence();
}

/* ---------- 폼: 시간대/요일 칩 ---------- */
function buildChoices() {
  const slotBox = $("#slot-choices");
  slotBox.innerHTML = SLOTS.map((s) =>
    `<button type="button" class="chip" data-slot="${s.key}">${s.label}</button>`).join("");
  const dayBox = $("#day-choices");
  dayBox.innerHTML = DAY_KEYS.map((k) =>
    `<button type="button" class="chip selected" data-day="${k}">${DAY_LABELS[k]}</button>`).join("");
  $$(".chip", slotBox).forEach((c) => c.addEventListener("click", () => c.classList.toggle("selected")));
  $$(".chip", dayBox).forEach((c) => c.addEventListener("click", () => c.classList.toggle("selected")));
}

function handleAddMed(e) {
  e.preventDefault();
  const name = $("#f-name").value.trim();
  if (!name) return;
  const dose = $("#f-dose").value.trim();
  const ingredients = $("#f-ing").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const slots = $$("#slot-choices .chip.selected").map((c) => c.dataset.slot);
  const days = $$("#day-choices .chip.selected").map((c) => c.dataset.day);
  if (slots.length === 0) { alert("시간대를 하나 이상 선택하세요."); return; }
  if (days.length === 0) { alert("요일을 하나 이상 선택하세요."); return; }
  state.meds.push({
    id: "m-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, dose, ingredients, slots, days,
  });
  persistMeds();
  e.target.reset();
  $$("#slot-choices .chip").forEach((c) => c.classList.remove("selected"));
  $$("#day-choices .chip").forEach((c) => c.classList.add("selected"));
  renderAll();
}

function persistMeds() { lsSet(LS_MEDS, state.meds); }

/* ---------- 알림 (Notification API) ---------- */
function updateNotifState() {
  const el = $("#notif-state");
  if (!("Notification" in window)) { el.textContent = "알림 상태: 이 브라우저는 알림 미지원"; return; }
  el.textContent = "알림 상태: " + ({ granted: "허용됨 ✅", denied: "차단됨 ❌", default: "미설정" }[Notification.permission] || Notification.permission);
}

async function requestNotif() {
  if (!("Notification" in window)) { alert("이 브라우저는 알림을 지원하지 않습니다."); return; }
  try {
    const perm = await Notification.requestPermission();
    updateNotifState();
    if (perm === "granted") beep();
  } catch { updateNotifState(); }
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine"; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.7);
    o.start(); o.stop(audioCtx.currentTime + 0.72);
  } catch { /* 무음 폴백 */ }
}

// 매 분 due 발생을 확인해 알림/소리 발생 (중복 방지)
function checkDueReminders() {
  const d = now();
  const dk = dateKey(d);
  const occ = occurrencesForDate(state.meds, d);
  const statusList = statusForOccurrences(occ, d, state.taken, dk, 0);
  const due = dueNow(statusList);
  for (const o of due) {
    if (state.notifiedKeys.has(o.key)) continue;
    // due 상태는 지난 60분 내이므로, 정확히 그 분에만 새로 알린다.
    if (o.minutes !== d.getHours() * 60 + d.getMinutes()) continue;
    state.notifiedKeys.add(o.key);
    beep();
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("💊 복약 시간입니다", { body: `${o.name} ${o.dose} · ${o.slotLabel}`, tag: o.key });
      } catch { /* 무시 */ }
    }
  }
}

/* ---------- AI ---------- */
function aiPayload(extra = {}) {
  return { meds: state.meds, table: state.rules, ...extra };
}
function addMsg(role, text) {
  const box = $("#ai-chat");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
async function runChat(question) {
  addMsg("user", question);
  const out = addMsg("ai", "…");
  try {
    let acc = "";
    await askAI("chat", aiPayload({ question }), {
      onToken: (t) => { acc += t; out.textContent = acc; $("#ai-chat").scrollTop = 1e9; },
    });
    if (!acc) out.textContent = "(응답 없음)";
  } catch (err) {
    out.textContent = "AI 오류: " + (err && err.message || err);
  }
}
async function runOptimize() {
  addMsg("user", "복약 스케줄 최적화 제안");
  const out = addMsg("ai", "…");
  try {
    out.textContent = await askAI("optimize", aiPayload());
  } catch (err) { out.textContent = "AI 오류: " + (err && err.message || err); }
}
async function runExplain() {
  const outEl = $("#explain-out");
  outEl.hidden = false;
  outEl.textContent = "설명 생성 중…";
  const warnings = analyzeMeds(state.meds, state.rules);
  try {
    outEl.textContent = await askAI("explain", aiPayload({ warnings }));
  } catch (err) { outEl.textContent = "AI 오류: " + (err && err.message || err); }
}

/* ---------- 탭 ---------- */
function switchTab(name) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name));
  $$(".tab-panel").forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
}

/* ---------- 환경설정 (테마/큰 글씨) ---------- */
function applyPrefs() {
  const root = document.documentElement;
  if (state.prefs.theme === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", state.prefs.theme);
  root.style.setProperty("--font-scale", state.prefs.large ? "1.25" : "1");
  const lb = $("#btn-large");
  if (lb) lb.setAttribute("aria-pressed", state.prefs.large ? "true" : "false");
}
function toggleTheme() {
  const order = ["auto", "light", "dark"];
  const i = order.indexOf(state.prefs.theme);
  state.prefs.theme = order[(i + 1) % order.length];
  lsSet(LS_PREFS, state.prefs);
  applyPrefs();
}
function toggleLarge() {
  state.prefs.large = !state.prefs.large;
  lsSet(LS_PREFS, state.prefs);
  applyPrefs();
}

/* ---------- utils ---------- */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------- 초기화 ---------- */
async function init() {
  // prefs
  state.prefs = { ...state.prefs, ...lsGet(LS_PREFS, {}) };
  applyPrefs();

  // 규칙/디바이스 데이터
  try { state.rules = await loadJSON("./data/interactions.json"); } catch { /* 폴백 유지 */ }
  try { state.device = await loadJSON("./data/device.json"); } catch { /* 폴백 유지 */ }

  // meds: 저장된 값 없으면 시드 로드
  const savedMeds = lsGet(LS_MEDS, null);
  state.meds = Array.isArray(savedMeds) ? savedMeds : await loadSeedMeds();
  if (!Array.isArray(savedMeds)) persistMeds();

  state.taken = new Set(lsGet(LS_TAKEN, []));

  buildChoices();
  renderDevice();
  renderAll();
  updateNotifState();

  // 이벤트 배선
  $$(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#med-form").addEventListener("submit", handleAddMed);
  $("#btn-notif").addEventListener("click", requestNotif);
  $("#btn-theme").addEventListener("click", toggleTheme);
  $("#btn-large").addEventListener("click", toggleLarge);
  $("#btn-explain").addEventListener("click", runExplain);
  $("#btn-optimize").addEventListener("click", runOptimize);
  $("#btn-reset-demo").addEventListener("click", async () => {
    if (!confirm("현재 목록을 지우고 데모 데이터를 다시 불러올까요?")) return;
    state.meds = await loadSeedMeds();
    persistMeds(); renderAll();
  });
  $("#btn-clear-all").addEventListener("click", () => {
    if (!confirm("등록된 모든 약을 삭제할까요?")) return;
    state.meds = []; persistMeds(); renderAll();
  });
  $("#ai-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const inp = $("#ai-input");
    const q = inp.value.trim();
    if (!q) return;
    inp.value = "";
    runChat(q);
  });
  $$(".ai-quick .chip[data-q]").forEach((c) =>
    c.addEventListener("click", () => runChat(c.dataset.q)));

  // 인사말
  addMsg("ai", "안녕하세요! 복약 관리 도우미입니다. 궁금한 점을 물어보세요. (※ 의학적 조언이 아닙니다)");

  // 알림 타이머 (매 30초 체크)
  checkDueReminders();
  setInterval(() => { renderToday(); checkDueReminders(); }, 30000);
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

// 테스트용 export (check.mjs 에서 사용하지 않지만 재사용 가능)
export { state, escapeHtml };
