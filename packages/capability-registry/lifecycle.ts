/**
 * Capability lifecycle (W040) — registered / deprecated / revoked as typed
 * data with IMMUTABLE transitions.
 *
 * Spec: the W040 order's lifecycle law: a deprecated capability still
 * RESOLVES for lineage (./query.ts `resolveCapability` answers regardless
 * of state) but FAILS demand-matching LOUDLY (./query.ts
 * `matchCapabilityDemand` names the deprecated capability and its state —
 * never a silent no). Transitions are immutable values: every operation
 * returns a NEW registry with the entry REPLACED (descriptor untouched,
 * state + transition record carried forward); the input registry is never
 * mutated. Reasons are rationale-as-data (§10 — non-blank, never a clock
 * read: A9 has no time).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CapabilityError, CapabilityRegistry, RegistryEntry } from "./descriptor.js";
import type { CapabilityId } from "./identity.js";

export type LifecycleOutcome =
  | { readonly ok: true; readonly registry: CapabilityRegistry; readonly entry: RegistryEntry }
  | { readonly ok: false; readonly errors: readonly CapabilityError[] };

function error(code: CapabilityError["code"], message: string, entryId?: string): CapabilityError {
  return { code, message, ...(entryId === undefined ? {} : { entryId }) };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * The shared transition law: only moves AWAY from "registered" —
 * registered → deprecated, registered → revoked, deprecated → revoked;
 * revoked is terminal and deprecated is not re-deprecatable. Violations
 * are the typed `invalid-lifecycle-transition` naming from → to.
 */
function transitionCapability(
  registry: CapabilityRegistry,
  capabilityId: CapabilityId,
  to: "deprecated" | "revoked",
  reason: string,
): LifecycleOutcome {
  const errors: CapabilityError[] = [];
  if (blank(reason)) {
    errors.push(error("blank-reason", `the '${to}' transition's reason is blank — rationale-as-data is non-blank (the §10 discipline)`, String(capabilityId)));
  }
  const entry = registry.entries.find(
    (candidate) => String(candidate.descriptor.capabilityId) === String(capabilityId),
  );
  if (entry === undefined) {
    errors.push(error("unknown-capability", `capability '${String(capabilityId)}' is not registered — the registry resolves exact ids only`, String(capabilityId)));
    return { ok: false, errors };
  }
  const from = entry.state;
  const legal = from === "registered" || (from === "deprecated" && to === "revoked");
  if (!legal) {
    errors.push(error("invalid-lifecycle-transition", `capability '${String(capabilityId)}' cannot transition '${from}' → '${to}' — lifecycle transitions are registered → deprecated → revoked, and revoked is terminal`, String(capabilityId)));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const transitioned: RegistryEntry = {
    descriptor: entry.descriptor,
    state: to,
    transitions: [...entry.transitions, { to, reason }],
  };
  const entries = registry.entries.map((candidate) =>
    candidate === entry ? transitioned : candidate,
  );
  return { ok: true, registry: { scope: registry.scope, entries }, entry: transitioned };
}

/**
 * Deprecate a registered capability: it stays resolvable for lineage (its
 * citations and lineage remain first-class data) but fails demand-matching
 * loudly from now on. The reason is recorded as data.
 */
export function deprecateCapability(
  registry: CapabilityRegistry,
  capabilityId: CapabilityId,
  reason: string,
): LifecycleOutcome {
  return transitionCapability(registry, capabilityId, "deprecated", reason);
}

/**
 * Revoke a capability (registered or deprecated): terminal. It stays
 * resolvable for lineage — the historical citations are facts — but fails
 * demand-matching loudly, forever.
 */
export function revokeCapability(
  registry: CapabilityRegistry,
  capabilityId: CapabilityId,
  reason: string,
): LifecycleOutcome {
  return transitionCapability(registry, capabilityId, "revoked", reason);
}
