/**
 * Shared deterministic fixtures for the evaluation-splits tests (W052).
 *
 * Families are built through the REAL construction gate
 * (`buildSplitFamily`) — zero fixture drift — over the REAL W050 test
 * fixture constants (the W041 fixture lineage, imported directly: the
 * shared scope + the shared epoch), assembled ONCE per call so every test
 * sees the same content-addressed families (A9).
 */

import type { TimeMachineScope } from "tradrl-time-machine";
import { MINUTE, PROJECT, T0, TENANT, WORLD } from "../../tradrl-time-machine/test/fixtures.js";
import { buildSplitFamily } from "../index.js";
import type {
  SplitFamily,
  SplitFamilyInput,
  SplitInstrumentId,
  SplitTimestampMs,
} from "../index.js";

export const SCOPE: TimeMachineScope = {
  tenantId: TENANT,
  projectId: PROJECT,
  worldId: WORLD,
};

export const DAY = 24 * 60 * MINUTE;

/** A clean ten-day walk-forward range: 2-day train, 1-day evaluation → 8 folds. */
export const WF_FROM = T0 as SplitTimestampMs;
export const WF_TO = (T0 + 10 * DAY - 1) as SplitTimestampMs;
export const WF_TRAIN = 2 * DAY;
export const WF_EVAL = 1 * DAY;

/** Declared deliberately NON-canonically (order never matters — A9). */
export const REGIME_IDS = ["regime-volatile", "regime-calm", "regime-crisis", "regime-mania"];

export const ASSET_IDS: readonly SplitInstrumentId[] = [
  "ETH-USD" as SplitInstrumentId,
  "BTC-USD" as SplitInstrumentId,
  "SOL-USD" as SplitInstrumentId,
];

export const VENUE_IDS = ["venue-nyse", "venue-cme", "venue-coinbase"];

function buildOrThrow(input: SplitFamilyInput): SplitFamily {
  const outcome = buildSplitFamily(input);
  if (!outcome.ok) {
    throw new Error(`fixture family failed to build: ${outcome.errors.map((e) => e.message).join("; ")}`);
  }
  return outcome.family;
}

export function aWalkForwardFamily(): SplitFamily {
  return buildOrThrow({
    scope: SCOPE,
    kind: "walk-forward",
    range: { from: WF_FROM, to: WF_TO },
    policy: {
      kind: "walk-forward",
      axisId: "axis-wf",
      trainWindowMs: WF_TRAIN,
      evaluationWindowMs: WF_EVAL,
    },
  });
}

export function aRegimeFamily(): SplitFamily {
  return buildOrThrow({
    scope: SCOPE,
    kind: "regime",
    range: { from: WF_FROM, to: WF_TO },
    universe: { kind: "regime", regimeIds: REGIME_IDS },
    policy: {
      kind: "regime",
      axisId: "axis-regime",
      rule: { kind: "tail-holdout", evaluationCount: 1 },
    },
  });
}

export function anAssetFamily(): SplitFamily {
  return buildOrThrow({
    scope: SCOPE,
    kind: "asset",
    range: { from: WF_FROM, to: WF_TO },
    universe: { kind: "asset", instrumentIds: ASSET_IDS },
    policy: {
      kind: "asset",
      axisId: "axis-asset",
      rule: { kind: "round-robin", modulus: 2, offset: 1 },
    },
  });
}

export function aVenueFamily(): SplitFamily {
  return buildOrThrow({
    scope: SCOPE,
    kind: "venue",
    range: { from: WF_FROM, to: WF_TO },
    universe: { kind: "venue", venueIds: VENUE_IDS },
    policy: {
      kind: "venue",
      axisId: "axis-venue",
      rule: {
        kind: "explicit",
        train: ["venue-cme"],
        evaluation: ["venue-nyse", "venue-coinbase"],
      },
    },
  });
}

/** The error codes of a fail-closed outcome, for pinning refusal laws. */
export function codes(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}
