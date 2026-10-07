/**
 * Script-file loading, validation and command building (W031).
 *
 * The script file is a JSON array of ordered entries, each with an explicit
 * `id` and exactly ONE driver:
 * - `{ "id": "...", "clock": { "op": "step", "deltaMs": 5000 } }` — a clock
 *   operation (step / seek / pause / play / set-speed / follow-realtime /
 *   jump-to-event);
 * - `{ "id": "...", "command": { "kind": "submit-order", ... } }` — a world
 *   command (the W003 `WorldCommand` JSON, minus the CLI-fillable envelope
 *   fields).
 *
 * Envelope fill discipline (deterministic, documented):
 * - `commandId` and `issuedBy` are REQUIRED on every command (explicit ids —
 *   the work order's law);
 * - `worldId` MAY be omitted — the CLI fills the definition's world id; a
 *   present-but-different value is a load-time script-invalid error (fail
 *   fast, never a per-entry surprise);
 * - `issuedAt` MAY be omitted — the CLI fills the CURRENT SIMULATION TIME at
 *   execution, a deterministic function of (definition, script) — so the
 *   same script always produces the same command stream hash (A9);
 * - `correlationId` passes through verbatim when present.
 *
 * Structural validation is loud (every entry problem names the entry id);
 * SEMANTIC rules (unknown instrument, limit order without a limit price,
 * duplicate command ids, unknown participant, ...) belong to the engine's
 * command lifecycle, whose typed rejections are recorded per entry in the
 * run report — honest deterministic outcomes, not process failures.
 */

import type { WorldCommand, WorldId } from "tradrl-world-contracts";
import type { TimestampMs } from "tradrl-world-contracts";
import { readJsonFile } from "./jsonFile.js";
import { CliError } from "./errors.js";

/** The clock operations a script entry can drive (the ClockPort surface). */
export type ScriptClockOperation =
  | { readonly op: "step"; readonly deltaMs?: number }
  | { readonly op: "seek"; readonly to: number }
  | { readonly op: "pause" }
  | { readonly op: "play" }
  | { readonly op: "set-speed"; readonly speed: number }
  | { readonly op: "follow-realtime"; readonly enabled: boolean }
  | { readonly op: "jump-to-event"; readonly target: string | number };

/** A validated script entry (exactly one driver). */
export interface ScriptEntry {
  readonly id: string;
  readonly clock?: ScriptClockOperation;
  readonly command?: WorldCommand;
}

/** The loaded script (entries in file order). */
export interface LoadedScript {
  readonly path: string;
  readonly entries: readonly ScriptEntry[];
}

const COMMAND_KINDS: ReadonlySet<string> = new Set([
  "submit-order",
  "cancel-order",
  "replace-order",
  "close-position",
  "add-annotation",
  "create-snapshot",
  "branch-world",
  "set-scenario",
]);

const ORDER_KINDS: ReadonlySet<string> = new Set(["market", "limit", "stop", "stop-limit"]);
const ORDER_SIDES: ReadonlySet<string> = new Set(["buy", "sell"]);
const TIME_IN_FORCE: ReadonlySet<string> = new Set(["GTC", "IOC", "FOK"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

class ScriptInvalid extends CliError {
  constructor(message: string, details?: readonly string[]) {
    super("script-invalid", message, details);
  }
}

function validateClockOperation(raw: unknown, entryId: string): ScriptClockOperation {
  if (!isRecord(raw)) {
    throw new ScriptInvalid(`entry '${entryId}': 'clock' must be an object`);
  }
  const op = raw.op;
  switch (op) {
    case "step":
      if (raw.deltaMs !== undefined && !isFiniteNumber(raw.deltaMs)) {
        throw new ScriptInvalid(`entry '${entryId}': clock step 'deltaMs' must be a finite number`);
      }
      return { op: "step", ...(raw.deltaMs === undefined ? {} : { deltaMs: raw.deltaMs }) };
    case "seek":
      if (!isFiniteNumber(raw.to)) {
        throw new ScriptInvalid(`entry '${entryId}': clock seek requires a finite 'to' timestamp`);
      }
      return { op: "seek", to: raw.to };
    case "pause":
      return { op: "pause" };
    case "play":
      return { op: "play" };
    case "set-speed":
      if (!isFiniteNumber(raw.speed)) {
        throw new ScriptInvalid(`entry '${entryId}': clock set-speed requires a finite 'speed'`);
      }
      return { op: "set-speed", speed: raw.speed };
    case "follow-realtime":
      if (typeof raw.enabled !== "boolean") {
        throw new ScriptInvalid(`entry '${entryId}': clock follow-realtime requires 'enabled' (boolean)`);
      }
      return { op: "follow-realtime", enabled: raw.enabled };
    case "jump-to-event":
      if (typeof raw.target !== "string" && !isFiniteNumber(raw.target)) {
        throw new ScriptInvalid(`entry '${entryId}': clock jump-to-event requires 'target' (event id string or sequence number)`);
      }
      return { op: "jump-to-event", target: raw.target };
    default:
      throw new ScriptInvalid(
        `entry '${entryId}': unknown clock op '${String(op)}' (step, seek, pause, play, set-speed, follow-realtime, jump-to-event)`,
      );
  }
}

function validateSubmission(raw: unknown, entryId: string): void {
  if (!isRecord(raw)) {
    throw new ScriptInvalid(`entry '${entryId}': submit-order requires a 'submission' object`);
  }
  const problems: string[] = [];
  if (!ORDER_KINDS.has(String(raw.kind))) problems.push("'submission.kind' must be market, limit, stop or stop-limit");
  if (!ORDER_SIDES.has(String(raw.side))) problems.push("'submission.side' must be buy or sell");
  if (!isNonBlankString(raw.quantity)) problems.push("'submission.quantity' must be a non-blank decimal string");
  if (raw.limitPrice !== undefined && !isNonBlankString(raw.limitPrice)) {
    problems.push("'submission.limitPrice' must be decimal string text when present");
  }
  if (raw.stopPrice !== undefined && !isNonBlankString(raw.stopPrice)) {
    problems.push("'submission.stopPrice' must be decimal string text when present");
  }
  const constraints = raw.constraints;
  if (!isRecord(constraints)) {
    problems.push("'submission.constraints' must be an object with timeInForce");
  } else {
    if (!TIME_IN_FORCE.has(String(constraints.timeInForce))) {
      problems.push("'submission.constraints.timeInForce' must be GTC, IOC or FOK");
    }
    if (constraints.postOnly !== undefined && typeof constraints.postOnly !== "boolean") {
      problems.push("'submission.constraints.postOnly' must be boolean when present");
    }
    if (constraints.reduceOnly !== undefined && typeof constraints.reduceOnly !== "boolean") {
      problems.push("'submission.constraints.reduceOnly' must be boolean when present");
    }
  }
  if (problems.length > 0) {
    throw new ScriptInvalid(`entry '${entryId}': invalid submit-order submission`, problems);
  }
}

function validateConstraintsShape(raw: unknown, entryId: string): void {
  if (raw === undefined) {
    return;
  }
  if (!isRecord(raw) || !TIME_IN_FORCE.has(String(raw.timeInForce))) {
    throw new ScriptInvalid(`entry '${entryId}': 'constraints' must be an object with timeInForce (GTC, IOC or FOK)`);
  }
}

/**
 * Validate one raw command JSON into the typed `WorldCommand` shape. The
 * envelope fields (worldId/issuedAt/correlationId) are optional here and
 * filled at execution (see module docs).
 */
export function validateCommandInput(
  raw: unknown,
  entryId: string,
  expectedWorldId: WorldId,
): WorldCommand {
  if (!isRecord(raw)) {
    throw new ScriptInvalid(`entry '${entryId}': 'command' must be an object`);
  }
  const kind = String(raw.kind);
  if (!COMMAND_KINDS.has(kind)) {
    throw new ScriptInvalid(
      `entry '${entryId}': unknown command kind '${kind}' (submit-order, cancel-order, replace-order, close-position, add-annotation, create-snapshot, branch-world, set-scenario)`,
    );
  }
  const problems: string[] = [];
  if (!isNonBlankString(raw.commandId)) problems.push("'commandId' must be a non-blank string");
  if (!isNonBlankString(raw.issuedBy)) problems.push("'issuedBy' must be a non-blank string");
  if (raw.issuedAt !== undefined && !isFiniteNumber(raw.issuedAt)) {
    problems.push("'issuedAt' must be a finite timestamp when present (omit to stamp the simulation time)");
  }
  if (raw.correlationId !== undefined && !isNonBlankString(raw.correlationId)) {
    problems.push("'correlationId' must be a non-blank string when present");
  }
  if (raw.worldId !== undefined && raw.worldId !== expectedWorldId) {
    problems.push(`'worldId' ${String(raw.worldId)} does not match the definition's world ${String(expectedWorldId)} (omit it to target this world)`);
  }
  if (kind === "submit-order") {
    if (!isNonBlankString(raw.accountId)) problems.push("submit-order requires 'accountId'");
    if (!isNonBlankString(raw.instrumentId)) problems.push("submit-order requires 'instrumentId'");
  }
  if (kind === "cancel-order" || kind === "replace-order") {
    if (!isNonBlankString(raw.orderId)) problems.push(`${kind} requires 'orderId'`);
  }
  if (kind === "replace-order") {
    for (const field of ["quantity", "limitPrice", "stopPrice"] as const) {
      if (raw[field] !== undefined && !isNonBlankString(raw[field])) {
        problems.push(`replace-order '${field}' must be decimal string text when present`);
      }
    }
    validateConstraintsShape(raw.constraints, entryId);
  }
  if (kind === "close-position") {
    if (!isNonBlankString(raw.accountId)) problems.push("close-position requires 'accountId'");
    if (!isNonBlankString(raw.instrumentId)) problems.push("close-position requires 'instrumentId'");
  }
  if (kind === "add-annotation") {
    if (!isFiniteNumber(raw.at)) problems.push("add-annotation requires a finite 'at' timestamp");
    if (!isNonBlankString(raw.text)) problems.push("add-annotation requires non-blank 'text'");
  }
  if (kind === "branch-world" && !isNonBlankString(raw.sourceSnapshotId)) {
    problems.push("branch-world requires 'sourceSnapshotId'");
  }
  if (kind === "set-scenario") {
    const scenario = raw.scenario;
    if (!isRecord(scenario) || !Array.isArray(scenario.entries)) {
      problems.push("set-scenario requires 'scenario' with an 'entries' array");
    }
  }
  if (problems.length > 0) {
    throw new ScriptInvalid(`entry '${entryId}': invalid ${kind} command`, problems);
  }
  return raw as unknown as WorldCommand;
}

/** Validate one raw script entry into the typed shape. */
export function validateScriptEntry(
  raw: unknown,
  index: number,
  expectedWorldId: WorldId,
  seenIds: Set<string>,
): ScriptEntry {
  const where = `script entry ${index}`;
  if (!isRecord(raw)) {
    throw new ScriptInvalid(`${where}: must be an object`);
  }
  const id = raw.id;
  if (!isNonBlankString(id)) {
    throw new ScriptInvalid(`${where}: 'id' must be a non-blank string (explicit ids are required)`);
  }
  if (seenIds.has(id)) {
    throw new ScriptInvalid(`${where}: duplicate entry id '${id}'`);
  }
  seenIds.add(id);
  const hasClock = raw.clock !== undefined;
  const hasCommand = raw.command !== undefined;
  if (hasClock === hasCommand) {
    throw new ScriptInvalid(
      `entry '${id}': exactly one of 'clock' or 'command' is required (got ${hasClock ? "both" : "neither"})`,
    );
  }
  if (hasClock) {
    return { id, clock: validateClockOperation(raw.clock, id) };
  }
  return { id, command: validateCommandInput(raw.command, id, expectedWorldId) };
}

/** Load and validate a script file against the definition's world id. */
export async function loadScriptFile(path: string, expectedWorldId: WorldId): Promise<LoadedScript> {
  const parsed = await readJsonFile(path, {
    notFound: "script-not-found",
    unreadable: "script-unreadable",
    invalidJson: "script-invalid-json",
  });
  if (!Array.isArray(parsed)) {
    throw new ScriptInvalid(`${path}: the script file must be a JSON array of entries`);
  }
  const seenIds = new Set<string>();
  const entries = parsed.map((raw, index) =>
    validateScriptEntry(raw, index, expectedWorldId, seenIds),
  );
  return { path, entries };
}
