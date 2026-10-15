/**
 * The claim-registry tests (W038): claims are DECLARED before they are
 * checked — completeness, determinism, and the needles law.
 *
 * Run: cd packages/verification && ../../../node_modules/.bin/tsx --test test/*.test.ts
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_KINDS, declareEvaluationClaims } from "../claims.js";
import { bundleOf, fixturePolicy } from "./fixtures.js";

test("the registry declares one claim per declared integrity requirement", () => {
  const bundle = bundleOf();
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const ids = claims.map((claim) => claim.claimId);
  assert.ok(ids.includes("evidence-chain"));
  assert.ok(ids.includes("deterministic-replay"));
});

test("the §13 search-history claim is ALWAYS declared — even when the policy omits it", () => {
  const bundle = bundleOf(); // integrity: evidence-chain + deterministic-replay only
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const searchHistory = claims.find((claim) => claim.claimId === "search-history");
  assert.ok(searchHistory !== undefined);
  assert.equal(searchHistory.kind, "search-history");
  assert.match(searchHistory.declarationSource, /NOT declared by this policy/);
});

test("when the policy declares search-history, the claim cites the policy's own declaration", () => {
  const bundle = bundleOf(["evidence-chain", "deterministic-replay", "search-history"]);
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const searchHistory = claims.filter((claim) => claim.claimId === "search-history");
  assert.equal(searchHistory.length, 1); // deduplicated — one claim, never two
  assert.match(searchHistory[0]?.declarationSource ?? "", /carried on the manifest/);
});

test("one holdout-coverage claim per DECLARED policy axis, carrying the axis id", () => {
  const bundle = bundleOf();
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const holdout = claims.filter((claim) => claim.kind === "holdout-coverage");
  assert.deepEqual(
    holdout.map((claim) => claim.axisId),
    ["h-1", "h-2"],
  );
  for (const claim of holdout) {
    assert.deepEqual(claim.evidenceNeedles, [claim.axisId ?? "", "split"]);
  }
});

test("the constraint-dimension claim is always declared (§13 is not optional)", () => {
  const bundle = bundleOf();
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const dimension = claims.find((claim) => claim.claimId === "constraint-dimension");
  assert.ok(dimension !== undefined);
  assert.match(dimension?.declarationSource ?? "", /never the sole objective/);
  assert.deepEqual(dimension?.evidenceNeedles, ["compliance", "components"]);
});

test("every claim id is unique and every needle set is non-empty", () => {
  const bundle = bundleOf();
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  assert.equal(new Set(claims.map((claim) => claim.claimId)).size, claims.length);
  for (const claim of claims) {
    assert.ok(claim.evidenceNeedles.length > 0);
    for (const needle of claim.evidenceNeedles) {
      assert.ok(needle.length > 0);
    }
  }
});

test("A9: the registry is deterministic — twin declaration is deep-equal", () => {
  const bundle = bundleOf();
  assert.deepEqual(
    declareEvaluationClaims(bundle.manifest, bundle.policy),
    declareEvaluationClaims(bundle.manifest, bundle.policy),
  );
});

test("CLAIM_KINDS is the closed canonical kind table", () => {
  assert.deepEqual(CLAIM_KINDS, [
    "evidence-chain",
    "deterministic-replay",
    "search-history",
    "holdout-coverage",
    "constraint-dimension",
  ]);
});

test("a policy with only search-history declared still yields the always-claims", () => {
  const policy = fixturePolicy(["search-history"]);
  const bundle = bundleOf(["search-history"]);
  const claims = declareEvaluationClaims(bundle.manifest, policy);
  assert.deepEqual(
    claims.map((claim) => claim.claimId).filter((id) => id !== "holdout-coverage:h-1" && id !== "holdout-coverage:h-2"),
    ["search-history", "constraint-dimension"],
  );
});
