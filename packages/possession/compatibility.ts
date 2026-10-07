/**
 * The compatibility checker (W034): can THIS substrate possess THIS body?
 *
 * Spec: spec/REQUIREMENTS.md R051 — "Possession has compatibility
 * evidence". Evidence is typed and complete: an ok outcome carries the
 * `checked` list (exactly what was proven), a failing outcome carries
 * EVERY incompatibility, each naming the exact field/limit mismatch in
 * the W032 envelope-breach style (`{limit, substrateValue, bodyValue}`).
 *
 * Two levels:
 * - `checkPossessionCompatibility(descriptor, world?)` — the declaration
 *   level: the descriptor's own validity, the substrate's proposed
 *   command kinds against the body's embodiment (a substrate declaring a
 *   kind the body cannot issue is incompatible, never silently clipped),
 *   the substrate's rate envelope against the possession's rate grant,
 *   and — when a world is provided — the W032 attach constraints
 *   (`validateBodyAttachment`, the body must bind the REAL world; its
 *   errors are carried verbatim).
 * - `checkDecisionStreamCompatibility(stream, descriptor)` — the decision
 *   level, the ULTIMATE proof: W033's `validateDecisionStream` (the
 *   substrate's actual stream against the body's embodiment — command
 *   kinds, instruments, order kinds, TIFs, seat/account/world, rate) plus
 *   the possession-scope layer (proposals beyond the possession's grant
 *   are typed incompatibilities, never silently clipped).
 *
 * Deterministic order throughout; no world IO (the world is a passed-in
 * declaration); pure functions.
 */

import type { WorldDefinition } from "tradrl-world-sim/world";
import { validateBodyAttachment } from "agent-body/validate";
import { validateDecisionStream } from "cognitive-substrate/validate";
import { decisionStreamDigestOf } from "cognitive-substrate/validate";
import type { DecisionStream } from "tradrl-world-contracts/cognitiveSubstrate";
import type {
  PossessionCheckKind,
  PossessionCompatibilityOutcome,
  PossessionDescriptor,
  PossessionIncompatibility,
} from "./contracts.js";
import { validatePossessionDescriptor } from "./validate.js";

function incompatible(entry: PossessionIncompatibility): PossessionIncompatibility {
  return entry;
}

/**
 * The declaration-level check: the possession descriptor's validity, the
 * substrate's proposed command kinds vs the body's embodiment, the
 * substrate's rate envelope vs the possession's rate grant, and (when a
 * world is given) the W032 attach constraints. `checked` on the ok branch
 * names exactly what was proven — without a world the attach constraints
 * are NOT claimed, and without a declared rate grant the rate comparison
 * is NOT claimed.
 */
export function checkPossessionCompatibility(
  descriptor: PossessionDescriptor,
  world?: WorldDefinition,
): PossessionCompatibilityOutcome {
  const incompatibilities: PossessionIncompatibility[] = [];
  const checked: PossessionCheckKind[] = ["descriptor-structure"];

  const validation = validatePossessionDescriptor(descriptor);
  if (!validation.ok) {
    // Structural failure: later checks assume a valid descriptor — the
    // W032 short-circuit precedent (reported by itself).
    return {
      ok: false,
      incompatibilities: [
        incompatible({
          code: "descriptor-invalid",
          field: "descriptor",
          message: `the possession descriptor is invalid (${String(validation.errors.length)} error(s), carried verbatim) — compatibility cannot be proven`,
          descriptorErrors: validation.errors,
        }),
      ],
    };
  }

  // The substrate's proposed command kinds vs the body's embodiment: a
  // substrate may propose FEWER kinds than the body embodies (the body is
  // the wider capability), never kinds the body cannot issue.
  checked.push("embodied-command-kinds");
  const embodied = descriptor.body.embodiment.commandKinds;
  for (const kind of descriptor.substrate.commandKinds) {
    if (!embodied.includes(kind)) {
      incompatibilities.push(
        incompatible({
          code: "command-kind-not-embodied",
          field: "substrate.commandKinds",
          message:
            `the substrate proposes command kind '${kind}' which the body's embodiment does not declare ` +
            `(embodied: ${embodied.join(", ")}) — incompatible, never silently clipped`,
          mismatch: {
            limit: "body.embodiment.commandKinds",
            substrateValue: kind,
            bodyValue: embodied.join(", "),
          },
        }),
      );
    }
  }

  // The substrate's rate envelope vs the possession's rate grant: the
  // grant must COVER the substrate's declared behavior (a substrate
  // emitting more per view than the grant allows, or expecting tighter
  // view spacing than the grant honors, is incompatible — the W032
  // body-looser-than-world direction).
  const grant = descriptor.scope.decisionRate;
  if (grant !== undefined) {
    checked.push("rate-grant");
    const substrateRate = descriptor.substrate.decisionRate;
    if (substrateRate.maxDecisionsPerView > grant.maxDecisionsPerView) {
      incompatibilities.push(
        incompatible({
          code: "rate-beyond-grant",
          field: "substrate.decisionRate.maxDecisionsPerView",
          message:
            `the substrate declares up to ${String(substrateRate.maxDecisionsPerView)} decisions per view ` +
            `but the possession's grant allows ${String(grant.maxDecisionsPerView)} — incompatible, never silently clipped`,
          mismatch: {
            limit: "scope.decisionRate.maxDecisionsPerView",
            substrateValue: String(substrateRate.maxDecisionsPerView),
            bodyValue: String(grant.maxDecisionsPerView),
          },
        }),
      );
    }
    if (
      grant.minViewIntervalMs !== undefined &&
      substrateRate.minViewIntervalMs !== undefined &&
      substrateRate.minViewIntervalMs < grant.minViewIntervalMs
    ) {
      incompatibilities.push(
        incompatible({
          code: "view-interval-below-grant",
          field: "substrate.decisionRate.minViewIntervalMs",
          message:
            `the substrate expects views at least every ${String(substrateRate.minViewIntervalMs)}ms ` +
            `but the possession's grant honors no tighter than ${String(grant.minViewIntervalMs)}ms — incompatible`,
          mismatch: {
            limit: "scope.decisionRate.minViewIntervalMs",
            substrateValue: String(substrateRate.minViewIntervalMs),
            bodyValue: String(grant.minViewIntervalMs),
          },
        }),
      );
    }
  }

  // The W032 attach constraints (only claimed when a world was provided).
  if (world !== undefined) {
    checked.push("body-attachment");
    const attach = validateBodyAttachment(descriptor.body, world);
    if (!attach.ok) {
      incompatibilities.push(
        incompatible({
          code: "body-attachment-failed",
          field: "body",
          message: `the body cannot attach to world ${String(world.scope.worldId)} (${String(attach.errors.length)} W032 error(s), carried verbatim)`,
          bodyErrors: attach.errors,
        }),
      );
    }
  }

  if (incompatibilities.length > 0) {
    return { ok: false, incompatibilities };
  }
  return { ok: true, checked };
}

/**
 * The decision-level check — the ULTIMATE compatibility proof (a
 * substrate's stream against the body): W033's `validateDecisionStream`
 * (stream vs descriptor and vs the body's embodiment) plus the
 * possession-scope layer (command kinds and instruments beyond the
 * possession's grant; a stream emitting more decisions than the grant's
 * cap). The ok branch cites the proven stream's content digest (the
 * `decisionStreamDigestOf` family — R051 evidence).
 */
export function checkDecisionStreamCompatibility(
  stream: DecisionStream,
  descriptor: PossessionDescriptor,
): PossessionCompatibilityOutcome {
  const incompatibilities: PossessionIncompatibility[] = [];
  const checked: PossessionCheckKind[] = ["descriptor-structure", "decision-stream"];

  const validation = validatePossessionDescriptor(descriptor);
  if (!validation.ok) {
    return {
      ok: false,
      incompatibilities: [
        incompatible({
          code: "descriptor-invalid",
          field: "descriptor",
          message: `the possession descriptor is invalid (${String(validation.errors.length)} error(s), carried verbatim) — a stream cannot be proven against it`,
          descriptorErrors: validation.errors,
        }),
      ],
    };
  }

  // W033's stream law: the substrate's stream against the body's
  // embodiment (command kinds, instruments, order kinds, TIFs, the seat,
  // the account, the world, the clock law, the auditability spine).
  const streamOutcome = validateDecisionStream(
    stream,
    descriptor.body,
    descriptor.substrate,
  );
  if (!streamOutcome.ok) {
    incompatibilities.push(
      incompatible({
        code: "stream-invalid",
        field: "stream",
        message: `the decision stream violates the W033 stream law (${String(streamOutcome.errors.length)} error(s), carried verbatim)`,
        streamErrors: streamOutcome.errors,
      }),
    );
  }

  // The possession-scope layer: the W033 law proves the stream against
  // the BODY; this proves it against the POSSESSION's narrower grant.
  const scope = descriptor.scope;
  for (const [index, decision] of stream.decisions.entries()) {
    const at = `decisions[${String(index)}]`;
    const { command } = decision;
    if (!scope.commandKinds.includes(command.kind)) {
      incompatibilities.push(
        incompatible({
          code: "command-kind-not-in-scope",
          field: `${at}.command.kind`,
          message:
            `${at} proposes a '${command.kind}' command inside the body's embodiment but outside this possession's grant ` +
            `(granted: ${scope.commandKinds.join(", ")}) — incompatible, never silently clipped`,
          mismatch: {
            limit: "scope.commandKinds",
            substrateValue: command.kind,
            bodyValue: scope.commandKinds.join(", "),
          },
        }),
      );
    }
    if (
      command.kind === "submit-order" ||
      command.kind === "close-position" ||
      (command.kind === "add-annotation" && command.instrumentId !== undefined)
    ) {
      const instrumentId = command.instrumentId as string;
      if (!scope.instruments.includes(instrumentId as never)) {
        incompatibilities.push(
          incompatible({
            code: "instrument-not-in-scope",
            field: `${at}.command.instrumentId`,
            message:
              `${at} touches instrument ${instrumentId} inside the body's embodiment but outside this possession's grant ` +
              `(granted: ${scope.instruments.map((one) => String(one)).join(", ")}) — incompatible, never silently clipped`,
            mismatch: {
              limit: "scope.instruments",
              substrateValue: instrumentId,
              bodyValue: scope.instruments.map((one) => String(one)).join(", "),
            },
          }),
        );
      }
    }
  }

  // The scope's rate cap against the stream's actual emission.
  if (
    scope.decisionRate !== undefined &&
    stream.decisions.length > scope.decisionRate.maxDecisionsPerView
  ) {
    incompatibilities.push(
      incompatible({
        code: "rate-beyond-grant",
        field: "stream.decisions",
        message:
          `the stream emits ${String(stream.decisions.length)} decisions for one view but the possession's grant allows ` +
          `${String(scope.decisionRate.maxDecisionsPerView)} — never silently truncated`,
        mismatch: {
          limit: "scope.decisionRate.maxDecisionsPerView",
          substrateValue: String(stream.decisions.length),
          bodyValue: String(scope.decisionRate.maxDecisionsPerView),
        },
      }),
    );
  }

  if (incompatibilities.length > 0) {
    return { ok: false, incompatibilities };
  }
  return { ok: true, checked, streamDigest: decisionStreamDigestOf(stream) };
}
