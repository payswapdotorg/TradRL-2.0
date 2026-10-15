/**
 * The A9 twin laws of the search-integrity package (W051) — determinism:
 * same declared search ⇒ the same record, deep-equal, the same canonical
 * ids, the same integrity verdict, the same statistics; any declared byte
 * re-addresses the record. Declaration order NEVER leaks (trials,
 * parameters, decisions and cited evidence are canonicalized before the
 * digest is taken).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { canonicalString } from "trajectory";
import {
  buildSearchHistory,
  checkSearchIntegrity,
  searchOverfitStatisticsOf,
} from "../index.js";
import {
  SCOPE,
  SELECTION_LATE,
  SELECTION_MAIN,
  TRIAL_A,
  TRIAL_B,
  TRIAL_C,
  aClaim,
  aHistory,
} from "./fixtures.js";

describe("the record twin (A9)", () => {
  it("building the same declaration twice yields deep-equal records with the same id", () => {
    const first = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A, TRIAL_B, TRIAL_C],
      selections: [SELECTION_MAIN, SELECTION_LATE],
    });
    const second = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A, TRIAL_B, TRIAL_C],
      selections: [SELECTION_MAIN, SELECTION_LATE],
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.history),
        canonicalString(second.history),
        "the twin must be deep-equal through the canonical encoding",
      );
      assert.equal(first.history.historyId, second.history.historyId);
    }
  });

  it("declaration order never leaks: permuted trials/parameters/evidence yield the SAME id", () => {
    const canonical = aHistory();
    const permuted = buildSearchHistory({
      scope: SCOPE,
      trials: [
        TRIAL_C,
        {
          ...TRIAL_A,
          candidate: {
            ...TRIAL_A.candidate,
            parameters: [...TRIAL_A.candidate.parameters].reverse(),
          },
        },
        TRIAL_B,
      ],
      selections: [
        SELECTION_MAIN,
        {
          ...SELECTION_LATE,
          citedEvidence: [...SELECTION_LATE.citedEvidence].reverse(),
        },
      ],
    });
    if (!permuted.ok) {
      assert.fail(`the permuted declaration must build: ${permuted.errors[0]?.message}`);
    }
    assert.equal(permuted.history.historyId, canonical.historyId);
    assert.equal(canonicalString(permuted.history), canonicalString(canonical));
  });

  it("any declared byte re-addresses the record (tamper evidence)", () => {
    const base = aHistory();
    const mutated = buildSearchHistory({
      scope: SCOPE,
      trials: [
        {
          ...TRIAL_A,
          candidate: {
            ...TRIAL_A.candidate,
            parameters: [
              { name: "learning-rate", value: 0.002 },
              { name: "depth", value: 3 },
            ],
          },
        },
        TRIAL_B,
        TRIAL_C,
      ],
      selections: [SELECTION_MAIN, SELECTION_LATE],
    });
    if (!mutated.ok) {
      assert.fail(`the mutated candidate must build: ${mutated.errors[0]?.message}`);
    }
    assert.notEqual(mutated.history.historyId, base.historyId);
  });
});

describe("the verdict twin (A9)", () => {
  it("the same (history, claim) yields deep-equal reports with the same digest", () => {
    const history = aHistory();
    const claim = aClaim(history);
    const first = checkSearchIntegrity(history, claim);
    const second = checkSearchIntegrity(history, claim);
    assert.equal(canonicalString(first), canonicalString(second));
    assert.equal(first.digest, second.digest);
    assert.equal(first.verdict, "PASS");
  });

  it("the verdict follows the record's content (a hidden trial flips it)", () => {
    const history = aHistory();
    const complete = checkSearchIntegrity(history, aClaim(history));
    const partial = checkSearchIntegrity(history, aClaim(history, ["trial-a", "trial-b"]));
    assert.equal(complete.verdict, "PASS");
    assert.equal(partial.verdict, "FAIL");
    assert.notEqual(complete.digest, partial.digest);
  });
});

describe("the statistics twin (A9)", () => {
  it("the same record projects to the same statistics, deep-equal, same digest", () => {
    const first = searchOverfitStatisticsOf(aHistory());
    const second = searchOverfitStatisticsOf(aHistory());
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.equal(
        canonicalString(first.statistics),
        canonicalString(second.statistics),
      );
      assert.equal(first.statistics.digest, second.statistics.digest);
    }
  });
});
