/**
 * Typed engine errors for the W013 world module.
 *
 * Spec: spec/WORLD-PROTOCOL.md (ports are typed surfaces), spec/
 * ACCEPTANCE-WORLD-ALPHA.md K (explicit typed denial for unsupported
 * actions), spec/ARCHITECTURE-LOCK.md A4/A5 (four ports, no engine types
 * leaking through them — errors are the engine's own typed surface).
 *
 * The command lifecycle never throws for user-facing failures: those are
 * typed `CommandResult` rejections (contracts). These errors cover (a)
 * query-port reads for which the contract has no optional/failure slot and
 * (b) internal invariant violations (bugs or corrupt journals).
 */

/** The owning work order for a not-yet-implemented engine surface. */
export type NotImplementedSurface =
  | "matching-orderbook" // W014
  | "account-portfolio-risk" // W015
  | "snapshot-branch" // W016
  | "market-generator" // W017
  | "runtime-adapter"; // W018

/** A projection/query that a later work order owns, refused honestly. */
export class NotImplementedInSkeletonError extends Error {
  constructor(
    readonly surface: NotImplementedSurface,
    readonly operation: string,
  ) {
    super(
      `not-implemented-in-skeleton: ${operation} requires the ${surface} engine ` +
        `(${WORK_ORDER_OF_SURFACE[surface]}); the W013 skeleton exposes the ` +
        `command lifecycle, journal and clock only`,
    );
    this.name = "NotImplementedInSkeletonError";
  }
}

export const WORK_ORDER_OF_SURFACE: Readonly<Record<NotImplementedSurface, string>> = {
  "matching-orderbook": "W014 (packages/tradrl-world-sim/orderbook, matching)",
  "account-portfolio-risk": "W015 (packages/tradrl-world-sim/account, portfolio, risk)",
  "snapshot-branch": "W016 (packages/tradrl-world-sim/snapshot, branch)",
  "market-generator": "W017 (packages/tradrl-world-sim/generator)",
  "runtime-adapter": "W018 (packages/tradrl-world-sim/adapter)",
};

/** A referenced world entity that does not exist (query-port read). */
export class UnknownWorldEntityError extends Error {
  constructor(
    readonly kind: "instrument" | "account" | "participant",
    readonly id: string,
  ) {
    super(`unknown ${kind}: ${id}`);
    this.name = "UnknownWorldEntityError";
  }
}

/** An engine-internal law was violated (bug or corrupt journal). */
export class EngineInvariantError extends Error {
  constructor(message: string) {
    super(`world engine invariant violated: ${message}`);
    this.name = "EngineInvariantError";
  }
}

/** The world definition given at engine creation is invalid. */
export class InvalidWorldDefinitionError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`invalid world definition: ${errors.join("; ")}`);
    this.name = "InvalidWorldDefinitionError";
  }
}
