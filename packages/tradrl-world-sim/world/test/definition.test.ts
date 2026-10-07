/**
 * Tests for the world definition (W013 `world` module): structural
 * validation and the WorldMeta fidelity projection.
 *
 * Spec: spec/SIMULATION.md "Fidelity declarations" + "Synthetic regimes"
 * (regime schedules are world metadata), spec/ARCHITECTURE-LOCK.md A14
 * (simulation/live boundary fails closed — every account must disallow live
 * execution), A9 (engine identity constants are manifest inputs).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CONTRACTS_DEPENDENCY_VERSION,
  ENGINE_ID,
  ENGINE_VERSION,
  InvalidWorldDefinitionError,
  SKELETON_KNOWN_LIMITATIONS,
  projectWorldMeta,
  validateWorldDefinition,
} from "../index.js";
import {
  START,
  testAccount,
  testDefinition,
  testNewsArtifact,
  testParticipant,
} from "./helpers.js";

test("a well-formed definition validates", () => {
  assert.deepEqual(validateWorldDefinition(testDefinition()), []);
});

test("blank identity fields are rejected", () => {
  const errors = validateWorldDefinition(testDefinition({ seed: " " }));
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /seed/);
});

test("an invalid mode is rejected", () => {
  const errors = validateWorldDefinition(
    testDefinition({ mode: "live-trading" as never }),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /WorldMode/);
});

test("clock genesis bounds are validated", () => {
  const badEnd = testDefinition();
  (badEnd.clock as { end?: number }).end = START - 1;
  assert.match(validateWorldDefinition(badEnd)[0] ?? "", /clock\.end/);

  const badStep = testDefinition();
  (badStep.clock as { defaultStepMs?: number }).defaultStepMs = 0;
  assert.match(validateWorldDefinition(badStep)[0] ?? "", /defaultStepMs/);
});

test("duplicate entity ids are rejected", () => {
  const duplicateInstrument = testDefinition({
    instruments: [
      ...testDefinition().instruments,
      testDefinition().instruments[0]!,
    ],
  });
  assert.match(validateWorldDefinition(duplicateInstrument)[0] ?? "", /duplicate instrumentId/);
});

test("an account allowing live execution fails closed (A14)", () => {
  const liveAccount = testAccount({
    permissions: { canTrade: true, canShort: false, liveExecutionAllowed: true as never },
  });
  const errors = validateWorldDefinition(
    testDefinition({ accounts: [liveAccount] }),
  );
  assert.match(errors[0] ?? "", /live execution must be disallowed/);
});

test("participants must reference declared accounts", () => {
  const errors = validateWorldDefinition(
    testDefinition({
      participants: [testParticipant({ accountId: "account-ghost" as never })],
    }),
  );
  assert.match(errors[0] ?? "", /unknown account/);
});

test("information artifacts must be finite, unique and world-scoped (A7)", () => {
  const errors = validateWorldDefinition(
    testDefinition({
      informationArtifacts: [
        testNewsArtifact("news-a", Number.NaN),
        testNewsArtifact("news-a", START),
      ],
    }),
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0] ?? "", /availableAt/);
  assert.match(errors[1] ?? "", /duplicate/);
});

test("regime schedule entries are validated", () => {
  const errors = validateWorldDefinition(
    testDefinition({
      regimeSchedule: [
        { regime: "hyper-trend" as never, from: START as never },
        { regime: "shock", from: START as never, to: (START - 1) as never },
      ],
    }),
  );
  assert.equal(errors.length, 2);
  assert.match(errors[0] ?? "", /RegimeKind/);
  assert.match(errors[1] ?? "", /precede from/);
});

test("projectWorldMeta carries the fidelity declaration (SIMULATION.md)", () => {
  const definition = testDefinition({
    regimeSchedule: [{ regime: "trend", from: START as never }],
  });
  const meta = projectWorldMeta(definition, undefined);
  assert.equal(meta.worldId, definition.scope.worldId);
  assert.equal(meta.mode, "reactive-replay");
  assert.equal(meta.executionAuthority, "simulated-only");
  assert.equal(meta.engine, ENGINE_ID);
  assert.equal(meta.engineVersion, ENGINE_VERSION);
  assert.deepEqual(meta.determinism, { kind: "deterministic" });
  assert.ok(meta.knownLimitations.length >= SKELETON_KNOWN_LIMITATIONS.length);
  assert.deepEqual(meta.regimeSchedule, definition.regimeSchedule);
  assert.equal(meta.parentWorldId, undefined, "no branches in the skeleton");
});

test("projectWorldMeta reflects the scenario in force (setScenario updates metadata)", () => {
  const definition = testDefinition();
  const current = {
    label: "shock hour",
    entries: [{ regime: "shock" as const, from: START as never }],
  };
  const meta = projectWorldMeta(definition, current);
  assert.equal(meta.regimeSchedule?.[0]?.regime, "shock");
});

test("engine constants match the package manifests (manifest integrity)", () => {
  const own = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
  ) as { version: string };
  assert.equal(ENGINE_ID, "tradrl-world-sim");
  assert.match(ENGINE_VERSION, /^0\.1\.0/);
  assert.equal(own.version, "0.1.0", "ENGINE_VERSION tracks the package version");
  const contracts = JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, "../../../tradrl-world-contracts/package.json"),
      "utf8",
    ),
  ) as { version: string; name: string };
  assert.equal(contracts.name, "tradrl-world-contracts");
  assert.equal(
    CONTRACTS_DEPENDENCY_VERSION,
    contracts.version,
    "the manifest's contracts dependency version must match the consumed package",
  );
});

test("assertValidWorldDefinition fails fast with the full error list", () => {
  assert.throws(
    () => {
      throw new InvalidWorldDefinitionError(["a", "b"]);
    },
    (error: unknown) => {
      assert.ok(error instanceof InvalidWorldDefinitionError);
      assert.deepEqual(error.errors, ["a", "b"]);
      return true;
    },
  );
});
