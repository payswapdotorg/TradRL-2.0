/**
 * The PointInTimeQuery construction laws (W050) — fail-closed, collected,
 * every violation named.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  POINT_IN_TIME_QUERY_ID_PREFIX,
  asPointInTimeCutoff,
  blankTimeMachineScopeMembers,
  buildPointInTimeQuery,
  isLegalCutoff,
  isTimeMachineRecordFamily,
  pointInTimeQueryIdOf,
  validatePointInTimeQuery,
} from "../index.js";
import { PROJECT, TENANT, T0, WORLD, aQuery, cutoff } from "./fixtures.js";
import type { TimeMachineRecordFamily } from "../index.js";
import type { ProjectId, TenantId } from "tradrl-world-contracts";

const ALL_FAMILIES: readonly TimeMachineRecordFamily[] = [
  "market-event",
  "news",
  "research-report",
  "event",
  "analyst-note",
];

describe("the query vocabulary", () => {
  it("recognizes every closed family", () => {
    for (const family of ALL_FAMILIES) {
      assert.equal(isTimeMachineRecordFamily(family), true);
    }
    assert.equal(isTimeMachineRecordFamily("not-a-family"), false);
    assert.equal(isTimeMachineRecordFamily(undefined), false);
  });

  it("recognizes legal cutoffs and refuses illegal ones", () => {
    assert.equal(isLegalCutoff(0), true);
    assert.equal(isLegalCutoff(T0), true);
    assert.equal(isLegalCutoff(Number.NaN), false);
    assert.equal(isLegalCutoff(Number.POSITIVE_INFINITY), false);
    assert.equal(isLegalCutoff(-1), false);
    assert.equal(isLegalCutoff(1.5), false);
  });

  it("names the blank scope members", () => {
    assert.deepEqual(
      blankTimeMachineScopeMembers({ tenantId: "" as TenantId, projectId: "p" as ProjectId, worldId: "w" as never }),
      ["tenantId"],
    );
    assert.deepEqual(
      blankTimeMachineScopeMembers({ tenantId: "t" as TenantId, projectId: " " as ProjectId, worldId: "" as never }),
      ["projectId", "worldId"],
    );
  });
});

describe("buildPointInTimeQuery (the fail-closed declaration gate)", () => {
  it("seals a lawful query with a content-addressed id and canonical family order", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
      cutoff: cutoff(T0 + 60_000),
      families: ["news", "market-event", "research-report"],
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.ok(outcome.query.queryId.startsWith(POINT_IN_TIME_QUERY_ID_PREFIX));
      assert.deepEqual(outcome.query.families, ["market-event", "news", "research-report"]);
      assert.equal(outcome.query.cutoff, T0 + 60_000);
      assert.equal(Object.isFrozen(outcome.query), true);
    }
  });

  it("derives the same id regardless of family input order", () => {
    const scope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
    const left = pointInTimeQueryIdOf(scope, cutoff(T0), ["news", "event"]);
    const right = pointInTimeQueryIdOf(scope, cutoff(T0), ["event", "news"]);
    assert.equal(left, right);
  });

  it("derives a different id for any differing member", () => {
    const scope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
    const base = pointInTimeQueryIdOf(scope, cutoff(T0), ["news"]);
    assert.notEqual(pointInTimeQueryIdOf(scope, cutoff(T0 + 1), ["news"]), base);
    assert.notEqual(
      pointInTimeQueryIdOf({ ...scope, worldId: "other" as never }, cutoff(T0), ["news"]),
      base,
    );
    assert.notEqual(pointInTimeQueryIdOf(scope, cutoff(T0), ["event"]), base);
  });

  it("refuses a blank scope member", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: "" as TenantId, projectId: PROJECT, worldId: WORLD },
      cutoff: cutoff(T0),
      families: ["news"],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "blank-scope-member");
    }
  });

  it("refuses unknown families", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
      cutoff: cutoff(T0),
      families: ["news", "not-a-family" as unknown as TimeMachineRecordFamily],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "unknown-family");
    }
  });

  it("refuses duplicate families — never silently deduplicates", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
      cutoff: cutoff(T0),
      families: ["news", "news"],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "duplicate-family");
    }
  });

  it("refuses an empty family set", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
      cutoff: cutoff(T0),
      families: [],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.errors[0]?.code, "empty-family-set");
    }
  });

  it("refuses illegal cutoffs", () => {
    for (const bad of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY]) {
      const outcome = buildPointInTimeQuery({
        scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
        cutoff: asPointInTimeCutoff(bad),
        families: ["news"],
      });
      assert.equal(outcome.ok, false, `cutoff ${String(bad)} must be refused`);
      if (!outcome.ok) {
        assert.equal(outcome.errors[0]?.code, "illegal-cutoff");
      }
    }
  });

  it("collects every violation at once, not just the first", () => {
    const outcome = buildPointInTimeQuery({
      scope: { tenantId: "" as TenantId, projectId: PROJECT, worldId: WORLD },
      cutoff: asPointInTimeCutoff(-1),
      families: [],
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.ok(outcome.errors.length >= 3, "all three laws violated at once");
    }
  });
});

describe("validatePointInTimeQuery (the whole-record re-proof)", () => {
  it("accepts a lawful carried query", () => {
    assert.deepEqual(validatePointInTimeQuery(aQuery(["news"], T0)), { ok: true });
  });

  it("refuses a tampered query id (identity re-derivation)", () => {
    const query = { ...aQuery(["news"], T0), queryId: "pitq-00000000" as never };
    const validation = validatePointInTimeQuery(query);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.errors[0]?.code, "query-id-mismatch");
    }
  });

  it("refuses a tampered scope after sealing", () => {
    const query = aQuery(["news"], T0);
    const tampered = { ...query, scope: { ...query.scope, worldId: "" as never } };
    const validation = validatePointInTimeQuery(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.equal(validation.errors[0]?.code, "blank-scope-member");
    }
  });

  it("refuses an undeclared family smuggled in after sealing", () => {
    const query = aQuery(["news"], T0);
    const tampered = { ...query, families: [...query.families, "not-real" as never] };
    const validation = validatePointInTimeQuery(tampered);
    assert.equal(validation.ok, false);
    if (!validation.ok) {
      assert.ok(
        validation.errors.some((error) => error.code === "unknown-family"),
        "the smuggled family is named",
      );
    }
  });

  it("refuses a structurally malformed query without throwing", () => {
    const validation = validatePointInTimeQuery(null as never);
    assert.equal(validation.ok, false);
  });
});
