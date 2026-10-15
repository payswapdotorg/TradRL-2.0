/**
 * The §10 evidence-chain validation laws (W036) — the fail-closed gate every
 * evaluation seam runs first.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentSessionTelemetry } from "agent-world-protocol";
import type { AccountId, CurrencyCode, DecimalString, TimestampMs, WorldId } from "tradrl-world-contracts";
import type { ViewDigest } from "tradrl-world-contracts/cognitiveSubstrate";
import {
  evidenceStreamOfSession,
  renderMoney,
  validateEvidenceStream,
} from "../evidence.js";
import {
  canonicalStream,
  passRecord,
  portfolio,
  riskState,
  settledCapsule,
  streamOf,
} from "./fixtures.js";

test("the canonical stream validates clean (identity, ordering, money text)", () => {
  const outcome = validateEvidenceStream(canonicalStream());
  assert.ok(outcome.ok);
});

test("an empty stream never silently scores (empty-stream)", () => {
  const outcome = validateEvidenceStream(streamOf([]));
  assert.ok(!outcome.ok);
  const error = outcome.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "empty-stream");
});

test("pass numbers must strictly increase (pass-out-of-order)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule({ pass: 2, observedAt: 2000 }, { asOf: 2100, riskState: riskState() }),
      settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100, riskState: riskState() }),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "pass-out-of-order"));
});

test("the resulting state cannot precede the observation (state-precedes-action)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule(
        { pass: 1, observedAt: 1000 },
        { asOf: 500, portfolio: portfolio({ equity: "100000" }) },
      ),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "state-precedes-action"));
});

test("a non-finite settled instant fails closed (non-finite-as-of)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule(
        { pass: 1, observedAt: 1000 },
        { asOf: Number.NaN, portfolio: portfolio({ equity: "100000" }) },
      ),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "non-finite-as-of"));
});

test("every decision must cite the view its pass observed (decision-view-mismatch)", () => {
  const capsule = settledCapsule(
    {
      pass: 1,
      observedAt: 1000,
      decisions: [
        { decisionId: "d-1", orderKind: "market", side: "buy", quantity: "1", issuedAt: 1000 },
      ],
    },
    { asOf: 1100, portfolio: portfolio({ equity: "100000" }) },
  );
  const decision = capsule.pass.stream.decisions[0];
  assert.ok(decision !== undefined);
  const mismatched = {
    ...capsule,
    pass: {
      ...capsule.pass,
      stream: {
        ...capsule.pass.stream,
        decisions: [{ ...decision, viewDigest: "not-the-observed-view" as ViewDigest }],
      },
    },
  };
  const outcome = validateEvidenceStream(streamOf([mismatched]));
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "decision-view-mismatch"));
});

test("the resulting state must be the observed account (account-mismatch)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule(
        { pass: 1, observedAt: 1000 },
        { asOf: 1100, portfolio: portfolio({ equity: "100000", accountId: "acct-other" as AccountId }) },
      ),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "account-mismatch"));
});

test("the resulting state must be the stream's world (world-mismatch)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule(
        { pass: 1, observedAt: 1000 },
        { asOf: 1100, portfolio: portfolio({ equity: "100000", worldId: "world-beta" as WorldId }) },
      ),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "world-mismatch"));
});

test("an empty resulting state is malformed evidence (empty-resulting-state)", () => {
  const outcome = validateEvidenceStream(
    streamOf([settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100 })]),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "empty-resulting-state"));
});

test("non-canonical decimal text fails closed (malformed-decimal)", () => {
  const outcome = validateEvidenceStream(
    streamOf([
      settledCapsule(
        { pass: 1, observedAt: 1000 },
        { asOf: 1100, portfolio: portfolio({ equity: "1e5" }) },
      ),
    ]),
  );
  assert.ok(!outcome.ok);
  assert.ok(
    outcome.errors.some((entry) => entry.code === "malformed-decimal"),
    "the exponent-form equity must be refused as malformed decimal text",
  );
});

test("the session builder pairs one state per pass, or fails typed (state-count-mismatch)", () => {
  // Minimal telemetry: only `passes` participates in the pairing law (the
  // other lifecycle fields are not read by this seam).
  const telemetry = {
    passes: [passRecord({ pass: 1, observedAt: 1000 })],
  } as unknown as AgentSessionTelemetry;
  const mismatch = evidenceStreamOfSession(telemetry, []);
  assert.ok(!mismatch.ok);
  const error = mismatch.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "state-count-mismatch");

  const paired = evidenceStreamOfSession(telemetry, [
    { asOf: 1100 as TimestampMs, riskState: riskState() },
  ]);
  assert.ok(paired.ok);
  assert.equal(paired.stream.capsules.length, 1);
});

test("renderMoney renders money deterministically (record rendering only)", () => {
  assert.equal(
    renderMoney({ amount: "101.25" as DecimalString, currency: "USD" as CurrencyCode }),
    "USD 101.25",
  );
});
