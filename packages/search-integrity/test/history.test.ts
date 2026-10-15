/**
 * The SearchHistory construction-gate laws (W051) — every law checked
 * loudly, every violation named, W050 firewall errors carried verbatim.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { asPointInTimeCutoff, buildPointInTimeQuery, sealView } from "tradrl-time-machine";
import { buildSearchHistory } from "../index.js";
import {
  AS_OF,
  EARLY_VIEW,
  LATE_VIEW,
  MINUTE,
  SCOPE,
  SELECTION_MAIN,
  T0,
  TRIAL_A,
  TRIAL_B,
  TRIAL_C,
  aHistory,
  anOutcome,
  tamperedEarlyView,
} from "./fixtures.js";
import type { SearchHistoryInput, SearchTrial } from "../index.js";
import {
  aMarketEvent,
  marketViewRecord,
} from "../../tradrl-time-machine/test/fixtures.js";

function codes(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}

describe("the construction gate's happy path", () => {
  it("builds the record with a content-addressed search- id and canonical order", () => {
    const history = aHistory();
    assert.ok(history.historyId.startsWith("search-"));
    assert.deepEqual(
      history.trials.map((trial) => trial.trialId),
      ["trial-a", "trial-b", "trial-c"],
    );
    assert.deepEqual(
      history.trials[0]!.candidate.parameters.map((parameter) => parameter.name),
      ["depth", "learning-rate"],
    );
    assert.deepEqual(
      history.selections.map((selection) => selection.decisionId),
      ["decision-late", "decision-main"],
    );
    assert.equal(history.lineage.parent, undefined);
    assert.equal(history.lineage.root, history.historyId);
    assert.equal(history.lineage.ordinal, 0);
  });

  it("carries a declared branch lineage verbatim", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A],
      selections: [],
      lineage: {
        parent: "search-parent" as never,
        root: "search-root" as never,
        ordinal: 2,
      },
    });
    if (!outcome.ok) {
      assert.fail(`expected the branch lineage to build: ${outcome.errors[0]?.message}`);
    }
    assert.equal(String(outcome.history.lineage.parent), "search-parent");
    assert.equal(String(outcome.history.lineage.root), "search-root");
    assert.equal(outcome.history.lineage.ordinal, 2);
  });
});

describe("the construction gate's declaration laws", () => {
  it("refuses an empty trial set (a search over nothing is never silently built)", () => {
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [], selections: [] });
    assert.deepEqual(codes(outcome), ["empty-trial-set"]);
  });

  it("refuses trials that is not an array", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: "nope" as never,
      selections: [],
    });
    assert.ok(codes(outcome).includes("empty-trial-set"));
  });

  it("refuses blank scope members", () => {
    const outcome = buildSearchHistory({
      scope: { ...SCOPE, experimentId: "  " },
      trials: [TRIAL_A],
      selections: [],
    });
    assert.deepEqual(codes(outcome), ["blank-scope-member"]);
  });

  it("refuses duplicate trial ids (one trial, one id)", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A, TRIAL_A],
      selections: [],
    });
    assert.deepEqual(codes(outcome), ["duplicate-trial-id"]);
  });

  it("refuses a blank trial id", () => {
    const blank = { ...TRIAL_A, trialId: " " };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [blank], selections: [] });
    assert.deepEqual(codes(outcome), ["blank-trial-id"]);
  });
});

describe("the construction gate's candidate laws", () => {
  it("refuses an unknown candidate kind (closed vocabulary)", () => {
    const rogue = { ...TRIAL_A, candidate: { ...TRIAL_A.candidate, kind: "vibes" as never } };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["unknown-candidate-kind"]);
  });

  it("refuses a blank candidate id", () => {
    const rogue = { ...TRIAL_A, candidate: { ...TRIAL_A.candidate, candidateId: "" } };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["blank-candidate-id"]);
  });

  it("refuses duplicate parameter names (one name, one declaration)", () => {
    const rogue: SearchTrial = {
      ...TRIAL_A,
      candidate: {
        ...TRIAL_A.candidate,
        parameters: [
          { name: "depth", value: 3 },
          { name: "depth", value: 4 },
        ],
      },
    };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["duplicate-parameter-name"]);
  });

  it("refuses a malformed candidate (parameters not an array)", () => {
    const rogue = {
      ...TRIAL_A,
      candidate: { ...TRIAL_A.candidate, parameters: "nope" as never },
    };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["malformed-candidate"]);
  });
});

describe("the construction gate's view + outcome laws", () => {
  it("refuses a tampered sealed view with the W050 errors carried VERBATIM", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [{ ...TRIAL_A, view: tamperedEarlyView(T0 + 8 * MINUTE) }],
      selections: [],
    });
    const errorCodes = codes(outcome);
    assert.ok(errorCodes.includes("invalid-view"));
    if (!outcome.ok) {
      const viewError = outcome.errors.find((candidate) => candidate.code === "invalid-view");
      assert.ok(viewError !== undefined && viewError.viewErrors !== undefined);
      assert.ok(
        viewError.viewErrors.some((error) => error.code === "post-cutoff-record"),
        "the W050 firewall refusal must be carried verbatim (post-cutoff-record)",
      );
    }
  });

  it("refuses a view scoped outside the search's own identity", () => {
    const foreign = buildPointInTimeQuery({
      scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: "world-w051-elsewhere" as never },
      cutoff: asPointInTimeCutoff(AS_OF),
      families: ["market-event"],
    });
    if (!foreign.ok) {
      assert.fail("the foreign-scope query must build on its own terms");
    }
    const sealed = sealView(foreign.query, [marketViewRecord(aMarketEvent(T0))]);
    if (!sealed.ok) {
      assert.fail("the foreign-scope view must seal on its own terms");
    }
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [{ ...TRIAL_A, view: sealed.view }],
      selections: [],
    });
    assert.deepEqual(codes(outcome), ["scope-view-mismatch"]);
  });

  it("refuses an outcome whose episode id does not re-derive from its provenance", () => {
    const rogue = {
      ...TRIAL_A,
      outcome: { ...anOutcome("a"), episodeId: "ep-forged" as never },
    };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["episode-id-mismatch"]);
  });

  it("refuses a blank outcome citation", () => {
    const rogue = { ...TRIAL_A, outcome: { ...anOutcome("a"), batchId: "" as never } };
    const outcome = buildSearchHistory({ scope: SCOPE, trials: [rogue], selections: [] });
    assert.deepEqual(codes(outcome), ["blank-outcome-member"]);
  });
});

describe("the construction gate's selection laws", () => {
  const input = (selections: unknown): SearchHistoryInput =>
    ({ scope: SCOPE, trials: [TRIAL_A, TRIAL_B, TRIAL_C], selections: selections as never }) as SearchHistoryInput;

  it("refuses a selection citing no evidence (an uncited selection)", () => {
    const outcome = buildSearchHistory(input([{ ...SELECTION_MAIN, citedEvidence: [] }]));
    assert.deepEqual(codes(outcome), ["uncited-selection"]);
  });

  it("refuses evidence that resolves to no trial's sealed view", () => {
    const outcome = buildSearchHistory(
      input([{ ...SELECTION_MAIN, citedEvidence: ["pitv-does-not-exist"] }]),
    );
    const errorCodes = codes(outcome);
    assert.ok(errorCodes.includes("unresolved-evidence"));
    assert.ok(errorCodes.includes("chosen-trial-not-cited"));
  });

  it("refuses a selection choosing a trial the record does not carry", () => {
    const outcome = buildSearchHistory(input([{ ...SELECTION_MAIN, chosenTrialId: "trial-zz" }]));
    assert.deepEqual(codes(outcome), ["unknown-chosen-trial"]);
  });

  it("refuses a selection whose chosen trial's own view is not cited", () => {
    const outcome = buildSearchHistory(
      input([{ ...SELECTION_MAIN, chosenTrialId: "trial-c", citedEvidence: [String(EARLY_VIEW.viewId)] }]),
    );
    assert.deepEqual(codes(outcome), ["chosen-trial-not-cited"]);
  });

  it("refuses a post-cutoff consult loudly naming R016", () => {
    const outcome = buildSearchHistory(input([
      {
        ...SELECTION_MAIN,
        chosenTrialId: "trial-c",
        citedEvidence: [String(LATE_VIEW.viewId)],
        decidedAsOf: asPointInTimeCutoff(T0 + 5 * MINUTE),
      },
    ]));
    assert.deepEqual(codes(outcome), ["post-cutoff-consult"]);
    if (!outcome.ok) {
      assert.match(outcome.errors[0]!.message, /R016/);
    }
  });

  it("refuses an illegal as-of point", () => {
    const outcome = buildSearchHistory(
      input([{ ...SELECTION_MAIN, decidedAsOf: Number.NaN as never }]),
    );
    assert.ok(codes(outcome).includes("illegal-as-of"));
  });

  it("refuses duplicate decision ids", () => {
    const outcome = buildSearchHistory(input([SELECTION_MAIN, SELECTION_MAIN]));
    assert.ok(codes(outcome).includes("duplicate-decision-id"));
  });
});

describe("the construction gate's lineage laws", () => {
  it("refuses a branch lineage with ordinal < 1", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A],
      selections: [],
      lineage: { parent: "search-parent" as never, root: "search-root" as never, ordinal: 0 },
    });
    assert.deepEqual(codes(outcome), ["invalid-lineage"]);
  });

  it("refuses a blank root on a branch lineage", () => {
    const outcome = buildSearchHistory({
      scope: SCOPE,
      trials: [TRIAL_A],
      selections: [],
      lineage: { parent: "search-parent" as never, root: "" as never, ordinal: 1 },
    });
    assert.deepEqual(codes(outcome), ["invalid-lineage"]);
  });
});
