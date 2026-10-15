/**
 * The W043 whole-record re-validation tests: a sealed CommissionedBody
 * re-proves EVERY law from its own recorded data — and every tamper is
 * caught at the exact law (identity, scope, binding, R052 measured
 * evidence, manifest honesty, the W032 unattached attachment, the
 * possession digest, the lineage anchor, W034's chain verification, the
 * commissioned generation, the declared-time provenance).
 *
 * Run: pnpm --filter body-forge test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionBody } from "../commission.js";
import { validateCommissionedBody } from "../validate.js";
import type { CommissionedBody } from "../contracts.js";
import type { PossessionLineage } from "possession";
import { commissioningFixture } from "./fixtures.js";

function codesOf(outcome: { readonly errors: readonly { readonly code: string }[] }): string[] {
  return outcome.errors.map((error) => error.code);
}

function sealed(): CommissionedBody {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  if (!outcome.ok) {
    throw new Error(`validate fixture commissioning failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.body;
}

test("a sealed record re-validates whole-record (ok, every law checked)", () => {
  const validation = validateCommissionedBody(sealed());
  assert.equal(validation.ok, true);
  assert.equal(validation.checked.length, 10);
});

test("a forged commissioned id is refused (identity-mismatch)", () => {
  const record = sealed();
  const tampered: CommissionedBody = { ...record, commissionedId: "commission-deadbeef" as CommissionedBody["commissionedId"] };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("identity-mismatch"));
});

test("an id that no longer matches its recorded provenance is refused (identity-mismatch)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    provenance: { ...record.provenance, selectionId: "selection-other" as CommissionedBody["provenance"]["selectionId"] },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("identity-mismatch"));
});

test("a scope disagreement between the record and its own body is refused", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    scope: { ...record.scope, worldId: "world-commissioning-other" },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("scope-mismatch"));
});

test("a binding that names another substrate than the record's is refused (R050)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    substrateBinding: { ...record.substrateBinding, selectedSubstrateId: "substrate-mean-reversion-mind" },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("binding-mismatch"));
});

test("a binding carrying NO measured citation is refused (R052 named)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    substrateBinding: { ...record.substrateBinding, totalCarriedCitations: 0 },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const unmeasured = validation.errors.find((error) => error.code === "unmeasured-commission");
  assert.ok(unmeasured !== undefined);
  assert.match(unmeasured.message, /R052/);
});

test("a sealed manifest that lies about its citation count is refused", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    endowment: { ...record.endowment, totalEvidenceCitations: 99 },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-endowment"));
});

test("an attachment that claims to be already bound is refused (the world binding is W044's act)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    attachment: { ...record.attachment, state: "attached" as CommissionedBody["attachment"]["state"] },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const invalid = validation.errors.find((error) => error.code === "invalid-attachment");
  assert.ok(invalid !== undefined);
  assert.match(invalid.message, /W044/);
});

test("an edited possession declaration is refused (possession-digest-mismatch)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    possession: { ...record.possession, possessionDigest: "deadbeef" },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const codes = codesOf(validation);
  assert.ok(codes.includes("possession-digest-mismatch"));
});

test("a forged lineage anchor is refused (lineage-anchor-mismatch)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    possession: { ...record.possession, lineageAnchor: "deadbeef" },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const codes = codesOf(validation);
  assert.ok(codes.includes("lineage-anchor-mismatch"));
  assert.ok(codes.includes("identity-mismatch"));
});

test("a commissioned head that is not the lineage's head is refused (head-mismatch)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    possession: { ...record.possession, commissionedHead: "deadbeef" },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("head-mismatch"));
});

test("an edited lineage entry is refused (W034 verification catches the tamper at the exact index)", () => {
  const record = sealed();
  const entries = record.possession.lineage.entries.map((entry, index) =>
    index === record.possession.lineage.entries.length - 1
      ? { ...entry, recordedAt: 12345 as PossessionLineage["entries"][number]["recordedAt"] }
      : entry,
  );
  const lineage: PossessionLineage = { ...record.possession.lineage, entries };
  const tampered: CommissionedBody = {
    ...record,
    possession: { ...record.possession, lineage },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const broken = validation.errors.find((error) => error.code === "lineage-broken");
  assert.ok(broken !== undefined);
  assert.match(broken.message, /entry-digest-mismatch/);
});

test("a truncated lineage is refused (head + commissioned generation, together)", () => {
  const record = sealed();
  const lineage: PossessionLineage = { ...record.possession.lineage, entries: [] };
  const tampered: CommissionedBody = {
    ...record,
    possession: { ...record.possession, lineage },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const codes = codesOf(validation);
  // The truncation breaks W034's own head recomputation (carried as
  // lineage-broken) and leaves no commissioned generation at all.
  assert.ok(codes.includes("lineage-broken"));
  assert.ok(codes.includes("commissioned-generation-mismatch"));
  const broken = validation.errors.find((error) => error.code === "lineage-broken");
  assert.ok(broken !== undefined);
  assert.match(broken.message, /head/);
});

test("a provenance time that is not the grant's declared grantedAt is refused (no clocks)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    provenance: { ...record.provenance, commissionedAt: 42 },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  const invalid = validation.errors.find((error) => error.code === "invalid-provenance");
  assert.ok(invalid !== undefined);
  assert.match(invalid.message, /never a clock read/);
});

test("a blank endowment entry is refused (invalid-endowment)", () => {
  const record = sealed();
  const tampered: CommissionedBody = {
    ...record,
    endowment: {
      ...record.endowment,
      entries: [...record.endowment.entries, { skillId: "" as CommissionedBody["endowment"]["entries"][number]["skillId"], capabilityId: "cap-x" as CommissionedBody["endowment"]["entries"][number]["capabilityId"], evidenceTrajectoryIds: [] }],
    },
  };
  const validation = validateCommissionedBody(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-endowment"));
});
