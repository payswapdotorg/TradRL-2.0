/**
 * Typed ABIDES-adapter violations (W024 `tradrl-adapters-abides`).
 *
 * Spec: spec/WORK-ITEMS.md W024 — "fail-closed everywhere: unknown agent
 * kind, malformed latency spec, unregistered venue, out-of-order messages →
 * typed errors; never silent defaults". Those four kinds are the work
 * order's required taxonomy; the rest are the structural failures of the
 * adapter's own layers (definition, clock, observation, lifecycle).
 *
 * Discipline (the W021 `NautilusMappingViolation` / W026
 * `CryptoMappingViolation` pattern): configuration/structural failures THROW
 * this typed error at the boundary where they are detected — construction,
 * registration, enqueue — while command-lifecycle outcomes (validation,
 * authorization, domain rules) are TYPED REJECTIONS
 * (`CommandResult.rejected`), never throws: participants consume typed
 * outcomes, not exceptions (spec/WORLD-PROTOCOL.md "Command lifecycle").
 *
 * CLEAN-ROOM PROVENANCE (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md, ABIDES
 * row): this adapter reimplements the documented public semantics of an
 * ABIDES-style reactive market as ORIGINAL TypeScript; zero upstream code
 * copied, no pinned-commit obligation triggered. See README.md.
 */

/** Everything the adapter detects as a structural, fail-closed violation. */
export type AbidesAdapterErrorKind =
  | "unknown-agent-kind" // an agent declaration names a kind the registry does not offer
  | "malformed-latency-spec" // a latency spec fails validation (negative, non-integer, min > max, NaN, non-object)
  | "unregistered-venue" // an instrument (or venue reference) names a venue absent from the world's venue registry
  | "out-of-order-message" // a message is sent from the simulation future, or would arrive in the delivered past
  | "duplicate-agent" // a second agent declaration reuses a registered agentId
  | "unknown-agent" // an agent declaration references a participant that is not in the world population
  | "view-config-mismatch" // an agent declaration disagrees with its participant account / registered instruments / own agent identity
  | "malformed-world-definition" // the world definition fails construction-time validation (blank ids, duplicate ids, bad decimals)
  | "malformed-wake-schedule" // a wake schedule fails validation (before the clock origin, non-positive interval)
  | "malformed-agent-config" // an agent declaration's kind-specific configuration fails validation
  | "invalid-clock-command" // a clock call is structurally invalid (backwards seek, non-positive step, paused advance)
  | "wall-time-forbidden" // a clock call would couple simulation time to wall time (A7 — fails closed)
  | "unknown-instrument" // a query/command names an instrument the venue does not list
  | "unknown-event" // jumpToEvent names an event outside the journal
  | "message-after-close" // the world was disposed while messages were still in flight
  | "reactive-loop-overflow" // one clock advance exceeded the reactive message budget (event storm guard)
  | "agent-observation-surface" // a latency-firewalled agent client was asked beyond its declared surface (A7)
  | "live-execution-not-permitted"; // a live-execution path was attempted (A14 — unreachable by construction, kept loud)

/** The typed adapter error: a closed `kind` plus a precise, human-readable detail. */
export class AbidesAdapterError extends Error {
  readonly kind: AbidesAdapterErrorKind;

  constructor(kind: AbidesAdapterErrorKind, detail: string) {
    super(`[abides:${kind}] ${detail}`);
    this.name = "AbidesAdapterError";
    this.kind = kind;
  }
}

/** Throw a typed violation (the loud path — never a silent default). */
export function abidesError(kind: AbidesAdapterErrorKind, detail: string): never {
  throw new AbidesAdapterError(kind, detail);
}
