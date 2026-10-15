/**
 * The whole-record re-validation (W051) — the record rebuilt from its own
 * carried data must reproduce it exactly: same content-addressed id, same
 * canonical orders, coherent lineage, same canonical bytes; W050 firewall
 * errors carried verbatim.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { validateSearchHistory } from "../index.js";
import {
  MINUTE,
  SELECTION_MAIN,
  T0,
  TRIAL_A,
  TRIAL_B,
  TRIAL_C,
  aHistory,
  tamperedEarlyView,
} from "./fixtures.js";

function codes(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}

describe("the re-validation's happy path", () => {
  it("accepts a freshly built history", () => {
    assert.deepEqual(validateSearchHistory(aHistory()), { ok: true });
  });
});

describe("the identity law (the id re-derives from carried data)", () => {
  it("refuses a forged history id", () => {
    const history = aHistory();
    const tampered = { ...history, historyId: "search-forged" as never } as typeof history;
    const outcome = validateSearchHistory(tampered);
    assert.ok(codes(outcome).includes("history-id-mismatch"));
  });

  it("refuses a non-record value without throwing", () => {
    const outcome = validateSearchHistory(null as never);
    assert.ok(codes(outcome).includes("history-id-mismatch"));
  });

  it("refuses a record with dropped selections (the bytes no longer re-derive)", () => {
    const history = aHistory();
    const dropped = { ...history, selections: undefined } as unknown as typeof history;
    const outcome = validateSearchHistory(dropped);
    assert.ok(codes(outcome).includes("history-id-mismatch"));
  });
});

describe("the carried-view re-proof (W050 errors carried verbatim)", () => {
  it("refuses a tampered sealed view, carrying the W050 post-cutoff refusal", () => {
    const history = aHistory();
    const tampered = {
      ...history,
      trials: [
        { ...TRIAL_A, view: tamperedEarlyView(T0 + 8 * MINUTE) },
        TRIAL_B,
        TRIAL_C,
      ],
    } as typeof history;
    const outcome = validateSearchHistory(tampered);
    assert.ok(codes(outcome).includes("invalid-view"));
    if (!outcome.ok) {
      const invalidView = outcome.errors.find((error) => error.code === "invalid-view");
      assert.ok(invalidView !== undefined && invalidView.viewErrors !== undefined);
      assert.ok(
        invalidView.viewErrors.some((error) => error.code === "post-cutoff-record"),
        "the W050 firewall refusal must be carried verbatim",
      );
    }
  });
});

describe("the canonical-order + lineage laws", () => {
  it("refuses trials carried out of canonical order", () => {
    const history = aHistory();
    const reordered = {
      ...history,
      trials: [TRIAL_B, TRIAL_A, TRIAL_C],
    } as typeof history;
    const outcome = validateSearchHistory(reordered);
    assert.ok(codes(outcome).includes("trials-not-canonical"));
  });

  it("refuses a forged lineage root", () => {
    const history = aHistory();
    const tampered = {
      ...history,
      lineage: { ...history.lineage, root: "search-elsewhere" as never },
    } as typeof history;
    const outcome = validateSearchHistory(tampered);
    assert.ok(codes(outcome).includes("invalid-lineage"));
  });

  it("refuses a blank scope member", () => {
    const history = aHistory();
    const tampered = {
      ...history,
      scope: { ...history.scope, worldId: "" as never },
    } as typeof history;
    const outcome = validateSearchHistory(tampered);
    assert.ok(codes(outcome).includes("blank-scope-member"));
  });

  it("re-proves the selection laws over hand-forged data (R016 carried)", () => {
    const history = aHistory();
    const forged = {
      ...history,
      selections: [
        { ...SELECTION_MAIN, decidedAsOf: (T0 + 4 * MINUTE) as never },
      ],
    } as typeof history;
    const outcome = validateSearchHistory(forged);
    assert.ok(codes(outcome).includes("post-cutoff-consult"));
  });
});
