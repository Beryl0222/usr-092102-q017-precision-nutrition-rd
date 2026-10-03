import assert from "node:assert/strict";
import test from "node:test";

import { analyzeClaimGap, evidenceSupportsClaim, populationContains } from "../src/evidence.js";
import { reviewClaim } from "../src/claims.js";

const humanEvidence = {
  evidence_id: "EV-H1",
  level: "human",
  population: { age_min: 18, age_max: 65, tags: ["健康成人"] },
  dose: { min: 2, max: 6, unit: "g/day" },
  observation: { min_days: 28, max_days: 84 },
};

const labEvidence = {
  evidence_id: "EV-L1",
  level: "lab",
  population: { age_min: 0, age_max: 120, tags: [] },
  dose: { min: 1, max: 10, unit: "g/day" },
  observation: { min_days: 0, max_days: 365 },
};

const claim = {
  claim_id: "CL-1",
  claim_type: "health_claim",
  population: { age_min: 30, age_max: 50, tags: ["健康成人"] },
  dose: { amount: 4, unit: "g/day" },
  duration_days: 56,
};

test("人群包含判定", () => {
  assert.equal(populationContains({ age_min: 18, age_max: 65, tags: ["健康成人"] }, { age_min: 30, age_max: 50, tags: ["健康成人"] }), true);
  assert.equal(populationContains({ age_min: 18, age_max: 65, tags: [] }, { age_min: 30, age_max: 50, tags: ["孕妇"] }), false);
  assert.equal(populationContains({ age_min: 18, age_max: 65, tags: [] }, { age_min: 10, age_max: 50, tags: [] }), false);
});

test("证据只在人群、剂量、观察期边界内支持主张", () => {
  assert.deepEqual(evidenceSupportsClaim(humanEvidence, claim), { supported: true, reasons: [] });

  const outOfDose = { ...claim, dose: { amount: 10, unit: "g/day" } };
  const r1 = evidenceSupportsClaim(humanEvidence, outOfDose);
  assert.equal(r1.supported, false);
  assert.ok(r1.reasons.some((r) => r.includes("剂量")));

  const outOfDuration = { ...claim, duration_days: 180 };
  const r2 = evidenceSupportsClaim(humanEvidence, outOfDuration);
  assert.equal(r2.supported, false);
  assert.ok(r2.reasons.some((r) => r.includes("观察期")));

  const outOfPopulation = { ...claim, population: { age_min: 12, age_max: 30, tags: [] } };
  const r3 = evidenceSupportsClaim(humanEvidence, outOfPopulation);
  assert.equal(r3.supported, false);
  assert.ok(r3.reasons.some((r) => r.includes("人群")));
});

test("实验室证据不得替代人体证据支持健康宣称", () => {
  const gap = analyzeClaimGap(claim, [labEvidence]);
  assert.equal(gap.satisfied, false);
  assert.deepEqual(gap.missing_levels, ["human"]);

  const review = reviewClaim(claim, [labEvidence]);
  assert.equal(review.status, "insufficient_evidence");
  assert.deepEqual(review.missing_levels, ["human"]);
});

test("人体证据齐全时主张获批；证据在边界外时主张被拒", () => {
  assert.equal(reviewClaim(claim, [humanEvidence, labEvidence]).status, "approved");

  const wideClaim = { ...claim, dose: { amount: 20, unit: "g/day" } };
  assert.equal(reviewClaim(wideClaim, [humanEvidence]).status, "rejected");
});
