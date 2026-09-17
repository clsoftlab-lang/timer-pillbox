// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// schedule.js — 순수(pure) 복약 스케줄 엔진.
// DOM·전역상태·Date.now() 의존 없음. 시각은 인자로 주입. 결정론적.

/** 시간대(slot) 정의 — 기본 알림 시각(HH:MM). */
export const SLOTS = [
  { key: "morning", label: "아침", time: "08:00" },
  { key: "lunch", label: "점심", time: "12:30" },
  { key: "evening", label: "저녁", time: "18:30" },
  { key: "bedtime", label: "취침", time: "22:00" },
];

/** 요일 키 (0=일요일 기준 JS getDay 매핑). */
export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS = {
  sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토",
};

/** slot key → 라벨. */
export function slotLabel(key) {
  const s = SLOTS.find((x) => x.key === key);
  return s ? s.label : key;
}

/** slot key → 기본 시각 "HH:MM". */
export function slotTime(key) {
  const s = SLOTS.find((x) => x.key === key);
  return s ? s.time : "09:00";
}

/** "HH:MM" → 분(minutes). 잘못된 값은 0. */
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return 0;
  const h = Math.min(23, parseInt(m[1], 10));
  const mm = Math.min(59, parseInt(m[2], 10));
  return h * 60 + mm;
}

/** Date → 요일 키. */
export function dayKeyOf(date) {
  return DAY_KEYS[date.getDay()];
}

/** YYYY-MM-DD (로컬) 문자열. */
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 특정 날짜에 복용해야 하는 (med, slot) 목록을 시간순으로 생성.
 * @param {Array<object>} meds
 * @param {Date} date
 * @returns {Array<{medId,name,dose,slot,slotLabel,time,minutes}>}
 */
export function occurrencesForDate(meds, date) {
  const dk = dayKeyOf(date);
  const list = Array.isArray(meds) ? meds : [];
  const out = [];
  for (const med of list) {
    if (!med) continue;
    const days = Array.isArray(med.days) && med.days.length
      ? med.days
      : DAY_KEYS; // days 없으면 매일
    if (!days.includes(dk)) continue;
    const slots = Array.isArray(med.slots) ? med.slots : [];
    for (const slot of slots) {
      const time = (med.times && med.times[slot]) || slotTime(slot);
      out.push({
        medId: med.id,
        name: med.name,
        dose: med.dose || "",
        slot,
        slotLabel: slotLabel(slot),
        time,
        minutes: toMinutes(time),
      });
    }
  }
  out.sort((a, b) => a.minutes - b.minutes || String(a.medId).localeCompare(String(b.medId)));
  return out;
}

/**
 * 발생(occurrence)의 고유 키 — 기록 매칭용.
 */
export function occurrenceKey(dateKeyStr, medId, slot) {
  return `${dateKeyStr}|${medId}|${slot}`;
}

/**
 * 지금(now) 기준으로 각 발생의 상태를 계산.
 * @param {Array} occurrences occurrencesForDate 결과
 * @param {Date} now
 * @param {Set<string>} takenKeys 복용 완료 키 집합
 * @param {string} dkForKeys 발생들의 날짜 키
 * @param {number} graceMin due 판정 유예(분), 기본 0
 * @returns {Array} status: "taken" | "due" | "upcoming" | "missed"
 */
export function statusForOccurrences(occurrences, now, takenKeys, dkForKeys, graceMin = 0) {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const taken = takenKeys instanceof Set ? takenKeys : new Set(takenKeys || []);
  return (occurrences || []).map((o) => {
    const key = occurrenceKey(dkForKeys, o.medId, o.slot);
    let status;
    if (taken.has(key)) status = "taken";
    else if (o.minutes > nowMin + graceMin) status = "upcoming";
    else if (o.minutes >= nowMin - 60) status = "due"; // 지난 60분 이내면 '복용 시간'
    else status = "missed";
    return { ...o, key, status };
  });
}

/**
 * 특정 시각에 '지금 알려야 하는' 발생만 반환 (due, 미복용).
 * @param {Array} statusList statusForOccurrences 결과
 */
export function dueNow(statusList) {
  return (statusList || []).filter((o) => o.status === "due");
}

/**
 * 오늘의 진행률(%) 계산.
 * @param {Array} statusList
 * @returns {{total:number, taken:number, percent:number}}
 */
export function progressOf(statusList) {
  const total = (statusList || []).length;
  const taken = (statusList || []).filter((o) => o.status === "taken").length;
  const percent = total === 0 ? 0 : Math.round((taken / total) * 100);
  return { total, taken, percent };
}

/**
 * 순응도(adherence) 이력 계산 — 최근 N일.
 * @param {Array<object>} meds
 * @param {Set<string>|Array<string>} takenKeys 전체 복용 기록 키
 * @param {Date} today
 * @param {number} days
 * @returns {Array<{date,total,taken,percent}>} 과거→오늘 순
 */
export function adherenceHistory(meds, takenKeys, today, days = 7) {
  const taken = takenKeys instanceof Set ? takenKeys : new Set(takenKeys || []);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const dk = dateKey(d);
    const occ = occurrencesForDate(meds, d);
    const total = occ.length;
    let done = 0;
    for (const o of occ) {
      if (taken.has(occurrenceKey(dk, o.medId, o.slot))) done++;
    }
    out.push({
      date: dk,
      total,
      taken: done,
      percent: total === 0 ? 0 : Math.round((done / total) * 100),
    });
  }
  return out;
}

/**
 * 스케줄 최적화 제안(결정론적, 순수) — meds 목록을 시간대별로 묶고
 * 한 시간대에 몰린 약 수/상호작용 성분을 근거로 재배치 힌트를 만든다.
 * AI MockProvider 및 UI가 공유한다.
 * @param {Array<object>} meds
 * @returns {{bySlot:object, tips:string[]}}
 */
export function suggestSchedule(meds) {
  const list = Array.isArray(meds) ? meds : [];
  const bySlot = { morning: [], lunch: [], evening: [], bedtime: [] };
  for (const med of list) {
    for (const slot of (med.slots || [])) {
      if (bySlot[slot]) bySlot[slot].push(med.name);
    }
  }
  const tips = [];
  for (const s of SLOTS) {
    const n = bySlot[s.key].length;
    if (n >= 3) {
      tips.push(`${s.label} 시간대에 약이 ${n}개 몰려 있습니다. 일부를 다른 시간대로 나누면 잊을 확률이 줄어듭니다.`);
    }
  }
  if (bySlot.morning.length === 0 && list.length > 0) {
    tips.push("아침 시간대에 배정된 약이 없습니다. 하루 리듬을 잡기 좋은 아침 복용을 고려해 보세요.");
  }
  if (tips.length === 0) {
    tips.push("현재 시간대 배분이 비교적 고르게 분산되어 있습니다.");
  }
  return { bySlot, tips };
}
