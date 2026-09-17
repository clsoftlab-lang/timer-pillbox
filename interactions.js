// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// interactions.js — 순수(pure) 상호작용/중복 경고 엔진.
// DOM·전역상태 없음. 입력만으로 결정론적 출력. NOT medical advice.

/**
 * 성분 문자열 정규화 (소문자/공백 제거).
 * @param {string} s
 * @returns {string}
 */
export function normIngredient(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/**
 * med 객체에서 성분 배열을 안전하게 추출한다.
 * @param {object} med
 * @returns {string[]}
 */
export function ingredientsOf(med) {
  if (!med || !Array.isArray(med.ingredients)) return [];
  return med.ingredients.map(normIngredient).filter(Boolean);
}

/**
 * 두 성분 집합이 규칙 (a,b)에 매칭되는지 (순서 무관).
 */
function pairMatches(setX, setY, a, b) {
  const na = normIngredient(a);
  const nb = normIngredient(b);
  return (
    (setX.has(na) && setY.has(nb)) || (setX.has(nb) && setY.has(na))
  );
}

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 };

/**
 * 두 약 사이의 쌍(pair) 상호작용 경고를 계산.
 * @param {object} medA
 * @param {object} medB
 * @param {{rules?: Array}} table
 * @returns {Array<object>}
 */
export function checkPair(medA, medB, table) {
  const rules = (table && Array.isArray(table.rules)) ? table.rules : [];
  const setA = new Set(ingredientsOf(medA));
  const setB = new Set(ingredientsOf(medB));
  const out = [];
  for (const rule of rules) {
    if (!rule || rule.a == null || rule.b == null) continue;
    if (pairMatches(setA, setB, rule.a, rule.b)) {
      out.push({
        type: "interaction",
        ruleId: rule.id || `${rule.a}-${rule.b}`,
        severity: rule.severity || "medium",
        message: rule.message || "상호작용 가능성이 있습니다.",
        advice: rule.advice || "",
        meds: [medA.name, medB.name],
      });
    }
  }
  return out;
}

/**
 * 등록된 모든 약에 대해 상호작용 + 중복 경고를 계산한다.
 * @param {Array<object>} meds
 * @param {{rules?: Array, duplicateGroups?: Array}} table
 * @returns {Array<object>} 심각도 내림차순 정렬된 경고 목록
 */
export function analyzeMeds(meds, table) {
  const list = Array.isArray(meds) ? meds.filter(Boolean) : [];
  const warnings = [];

  // 1) 쌍 상호작용
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const pairs = checkPair(list[i], list[j], table);
      for (const p of pairs) warnings.push(p);
    }
  }

  // 2) 중복 계열 (duplicateGroups)
  const groups = (table && Array.isArray(table.duplicateGroups))
    ? table.duplicateGroups : [];
  for (const g of groups) {
    if (!g || !Array.isArray(g.ingredients)) continue;
    const groupSet = new Set(g.ingredients.map(normIngredient));
    const hits = list.filter((m) =>
      ingredientsOf(m).some((ing) => groupSet.has(ing))
    );
    if (hits.length >= 2) {
      warnings.push({
        type: "duplicate",
        ruleId: g.id || "dup",
        severity: g.severity || "medium",
        message: g.message || `${g.label || "동일 계열"} 중복 복용 가능성.`,
        advice: g.advice || "",
        meds: hits.map((m) => m.name),
      });
    }
  }

  // 심각도 내림차순, 동률이면 ruleId 사전순 (결정론적)
  warnings.sort((x, y) => {
    const d = (SEVERITY_ORDER[y.severity] || 0) - (SEVERITY_ORDER[x.severity] || 0);
    if (d !== 0) return d;
    return String(x.ruleId).localeCompare(String(y.ruleId));
  });
  return warnings;
}

/**
 * 경고 목록에서 최고 심각도를 반환. 없으면 "none".
 */
export function highestSeverity(warnings) {
  let best = 0;
  let label = "none";
  for (const w of warnings || []) {
    const v = SEVERITY_ORDER[w.severity] || 0;
    if (v > best) { best = v; label = w.severity; }
  }
  return label;
}
