/**
 * The W040 query tests: deterministic fail-closed lookups (by id, by
 * kind, by domain) and the W039 demand-matching seam — satisfied demands,
 * inconsistent demands, out-of-scope demands, unprovided demands, and the
 * LOUD deprecated/revoked failures — plus the organization-offering
 * projection the W039 compiler's registry input builds from.
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { OrganizationCapability, OrganizationCapabilityDemand, OrganizationScope } from "organization";
import { createCapabilityRegistry, registerCapability } from "../register.js";
import { deprecateCapability, revokeCapability } from "../lifecycle.js";
import {
  capabilitiesInDomain,
  capabilitiesOfKind,
  matchCapabilityDemand,
  organizationOfferingsOf,
  resolveCapability,
} from "../query.js";
import type { CapabilityDemandQuery } from "../query.js";
import type { CapabilityDomain, CapabilityKind, CapabilityRegistry } from "../descriptor.js";
import type { CapabilityId } from "../identity.js";
import {
  BODY_EXECUTION,
  ORG_CAP_EXECUTION,
  ORG_CAP_RISK,
  OTHER_WORLD,
  SCOPE,
  SUBSTRATE_MEANREVERSION,
  SUBSTRATE_MOMENTUM,
  evidenceFixture,
  registrationFixture,
} from "./fixtures.js";

function buildRegistry(): { registry: CapabilityRegistry; executionId: CapabilityId; riskId: CapabilityId } {
  let registry = createCapabilityRegistry(SCOPE);
  const execution = registerCapability(registry, registrationFixture());
  assert.equal(execution.ok, true);
  let executionId = "cap-unreachable" as CapabilityId;
  if (execution.ok) {
    registry = execution.registry;
    executionId = execution.capabilityId;
  }
  const risk = registerCapability(registry, registrationFixture({
    name: "drawdown-aware risk guarding",
    kind: "risk-control",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
    providesOrganizationCapabilityIds: [ORG_CAP_RISK],
    evidence: [evidenceFixture()],
  }));
  assert.equal(risk.ok, true);
  let riskId = "cap-unreachable" as CapabilityId;
  if (risk.ok) {
    registry = risk.registry;
    riskId = risk.capabilityId;
  }
  return { registry, executionId, riskId };
}

const orgCapability = (capabilityId: OrganizationCapability["capabilityId"]): OrganizationCapability => ({
  capabilityId,
  name: `the ${String(capabilityId)} capability`,
});

const demandOn = (
  capabilityId: OrganizationCapabilityDemand["capabilityId"],
): OrganizationCapabilityDemand => ({
  capabilityId,
  rationale: "the seat demands a MEASURED capability (rationale-as-data)",
});

const queryOn = (
  capabilityId: OrganizationCapability["capabilityId"],
  scope: OrganizationScope = SCOPE,
): CapabilityDemandQuery => ({
  scope,
  capability: orgCapability(capabilityId),
  demand: demandOn(capabilityId),
});

test("resolveCapability answers exact ids regardless of state, and misses loudly", () => {
  const { registry, executionId } = buildRegistry();
  const found = resolveCapability(registry, executionId);
  assert.equal(found.ok, true);
  if (found.ok) {
    assert.equal(found.entry.descriptor.capabilityId, executionId);
  }
  const missed = resolveCapability(registry, "cap-nope" as CapabilityId);
  assert.equal(missed.ok, false);
  if (!missed.ok) {
    assert.deepEqual(missed.errors.map((error) => error.code), ["unknown-capability"]);
  }
});

test("kind and domain queries filter in canonical order and refuse unknown vocabulary", () => {
  const { registry } = buildRegistry();
  const execution = capabilitiesOfKind(registry, "execution-quality");
  assert.equal(execution.ok, true);
  if (execution.ok) {
    assert.equal(execution.entries.length, 1);
    assert.equal(execution.entries[0]?.descriptor.kind, "execution-quality");
  }
  const risk = capabilitiesOfKind(registry, "risk-control");
  assert.equal(risk.ok, true);
  if (risk.ok) {
    assert.equal(risk.entries.length, 1);
  }
  const unknownKind = capabilitiesOfKind(registry, "telepathy" as CapabilityKind);
  assert.equal(unknownKind.ok, false);
  if (!unknownKind.ok) {
    assert.deepEqual(unknownKind.errors.map((error) => error.code), ["unknown-capability-kind"]);
  }
  const futures = capabilitiesInDomain(registry, "futures");
  assert.equal(futures.ok, true);
  if (futures.ok) {
    assert.equal(futures.entries.length, 2);
  }
  const unknownDomain = capabilitiesInDomain(registry, "astrology" as CapabilityDomain);
  assert.equal(unknownDomain.ok, false);
  if (!unknownDomain.ok) {
    assert.deepEqual(unknownDomain.errors.map((error) => error.code), ["unknown-capability-domain"]);
  }
});

test("a registered capability satisfies a W039 demand, with evidence", () => {
  const { registry, executionId } = buildRegistry();
  const match = matchCapabilityDemand(registry, queryOn(ORG_CAP_EXECUTION));
  assert.equal(match.ok, true);
  if (match.ok) {
    assert.deepEqual(match.capabilityId, executionId);
    assert.equal(match.evidence.length >= 4, true);
    assert.equal(match.evidence[3]?.includes("measured provenance: 1 citation(s)"), true);
  }
});

test("an inconsistent demand is refused before anything runs", () => {
  const { registry } = buildRegistry();
  const match = matchCapabilityDemand(registry, {
    scope: SCOPE,
    capability: orgCapability(ORG_CAP_EXECUTION),
    demand: demandOn(ORG_CAP_RISK),
  });
  assert.equal(match.ok, false);
  if (!match.ok) {
    assert.deepEqual(match.reasons.map((reason) => reason.code), ["inconsistent-demand"]);
  }
});

test("a demand from outside the registry's scope is refused (the W039 compiler law)", () => {
  const { registry } = buildRegistry();
  const match = matchCapabilityDemand(
    registry,
    queryOn(ORG_CAP_EXECUTION, { ...SCOPE, worldId: OTHER_WORLD }),
  );
  assert.equal(match.ok, false);
  if (!match.ok) {
    assert.deepEqual(match.reasons.map((reason) => reason.code), ["registry-scope-mismatch"]);
  }
});

test("a demand nothing provides is refused as unprovided", () => {
  const { registry } = buildRegistry();
  const match = matchCapabilityDemand(registry, queryOn("capability-org-unheard-of" as OrganizationCapability["capabilityId"]));
  assert.equal(match.ok, false);
  if (!match.ok) {
    assert.deepEqual(match.reasons.map((reason) => reason.code), ["unprovided-demand"]);
  }
});

test("a deprecated capability fails demand-matching LOUDLY (never silently)", () => {
  const { registry, executionId } = buildRegistry();
  const deprecated = deprecateCapability(registry, executionId, "superseded by a re-measurement");
  assert.equal(deprecated.ok, true);
  const match = matchCapabilityDemand(
    deprecated.ok ? deprecated.registry : registry,
    queryOn(ORG_CAP_EXECUTION),
  );
  assert.equal(match.ok, false);
  if (!match.ok) {
    assert.equal(match.reasons.length, 1);
    const reason = match.reasons[0];
    assert.ok(reason !== undefined);
    assert.equal(reason.code, "capability-deprecated");
    assert.deepEqual(reason.capabilityId, executionId);
    assert.equal(reason.message.includes("DEPRECATED"), true);
    assert.equal(reason.message.includes("never silently"), true);
  }
});

test("a revoked capability fails demand-matching loudly and terminally", () => {
  const { registry, riskId } = buildRegistry();
  const revoked = revokeCapability(registry, riskId, "the measurement was retracted");
  assert.equal(revoked.ok, true);
  const match = matchCapabilityDemand(
    revoked.ok ? revoked.registry : registry,
    queryOn(ORG_CAP_RISK),
  );
  assert.equal(match.ok, false);
  if (!match.ok) {
    const reason = match.reasons[0];
    assert.ok(reason !== undefined);
    assert.equal(reason.code, "capability-revoked");
    assert.deepEqual(reason.capabilityId, riskId);
  }
});

test("among providers the first REGISTERED one satisfies (the W039 first-eligible law)", () => {
  const { registry, executionId } = buildRegistry();
  const alsoProvides = registerCapability(registry, registrationFixture({
    name: "body-class execution, measured separately",
    bearer: { kind: "body", bodyId: BODY_EXECUTION },
    providesOrganizationCapabilityIds: [ORG_CAP_EXECUTION],
    evidence: [evidenceFixture()],
  }));
  assert.equal(alsoProvides.ok, true);
  const richer = alsoProvides.ok ? alsoProvides.registry : registry;

  const deprecated = deprecateCapability(richer, executionId, "superseded");
  assert.equal(deprecated.ok, true);
  const match = matchCapabilityDemand(
    deprecated.ok ? deprecated.registry : richer,
    queryOn(ORG_CAP_EXECUTION),
  );
  assert.equal(match.ok, true);
  if (match.ok) {
    assert.notDeepEqual(match.capabilityId, executionId);
  }
});

test("the offering projection merges per bearer, excludes retired bearers, and sorts", () => {
  const { registry, executionId } = buildRegistry();
  const alsoProvides = registerCapability(registry, registrationFixture({
    name: "momentum information synthesis",
    kind: "information-synthesis",
    providesOrganizationCapabilityIds: [ORG_CAP_RISK],
    evidence: [evidenceFixture()],
  }));
  assert.equal(alsoProvides.ok, true);
  const richer = alsoProvides.ok ? alsoProvides.registry : registry;

  const offerings = organizationOfferingsOf(richer);
  // two substrate bearers: momentum provides execution + risk via two
  // capabilities — MERGED; mean-reversion provides risk
  assert.equal(offerings.length, 2);
  const momentum = offerings.find(
    (offering) =>
      offering.bearer.kind === "substrate" &&
      String(offering.bearer.substrateId) === String(SUBSTRATE_MOMENTUM),
  );
  assert.ok(momentum !== undefined);
  assert.deepEqual(momentum.providesCapabilities, [ORG_CAP_EXECUTION, ORG_CAP_RISK]);
  const meanReversion = offerings.find(
    (offering) =>
      offering.bearer.kind === "substrate" &&
      String(offering.bearer.substrateId) === String(SUBSTRATE_MEANREVERSION),
  );
  assert.ok(meanReversion !== undefined);
  assert.deepEqual(meanReversion.providesCapabilities, [ORG_CAP_RISK]);

  // a deprecated capability's bearer stops offering (it is not composable
  // now), while its lineage still resolves:
  const deprecated = deprecateCapability(richer, executionId, "superseded");
  assert.equal(deprecated.ok, true);
  const retired = deprecated.ok ? deprecated.registry : richer;
  const after = organizationOfferingsOf(retired);
  const stillOffering = after.find(
    (offering) =>
      offering.bearer.kind === "substrate" &&
      String(offering.bearer.substrateId) === String(SUBSTRATE_MOMENTUM),
  );
  assert.ok(stillOffering !== undefined); // the OTHER (risk) capability still offers
  assert.deepEqual(stillOffering.providesCapabilities, [ORG_CAP_RISK]);
});
