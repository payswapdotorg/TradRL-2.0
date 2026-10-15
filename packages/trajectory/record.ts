/**
 * The trajectory record (W037) — the typed, fail-closed record of ONE
 * agent-world session's outcome.
 *
 * The capture chain, contract-side: a TERMINAL W035 session's telemetry plus
 * its per-pass settled resulting-state reads bind into the W036 evidence
 * stream through the `evidenceStreamOfSession` PAIRING LAW; the stream must
 * pass `validateEvidenceStream` (every violation carried verbatim); the
 * outcome summaries are the W036 evaluation results under the experiment's
 * policy. The A9 determinism metadata and the IMMUTABLE branch lineage
 * complete the record.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — this package MEASURES and RECORDS
 * outcomes; it never enforces (the world runtime's gates stay the sole
 * authority). A14/A15 — the record is simulation/live-agnostic.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentSessionStatus, AgentSessionTelemetry } from "agent-world-protocol";
import { evidenceStreamOfSession, validateEvidenceStream } from "learning-objectives";
import type {
  EvidenceError,
  EvidenceStream,
  EvaluationPolicy,
  PolicyEvaluation,
  PolicyEvaluationError,
  ResultingState,
} from "learning-objectives";
import {
  blankTrajectoryScopeMembers,
  trajectoryIdOf,
  type TrajectoryId,
  type TrajectoryScope,
} from "./identity.js";

// --- the record vocabulary ---
/** The session binding: the terminal session's identity + counters, as data. */
export interface TrajectorySessionBinding {
  readonly sessionId: string;
  readonly worldId: string;
  readonly possessionId: string;
  readonly bodyId: string;
  readonly substrateId: string;
  /** Terminal by law: "detached" (ended) or "failed" (fail-closed stop). */
  readonly status: AgentSessionStatus;
  readonly passCount: number;
  readonly viewsReceived: number;
  readonly observationsSkipped: number;
  readonly commandsIssued: number;
  readonly acked: number;
  readonly rejected: number;
  readonly admissionRefused: number;
}

/** The A9 determinism metadata — enough to reproduce the trajectory. */
export interface TrajectoryDeterminismMetadata {
  /** The digest of the world definition the session ran against. */
  readonly worldDefinitionDigest: string;
  /** The engine/runtime version that produced the session. */
  readonly engineVersion: string;
  /** The declared seed (unseeded runs are not reproducible — refused). */
  readonly seed: string;
}

/** The immutable branch lineage of one trajectory. */
export interface TrajectoryLineage {
  /** The parent trajectory's id (absent = this IS the chain's root). */
  readonly parent: TrajectoryId | undefined;
  /** The chain's root trajectory id (equals the record's own id when root). */
  readonly root: TrajectoryId;
  /** 0 for the root; strictly positive for every branch. */
  readonly ordinal: number;
}

/** The declared lineage at capture (a root trajectory omits it entirely). */
export interface TrajectoryLineageInput {
  readonly parent?: TrajectoryId;
  readonly root?: TrajectoryId;
  readonly ordinal?: number;
}

/**
 * ONE agent-world session's outcome as data: the identity, the session
 * binding, the bound evidence stream, the outcome summaries (the W036
 * evaluation results under the experiment's policy), the determinism
 * metadata, and the immutable branch lineage.
 */
export interface TrajectoryRecord {
  readonly trajectoryId: TrajectoryId;
  readonly scope: TrajectoryScope;
  readonly session: TrajectorySessionBinding;
  readonly stream: EvidenceStream;
  readonly evaluation: PolicyEvaluation;
  readonly determinism: TrajectoryDeterminismMetadata;
  readonly lineage: TrajectoryLineage;
}

// --- the typed error family (closed set) ---

export type TrajectoryErrorCode =
  | "blank-scope-member" // the identity scope is not explicit
  | "identity-mismatch" // the id is not the scope's canonical derivation
  | "non-terminal-session" // a live session has no outcome to record
  | "session-world-mismatch" // the session's world ≠ the scope's world
  | "scope-world-mismatch" // the stream's world ≠ the scope's world
  | "pairing-error" // the pairing law failed (W036 errors carried verbatim)
  | "malformed-evidence" // the §10 chain failed validation (errors carried)
  | "evaluation-error" // the W036 evaluation failed closed (errors carried)
  | "binding-stream-mismatch" // the binding disagrees with the stream
  | "missing-determinism-metadata" // seed/version/digest missing or blank
  | "invalid-lineage"; // a branch-lineage law was violated (named in the message)

/** One typed trajectory error (fail-closed; carries the upstream errors). */
export interface TrajectoryError {
  readonly code: TrajectoryErrorCode;
  readonly message: string;
  /** Present on `pairing-error`/`malformed-evidence`: W036's own errors, verbatim. */
  readonly evidenceErrors?: readonly EvidenceError[];
  /** Present on `evaluation-error`: the W036 policy seam's own errors, verbatim. */
  readonly policyErrors?: readonly PolicyEvaluationError[];
}

export type TrajectoryRecordOutcome =
  | { readonly ok: true; readonly record: TrajectoryRecord }
  | { readonly ok: false; readonly errors: readonly TrajectoryError[] };

// --- the capture builder ---

/** The capture input: one terminal session, its states, policy, metadata. */
export interface TrajectoryCaptureInput {
  readonly scope: TrajectoryScope;
  readonly telemetry: AgentSessionTelemetry;
  /** One settled resulting-state read per pass (the pairing law). */
  readonly resultingStates: readonly ResultingState[];
  /** The experiment's evaluation policy (W036 constructed object). */
  readonly policy: EvaluationPolicy;
  readonly determinism: TrajectoryDeterminismMetadata;
  /** The branch lineage; omit entirely for a root trajectory. */
  readonly lineage?: TrajectoryLineageInput;
}

const TERMINAL_STATUSES: readonly AgentSessionStatus[] = ["detached", "failed"];
const DETERMINISM_MEMBERS = ["worldDefinitionDigest", "engineVersion", "seed"] as const;

function scopeErrors(scope: TrajectoryScope): TrajectoryError[] {
  return blankTrajectoryScopeMembers(scope).map((member) => ({
    code: "blank-scope-member" as const,
    message: `the trajectory scope member '${member}' is blank — tenant/project/world/experiment/session scope is explicit (DOMAIN-MODEL identity law), never defaulted`,
  }));
}

function determinismErrors(determinism: TrajectoryDeterminismMetadata): TrajectoryError[] {
  return DETERMINISM_MEMBERS.filter((member) => String(determinism[member]).trim().length === 0).map(
    (member) => ({
      code: "missing-determinism-metadata" as const,
      message: `the determinism metadata member '${member}' is missing or blank — a trajectory without seed/version/world-digest is not reproducible under A9`,
    }),
  );
}

/** Resolve + validate the declared lineage into the immutable record shape. */
function resolveLineage(
  scope: TrajectoryScope,
  declared: TrajectoryLineageInput | undefined,
): { lineage?: TrajectoryLineage; errors: readonly TrajectoryError[] } {
  const errors: TrajectoryError[] = [];
  const ownId = trajectoryIdOf(scope);
  if (declared === undefined) {
    return { lineage: { parent: undefined, root: ownId, ordinal: 0 }, errors };
  }
  const { parent, root, ordinal } = declared;
  if (parent === undefined) {
    if (root !== undefined || ordinal !== undefined) {
      errors.push({
        code: "invalid-lineage",
        message:
          "a root trajectory (no parent declared) derives its own lineage — declaring root/ordinal without a parent is refused (branch lineage is immutable, fail-closed)",
      });
    }
    return { errors };
  }
  if (parent === ownId) {
    errors.push({
      code: "invalid-lineage",
      message: "a trajectory can never be its own lineage parent (self-parent refused)",
    });
  }
  if (root === undefined) {
    errors.push({
      code: "invalid-lineage",
      message: "a branched trajectory must declare its chain root — lineage is explicit, never defaulted",
    });
    return { errors };
  }
  if (String(root).trim().length === 0) {
    errors.push({
      code: "invalid-lineage",
      message: "the declared lineage root is blank — the chain root is an opaque id, never blank",
    });
    return { errors };
  }
  if (ordinal === undefined || !Number.isInteger(ordinal) || ordinal < 1) {
    errors.push({
      code: "invalid-lineage",
      message: `the branch ordinal must be an integer ≥ 1 (got ${String(ordinal)}) — the root is 0, every branch climbs`,
    });
    return { errors };
  }
  return { lineage: { parent, root, ordinal }, errors };
}

/**
 * Capture one terminal session's outcome as a trajectory record — THE
 * CAPTURE GATE. Every law is checked here, loudly: explicit scope, terminal
 * session, world agreement across scope/session/stream, the pairing law, the
 * §10 chain validation, the policy evaluation, the determinism metadata, and
 * the immutable lineage. The assembled record's own objects (the binding,
 * the lineage, the determinism copy) are frozen; the embedded stream and
 * evaluation stay the caller's data (the capsules reference the telemetry's
 * pass records — copying them would invent data).
 */
export function trajectoryRecordOf(input: TrajectoryCaptureInput): TrajectoryRecordOutcome {
  const errors: TrajectoryError[] = [];

  errors.push(...scopeErrors(input.scope));

  if (!TERMINAL_STATUSES.includes(input.telemetry.status)) {
    errors.push({
      code: "non-terminal-session",
      message: `the session is '${input.telemetry.status}' (not terminal) — a trajectory records a COMPLETED session's outcome; a live session has none (fail-closed)`,
    });
  }

  if (String(input.telemetry.worldId) !== input.scope.worldId) {
    errors.push({
      code: "session-world-mismatch",
      message: `the session ran in world '${String(input.telemetry.worldId)}' but the scope declares '${input.scope.worldId}' — mixed scopes are refused`,
    });
  }

  const paired = evidenceStreamOfSession(input.telemetry, input.resultingStates);
  let stream: EvidenceStream | undefined;
  let evaluation: PolicyEvaluation | undefined;
  if (!paired.ok) {
    errors.push({
      code: "pairing-error",
      message: `[trajectory] the session pairing law failed (${String(paired.errors.length)} error(s)) — one settled resulting-state read per pass, or nothing is recorded`,
      evidenceErrors: paired.errors,
    });
  } else {
    stream = paired.stream;
    if (stream.worldId !== input.scope.worldId) {
      errors.push({
        code: "scope-world-mismatch",
        message: `the evidence stream is world '${stream.worldId}' but the scope declares '${input.scope.worldId}' — mixed scopes are refused`,
      });
    }
    const evidence = validateEvidenceStream(stream);
    if (!evidence.ok) {
      errors.push({
        code: "malformed-evidence",
        message: `[trajectory] the bound evidence stream failed §10 validation (${String(evidence.errors.length)} error(s)) — malformed capsules are never recorded`,
        evidenceErrors: evidence.errors,
      });
    } else {
      const outcome = input.policy.evaluate(stream);
      if (!outcome.ok) {
        errors.push({
          code: "evaluation-error",
          message: `[trajectory] the evaluation policy '${input.policy.descriptor.policyId}' failed closed over the stream (${String(outcome.errors.length)} error(s)) — the outcome summaries are never fabricated`,
          policyErrors: outcome.errors,
        });
      } else {
        evaluation = outcome.evaluation;
      }
    }
  }

  errors.push(...determinismErrors(input.determinism));

  const resolved = resolveLineage(input.scope, input.lineage);
  errors.push(...resolved.errors);

  if (
    errors.length > 0 ||
    stream === undefined ||
    evaluation === undefined ||
    resolved.lineage === undefined
  ) {
    return { ok: false, errors };
  }

  const binding: TrajectorySessionBinding = {
    sessionId: input.scope.sessionId,
    worldId: String(input.telemetry.worldId),
    possessionId: String(input.telemetry.possessionId),
    bodyId: String(input.telemetry.bodyId),
    substrateId: String(input.telemetry.substrateId),
    status: input.telemetry.status,
    passCount: input.telemetry.passes.length,
    viewsReceived: input.telemetry.viewsReceived,
    observationsSkipped: input.telemetry.observationsSkipped,
    commandsIssued: input.telemetry.outcomes.length,
    acked: input.telemetry.acked,
    rejected: input.telemetry.rejected,
    admissionRefused: input.telemetry.admissionRefused,
  };
  const determinism: TrajectoryDeterminismMetadata = { ...input.determinism };
  const lineage: TrajectoryLineage = { ...resolved.lineage };
  Object.freeze(binding);
  Object.freeze(determinism);
  Object.freeze(lineage);
  const record: TrajectoryRecord = {
    trajectoryId: trajectoryIdOf(input.scope),
    scope: input.scope,
    session: binding,
    stream,
    evaluation,
    determinism,
    lineage,
  };
  Object.freeze(record);
  return { ok: true, record };
}

// --- the record re-validation (the store append gate's law) ---

/**
 * Re-validate an ASSEMBLED record against the capture laws (the identity
 * derivation, the binding/stream agreement, the §10 chain, the determinism
 * metadata, the lineage). The outcome summaries are carried as data —
 * RE-DERIVING them is the evaluation/verification consumers' job (W038),
 * not the capture protocol's; this gate never re-scores, it re-proves.
 */
export function validateTrajectoryRecord(record: TrajectoryRecord): TrajectoryRecordOutcome {
  const errors: TrajectoryError[] = [];

  errors.push(...scopeErrors(record.scope));

  if (trajectoryIdOf(record.scope) !== record.trajectoryId) {
    errors.push({
      code: "identity-mismatch",
      message: `the trajectory id is not the canonical derivation of its scope — identity is a function of scope bytes (A9), never an arbitrary label`,
    });
  }
  if (!TERMINAL_STATUSES.includes(record.session.status)) {
    errors.push({
      code: "non-terminal-session",
      message: `the bound session is '${record.session.status}' (not terminal) — a trajectory records a COMPLETED session's outcome`,
    });
  }
  if (record.session.worldId !== record.scope.worldId || record.stream.worldId !== record.scope.worldId) {
    errors.push({
      code: "scope-world-mismatch",
      message: `the record's session/stream world disagrees with the scope's world '${record.scope.worldId}' — mixed scopes are refused`,
    });
  }
  if (
    record.session.passCount !== record.stream.capsules.length ||
    record.session.possessionId !== String(record.stream.possessionId)
  ) {
    errors.push({
      code: "binding-stream-mismatch",
      message: `the session binding (passCount ${String(record.session.passCount)}, possession ${record.session.possessionId}) disagrees with the bound stream (${String(record.stream.capsules.length)} capsule(s), possession ${String(record.stream.possessionId)}) — the binding summarizes the stream, never invents it`,
    });
  }
  const evidence = validateEvidenceStream(record.stream);
  if (!evidence.ok) {
    errors.push({
      code: "malformed-evidence",
      message: `[trajectory] the bound evidence stream failed §10 validation (${String(evidence.errors.length)} error(s))`,
      evidenceErrors: evidence.errors,
    });
  }
  errors.push(...determinismErrors(record.determinism));
  if (record.lineage.parent === undefined) {
    if (record.lineage.root !== record.trajectoryId || record.lineage.ordinal !== 0) {
      errors.push({
        code: "invalid-lineage",
        message: "a root trajectory's lineage must be (root = own id, ordinal 0) — branch lineage is immutable",
      });
    }
  } else if (
    record.lineage.parent === record.trajectoryId ||
    String(record.lineage.root).trim().length === 0 ||
    !Number.isInteger(record.lineage.ordinal) ||
    record.lineage.ordinal < 1
  ) {
    errors.push({
      code: "invalid-lineage",
      message: "the branch lineage is invalid (self-parent, blank root, or ordinal < 1) — branch lineage is immutable",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, record };
}
