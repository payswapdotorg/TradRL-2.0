/**
 * The action protocol (W035): how a substrate's `DecisionStream` becomes
 * `WorldCommand`s through the Body's embodiment.
 *
 * THE ADMISSION GATE (fail-closed, the W033 law): before ANY command
 * issues, the stream is proven lawful by W034's decision-level check —
 * W033's `validateDecisionStream` (the stream vs the substrate descriptor:
 * identity, seed, rate envelope, issuedAt = the view's asOf, the seat, the
 * account, the world; and vs the BODY's embodiment: command kinds,
 * instruments, order kinds, time-in-force) plus the possession-scope layer
 * (the stream vs the POSSESSION's narrower grant). A stream that fails is
 * INVALID as a whole — commands outside the embodiment NEVER issue, never
 * a partial acceptance, never a silent clip. The refusal is typed data
 * (the incompatibilities verbatim) — an outcome, not an error.
 *
 * THE ISSUANCE (the W023 discipline): on admission, the stream's commands
 * issue through the SAME typed CommandPort everyone else uses (A4/A15),
 * in stream order, one `await` per command — the runtime's issuance order
 * IS the wire order; the engine's arrival-order queue is the single
 * serializer (FIFO). Each typed outcome (ack OR rejection — the port's own
 * gates decide) is recorded verbatim; typed rejections are outcomes, never
 * fabricated success, never failures.
 *
 * DETERMINISM (A9): no ids are invented here (the commands carry the
 * substrate's deterministic ids), no clocks are read (issuedAt is the
 * stream's own asOf, gate-checked), no randomness — same admitted stream ⇒
 * same issued command sequence ⇒ same outcomes.
 */

import type { CommandResult, WorldCommand } from "tradrl-world-contracts";
import type { DecisionStream } from "tradrl-world-contracts/cognitiveSubstrate";
import { checkDecisionStreamCompatibility } from "possession/compatibility";
import type { PossessionDescriptor } from "possession/contracts";
import type { AgentActionResult, AgentCommandOutcome, AgentWorldClient } from "./contracts.js";

/** Issue one admitted command through the real port (the full closed family). */
async function issueCommand(
  client: AgentWorldClient,
  command: WorldCommand,
): Promise<CommandResult> {
  switch (command.kind) {
    case "submit-order":
      return client.command.submitOrder(command);
    case "cancel-order":
      return client.command.cancelOrder(command);
    case "replace-order":
      return client.command.replaceOrder(command);
    case "close-position":
      return client.command.closePosition(command);
    case "add-annotation":
      return client.command.addAnnotation(command);
    case "create-snapshot":
      return client.command.createSnapshot(command);
    case "branch-world":
      return client.command.branchWorld(command);
    case "set-scenario":
      return client.command.setScenario(command);
    default: {
      // Exhaustiveness guard: the WorldCommand union is closed; an escapee
      // is a protocol breach and fails closed (never silently dropped).
      const exhaustive: never = command;
      throw new Error(`[agent-world-protocol] unknown command kind: ${String(exhaustive)}`);
    }
  }
}

/**
 * Act on one decision stream: the admission gate first, then — only on
 * admission — the FIFO issuance through the CommandPort with typed
 * outcomes. A refused stream issues NOTHING (the whole stream is the unit
 * of admission; the refusal is recorded as data).
 */
export async function issueDecisionStream(
  client: AgentWorldClient,
  possession: PossessionDescriptor,
  stream: DecisionStream,
): Promise<AgentActionResult> {
  const admission = checkDecisionStreamCompatibility(stream, possession);
  if (!admission.ok) {
    // Commands outside the embodiment/scope NEVER issue — fail-closed for
    // the whole stream, with every incompatibility carried verbatim.
    return { admission, outcomes: [] };
  }

  const outcomes: AgentCommandOutcome[] = [];
  for (const decision of stream.decisions) {
    const { command } = decision;
    const result = await issueCommand(client, command);
    outcomes.push({
      decisionId: decision.decisionId,
      commandId: command.commandId,
      commandKind: command.kind,
      result,
    });
  }
  return { admission, outcomes };
}
