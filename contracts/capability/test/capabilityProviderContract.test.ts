/**
 * Capability-provider contract tests (W056).
 *
 * These are primarily compile-time law assertions (checked by
 * `tsc -p contracts/capability`, which includes this file); the
 * node:test blocks make the same laws executable so `tsx --test`
 * reports them too.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": the contract is
 * PROVIDER-NEUTRAL. The forbidden-key assertions below make importing
 * concrete-provider specifics into this contract a compile failure.
 * Spec: spec/REQUIREMENTS.md R052 — the offer descriptor's provenance is
 * REQUIRED (never an empty list by law).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  CapabilityProviderAdjudication,
  CapabilityProviderBearer,
  CapabilityProviderOfferDescriptor,
  CapabilityProviderOfferDomain,
  CapabilityProviderOfferKind,
  CapabilityProviderOfferLifecycleState,
  CapabilityProviderPort,
  CapabilityProviderScope,
} from "../src/capability-provider-contract.js";
import type { Equal, Expect, OptionalKeys, RequiredKeys } from "./helpers.js";

/** The keys a concrete-provider-specific member would need (R055's fence). */
type ForbiddenProviderKeys =
  | "externalSource"
  | "entitlements"
  | "billing"
  | "listing"
  | "adapter"
  | "runtime";

test("the offer kind vocabulary is the W040 closed set, carried verbatim", () => {
  type Kind = CapabilityProviderOfferKind;
  type _kindIsClosed = Expect<
    Equal<
      Kind,
      | "execution-quality"
      | "alpha-generation"
      | "risk-control"
      | "market-making"
      | "information-synthesis"
    >
  >;
  const kinds: readonly Kind[] = [
    "execution-quality",
    "alpha-generation",
    "risk-control",
    "market-making",
    "information-synthesis",
  ];
  assert.equal(kinds.length, 5);
});

test("the offer domain vocabulary is the W040 closed set, carried verbatim", () => {
  type Domain = CapabilityProviderOfferDomain;
  type _domainIsClosed = Expect<Equal<Domain, "equities" | "futures" | "fx" | "crypto-spot">>;
  const domains: readonly Domain[] = ["equities", "futures", "fx", "crypto-spot"];
  assert.equal(domains.length, 4);
});

test("the bearer dimension is the W040 closed shape, opaque ids", () => {
  type Bearer = CapabilityProviderBearer;
  type _substrateIdOpaque = Expect<Equal<Bearer["kind"], "substrate" | "body">>;
  const substrate: Bearer = { kind: "substrate", substrateId: "substrate-opaque" };
  const body: Bearer = { kind: "body", bodyId: "body-opaque" };
  assert.equal(substrate.kind, "substrate");
  assert.equal(body.kind, "body");
});

test("the lifecycle states are the W040 closed set, carried verbatim", () => {
  type State = CapabilityProviderOfferLifecycleState;
  type _stateIsClosed = Expect<Equal<State, "registered" | "deprecated" | "revoked">>;
  const states: readonly State[] = ["registered", "deprecated", "revoked"];
  assert.equal(states.length, 3);
});

test("the offer descriptor carries the full neutral shape with required provenance", () => {
  type Offer = CapabilityProviderOfferDescriptor;
  type _required = Expect<
    Equal<
      RequiredKeys<Offer>,
      | "offerId"
      | "capabilityId"
      | "name"
      | "kind"
      | "domain"
      | "bearer"
      | "scope"
      | "providesOrganizationCapabilityIds"
      | "capabilityLineage"
      | "provenance"
      | "endowments"
      | "lifecycle"
    >
  >;
  type _optional = Expect<Equal<Extract<OptionalKeys<Offer>, string>, "description">>;
  const sample: Offer = {
    offerId: "offer-00000000",
    capabilityId: "cap-00000000",
    name: "measured execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: "substrate-opaque" },
    scope: { tenantId: "tenant", projectId: "project", worldId: "world" },
    providesOrganizationCapabilityIds: ["capability-org-execution"],
    capabilityLineage: { parentCapabilityId: null, version: 1 },
    provenance: [
      {
        experimentId: "exp-opaque",
        evaluationId: "expeval-opaque",
        findingsDigest: "digest-opaque",
      },
    ],
    endowments: [],
    lifecycle: { state: "registered", transitions: [] },
  };
  // R052 (carried into the contract shape): the provenance list is
  // required data — a consumer never reads an offer without citations.
  assert.ok(Array.isArray(sample.provenance));
  assert.equal(sample.provenance.length, 1);
  // The scope members stay opaque strings: consumers compare, never parse.
  const scope: CapabilityProviderScope = sample.scope;
  assert.equal(typeof scope.tenantId, "string");
});

test("the contract stays provider-neutral — no concrete-provider keys anywhere", () => {
  type Offer = CapabilityProviderOfferDescriptor;
  type Port = CapabilityProviderPort;
  type Adjudication = CapabilityProviderAdjudication;
  // Compile-time fence: none of the concrete-provider concepts is a key
  // of any contract shape (R055 — providers are a PLUGGABLE class, equal
  // at this seam).
  type _offerFence = Expect<Equal<Extract<keyof Offer, ForbiddenProviderKeys>, never>>;
  type _portFence = Expect<Equal<Extract<keyof Port, ForbiddenProviderKeys>, never>>;
  type _adjudicationFence = Expect<
    Equal<Extract<keyof Adjudication | keyof Adjudication["considered"][number], ForbiddenProviderKeys>, never>
  >;
  // Runtime mirror: the sample offer's own keys carry no forbidden token.
  const sample: Offer = {
    offerId: "offer-00000000",
    capabilityId: "cap-00000000",
    name: "measured execution under stress",
    kind: "execution-quality",
    domain: "futures",
    bearer: { kind: "substrate", substrateId: "substrate-opaque" },
    scope: { tenantId: "tenant", projectId: "project", worldId: "world" },
    providesOrganizationCapabilityIds: [],
    capabilityLineage: { parentCapabilityId: null, version: 1 },
    provenance: [],
    endowments: [],
    lifecycle: { state: "registered", transitions: [] },
  };
  const forbidden = [
    "externalSource",
    "entitlements",
    "billing",
    "listing",
    "adapter",
    "runtime",
  ];
  for (const key of Object.keys(sample)) {
    assert.equal(
      forbidden.includes(key),
      false,
      `the contract key '${key}' is a concrete-provider concept — the contract is provider-neutral (R055)`,
    );
  }
});

test("the port is the minimal neutral surface: identity, list, describe, provenance", () => {
  type Port = CapabilityProviderPort;
  type _required = Expect<
    Equal<RequiredKeys<Port>, "providerId" | "listOffers" | "describeOffer" | "provenanceOf">
  >;
  const port: Port = {
    providerId: "provider-00000000",
    listOffers: () => [],
    describeOffer: () => ({
      ok: false,
      errors: [{ code: "unknown-offer", message: "fail-closed by law" }],
    }),
    provenanceOf: () => ({
      ok: false,
      errors: [{ code: "unknown-offer", message: "fail-closed by law" }],
    }),
  };
  assert.equal(port.listOffers().length, 0);
  const lookup = port.describeOffer("offer-unknown");
  assert.equal(lookup.ok, false);
  if (!lookup.ok) {
    assert.equal(lookup.errors[0]?.code, "unknown-offer");
  }
});

test("the adjudication result is typed yes/no with everything carried", () => {
  type Adjudication = CapabilityProviderAdjudication;
  const yes: Adjudication = {
    ok: true,
    adjudicationId: "adjudication-00000000",
    providerId: "provider-00000000",
    offerId: "offer-00000000",
    capabilityId: "cap-00000000",
    evidence: ["carried verbatim"],
    considered: [
      {
        offerId: "offer-00000000",
        capabilityId: "cap-00000000",
        matched: true,
        evidence: ["carried verbatim"],
        reasons: [],
        resolutionErrors: [],
      },
    ],
  };
  const no: Adjudication = {
    ok: false,
    adjudicationId: "adjudication-00000000",
    providerId: "provider-00000000",
    queryReasons: [],
    offerRejections: [
      {
        offerId: "offer-00000000",
        capabilityId: "cap-00000000",
        reasons: [{ code: "capability-deprecated", message: "carried verbatim" }],
        resolutionErrors: [],
      },
    ],
    considered: [],
  };
  assert.equal(yes.ok, true);
  assert.equal(no.ok, false);
  if (!no.ok) {
    assert.equal(no.offerRejections[0]?.reasons[0]?.code, "capability-deprecated");
  }
});
