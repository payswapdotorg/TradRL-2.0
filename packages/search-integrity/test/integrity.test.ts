/**
 * THE GATES (W051) — checkSearchIntegrity: the §13 declaration audit in
 * the W038 findings shape (PASS/FAIL/PARTIAL + undeclared-failure
 * findings), the R016 carry, and the traceability laws.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkSearchIntegrity } from "../index.js";
import {
  EARLY_VIEW,
  LATE_VIEW,
  MINUTE,
  SELECTION_MAIN,
  T0,
  TRIAL_A,
  TRIAL_B,
  TRIAL_C,
  aClaim,
  aHistory,
  tamperedEarlyView,
} from "./fixtures.js";
import type { SearchIntegrityClaim } from "../index.js";

function codes(report: { violations: readonly { code: string }[] }): string[] {
  return report.violations.map((violation) => violation.code);
}

describe("the declaration audit's happy path", () => {
  it("PASSes a complete declaration through W038-shaped findings", () => {
    const history = aHistory();
    const report = checkSearchIntegrity(history, aClaim(history));
    assert.equal(report.verdict, "PASS");
    assert.deepEqual(report.violations, []);
    assert.equal(report.findings.findings.length, 1);
    const finding = report.findings.findings[0]!;
    assert.equal(finding.claimKind, "search-history");
    assert.equal(finding.findingKind, "declared");
    assert.equal(finding.verdict, "PASS");
    const joined = finding.evidence.join("\n");
    assert.ok(joined.includes("search-history"), "the needle 'search-history' must be named");
    assert.ok(joined.includes("declaration"), "the needle 'declaration' must be named");
    assert.equal(report.findings.passCount, 1);
    assert.equal(report.findings.failCount, 0);
    assert.equal(report.findings.undeclaredCount, 0);
    assert.ok(report.digest.length > 0);
  });

  it("PARTIALs a selection-free record with the limitation disclosed", () => {
    const history = aHistory([TRIAL_A, TRIAL_B, TRIAL_C], []);
    const report = checkSearchIntegrity(history, aClaim(history));
    assert.equal(report.verdict, "PARTIAL");
    assert.deepEqual(report.violations, []);
    const joined = report.findings.findings[0]!.evidence.join("\n");
    assert.ok(joined.includes("disclosed limitation"));
    assert.ok(joined.includes("no selection decision"));
  });
});

describe("the undeclared-trial law (§13, loud + typed)", () => {
  it("FAILs a claim that hides trials, surfacing each as its OWN undeclared-failure finding", () => {
    const history = aHistory();
    const claim = aClaim(history, ["trial-a"]);
    const report = checkSearchIntegrity(history, claim);
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), [
      "undeclared-trial",
      "undeclared-trial",
      "unresolved-evidence",
    ]);
    assert.deepEqual(
      report.violations.map((violation) => violation.subject),
      ["trial-b", "trial-c", `decision-late:${String(LATE_VIEW.viewId)}`],
    );
    for (const violation of report.violations) {
      assert.equal(violation.law, "spec/ARCHITECTURE.md §13");
    }
    const undeclared = report.findings.findings.filter(
      (finding) => finding.findingKind === "undeclared-failure",
    );
    assert.deepEqual(
      undeclared.map((finding) => finding.claimId),
      ["undeclared-trial:trial-b", "undeclared-trial:trial-c"],
    );
    assert.equal(report.findings.undeclaredCount, 2);
    assert.equal(report.findings.failCount, 3);
  });

  it("FAILs a claim declaring a trial the record does not carry", () => {
    const history = aHistory();
    const report = checkSearchIntegrity(history, aClaim(history, ["trial-a", "trial-b", "trial-c", "trial-zz"]));
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["unknown-declared-trial"]);
    assert.equal(report.violations[0]!.subject, "trial-zz");
  });
});

describe("the citation laws", () => {
  it("FAILs a claim citing a different search history", () => {
    const history = aHistory();
    const rogue: SearchIntegrityClaim = { ...aClaim(history), historyId: "search-somewhere-else" as never };
    const report = checkSearchIntegrity(history, rogue);
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["history-mismatch"]);
  });

  it("FAILs a claim citing no evidence at all", () => {
    const history = aHistory();
    const report = checkSearchIntegrity(history, aClaim(history, ["trial-a", "trial-b", "trial-c"], []));
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["uncited-claim"]);
  });

  it("FAILs a claim whose cited evidence resolves to no declared trial's view", () => {
    const history = aHistory();
    const report = checkSearchIntegrity(history, aClaim(history, ["trial-a", "trial-b", "trial-c"], ["pitv-unknown"]));
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["unresolved-evidence"]);
  });

  it("FAILs a malformed claim loudly (blank identity)", () => {
    const history = aHistory();
    const rogue = { ...aClaim(history), claimId: " " } as SearchIntegrityClaim;
    const report = checkSearchIntegrity(history, rogue);
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["malformed-claim"]);
    assert.equal(report.findings.findings[0]!.claimId, "search-history");
  });
});

describe("the malformed-history law (W050 errors carried verbatim)", () => {
  it("FAILs over a tampered sealed view, carrying the W050 re-proof errors", () => {
    const history = aHistory();
    const tampered = {
      ...history,
      trials: [
        { ...TRIAL_A, view: tamperedEarlyView(T0 + 8 * MINUTE) },
        TRIAL_B,
        TRIAL_C,
      ],
    } as typeof history;
    const report = checkSearchIntegrity(tampered, aClaim(tampered));
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["malformed-history"]);
    const violation = report.violations[0]!;
    assert.ok(violation.historyErrors !== undefined);
    const invalidView = violation.historyErrors!.find((error) => error.code === "invalid-view");
    assert.ok(invalidView !== undefined, "the re-proof must reach the view law");
    assert.ok(
      invalidView.viewErrors !== undefined &&
        invalidView.viewErrors.some((error) => error.code === "post-cutoff-record"),
      "the W050 firewall refusal must be carried verbatim through the gate",
    );
  });

  it("FAILs over a record whose history id does not re-derive", () => {
    const history = aHistory();
    const tampered = { ...history, historyId: "search-forged" as never } as typeof history;
    const report = checkSearchIntegrity(tampered, aClaim(tampered));
    assert.equal(report.verdict, "FAIL");
    assert.deepEqual(codes(report), ["malformed-history"]);
    assert.ok(
      report.violations[0]!.historyErrors !== undefined &&
        report.violations[0]!.historyErrors!.some((error) => error.code === "history-id-mismatch"),
      "the forged id is refused through the record's own content law",
    );
  });
});

describe("the R016 carry (post-cutoff consult, defensive depth)", () => {
  it("re-proves the consult law over a hand-forged selection record", () => {
    const history = aHistory();
    const forged = {
      ...history,
      selections: [
        {
          ...SELECTION_MAIN,
          decidedAsOf: (T0 + 5 * MINUTE) as never,
          citedEvidence: [String(EARLY_VIEW.viewId), String(LATE_VIEW.viewId)],
        },
      ],
    } as typeof history;
    const report = checkSearchIntegrity(forged, aClaim(forged));
    assert.equal(report.verdict, "FAIL");
    assert.ok(codes(report).includes("malformed-history"));
    assert.ok(
      report.violations[0]!.historyErrors !== undefined &&
        report.violations[0]!.historyErrors!.some((error) => error.code === "post-cutoff-consult"),
      "the forged consult is refused through the record's own laws (R016 carried verbatim)",
    );
  });
});
