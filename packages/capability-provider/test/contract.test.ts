/**
 * The contracts/capability drift guard (W056) — the implementation
 * satisfies the canonical contract types at COMPILE time (this file is
 * type-checked by `tsc -p .`, pulling the contract sources in through
 * the relative import — the contracts/ui pattern) and the behavioral
 * laws at RUNTIME. Plus the R055 provider-neutrality source scan.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type {
  CapabilityProviderAdjudication,
  CapabilityProviderOfferDescriptor,
  CapabilityProviderPort,
} from "../../../contracts/capability/src/capability-provider-contract.js";
import type { ProviderOffer } from "../registration.js";
import type { CapabilityProviderPort as PackagePort } from "../port.js";
import type { ProviderMatchOutcome } from "../match.js";
import { referenceProviderAdapter } from "../port.js";
import { registerProvider } from "../register.js";
import { declarationFixture, emptyRegistry } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Compile-time drift guards (the contracts/ui pattern): the package's
// real types satisfy the canonical contract types.
// ---------------------------------------------------------------------------

const _offerDriftGuard: CapabilityProviderOfferDescriptor = {} as ProviderOffer;
const _portDriftGuard: CapabilityProviderPort = {} as PackagePort;
const _adjudicationDriftGuard: CapabilityProviderAdjudication = {} as ProviderMatchOutcome;
void _offerDriftGuard;
void _portDriftGuard;
void _adjudicationDriftGuard;

// ---------------------------------------------------------------------------
// Runtime behavioral mirrors
// ---------------------------------------------------------------------------

test("a registered offer satisfies the contract's descriptor shape at runtime", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  for (const offer of registered.registration.offers) {
    const descriptor: CapabilityProviderOfferDescriptor = offer;
    assert.equal(typeof descriptor.offerId, "string");
    assert.equal(typeof descriptor.capabilityId, "string");
    assert.ok(["execution-quality", "alpha-generation", "risk-control", "market-making", "information-synthesis"].includes(descriptor.kind));
    assert.ok(["equities", "futures", "fx", "crypto-spot"].includes(descriptor.domain));
    assert.ok(["registered", "deprecated", "revoked"].includes(descriptor.lifecycle.state));
    assert.ok(Array.isArray(descriptor.provenance));
    assert.ok(descriptor.provenance.length > 0);
    assert.ok(Array.isArray(descriptor.endowments));
  }
});

test("the reference adapter satisfies the contract's port shape at runtime", () => {
  const registered = registerProvider(emptyRegistry(), declarationFixture());
  if (!registered.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const port: CapabilityProviderPort = referenceProviderAdapter(registered.registration);
  assert.equal(typeof port.providerId, "string");
  const offers = port.listOffers();
  assert.equal(offers.length, 2);
  const lookup = port.describeOffer(offers[0]?.offerId ?? "");
  assert.equal(lookup.ok, true);
  const unknown = port.describeOffer("offer-does-not-exist");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.errors[0]?.code, "unknown-offer");
  }
});

// ---------------------------------------------------------------------------
// R055 — provider-neutrality: the package's OWN source never names a
// concrete provider concept (the concrete adapters are later lanes'
// packages). Scanned over the seven source modules, at runtime.
// ---------------------------------------------------------------------------

test("the package source is provider-neutral: no concrete-provider tokens anywhere", async () => {
  const modules = [
    "identity.ts",
    "registration.ts",
    "register.ts",
    "port.ts",
    "match.ts",
    "validate.ts",
    "index.ts",
  ];
  const forbidden = /\b(external-source|entitlement|marketplace|vendor|billing|listing)\b/i;
  for (const module of modules) {
    const path = fileURLToPath(new URL(`../${module}`, import.meta.url));
    const source = await readFile(path, "utf8");
    assert.equal(
      forbidden.test(source),
      false,
      `packages/capability-provider/${module} names a concrete-provider concept — the interface is provider-neutral (R055)`,
    );
  }
});
