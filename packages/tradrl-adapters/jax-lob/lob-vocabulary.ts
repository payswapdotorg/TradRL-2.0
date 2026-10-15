/**
 * The clean-room LOB training vocabulary (W049).
 *
 * CLEAN-ROOM LAW (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md, the binding
 * JAX-LOB ruling — quoted verbatim in this package's README): nothing
 * here is derived from the unlicensed upstream JAX-LOB codebases — only
 * the PUBLICLY DOCUMENTED CONCEPTS of a limit-order-book training
 * environment family, re-expressed as original TypeScript, as DECLARED
 * CLOSED SETS with fail-closed validation (the W024 abides / W057 arena
 * adapter precedents).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — every id is a canonical content
 * digest over the record's own data (no clocks, no randomness, no env
 * reads). A14: vocabulary + gates only — never simulates a book, never
 * matches an order, never steps an environment.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";

// ---------------------------------------------------------------------------
// The sides + the levels (aggregated price data — best level first)
// ---------------------------------------------------------------------------

/** The closed side vocabulary of a limit order book. Closed: any other side is the loud refusal `unknown-side`. */
export type LobSide = "bid" | "ask";

/** The closed side set. */
export const LOB_SIDES: readonly LobSide[] = ["bid", "ask"];

/**
 * ONE aggregated price level — DATA: the level's price, the aggregated
 * remaining size at that price, and the count of resting orders it
 * aggregates. Best level first (level 0 is the side's best price).
 */
export interface LobLevelDescriptor {
  readonly price: number;
  readonly size: number;
  readonly orderCount: number;
}

/** The level members, in canonical order (validation + rendering). */
export const LOB_LEVEL_MEMBERS: readonly (keyof LobLevelDescriptor)[] = ["price", "size", "orderCount"];

/**
 * ONE order-book state — DATA: the bid levels (best bid first, strictly
 * decreasing) and the ask levels (best ask first, strictly increasing).
 * The sides must not cross or lock (best bid strictly below best ask) —
 * a crossed or locked book is malformed, never silently carried.
 */
export interface LobBookStateDescriptor {
  readonly bidLevels: readonly LobLevelDescriptor[];
  readonly askLevels: readonly LobLevelDescriptor[];
}

declare const lobBookStateIdBrand: unique symbol;

/** An OPAQUE book-state id (a canonical digest rendering, produced only by {@link lobBookStateIdOf}; never parsed). */
export type LobBookStateId = string & { readonly [lobBookStateIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const LOB_BOOK_STATE_ID_PREFIX = "lobbook-";

/** The sealed book state: the descriptor plus its content-addressed id. */
export interface LobBookState {
  readonly bookStateId: LobBookStateId;
  readonly bidLevels: readonly LobLevelDescriptor[];
  readonly askLevels: readonly LobLevelDescriptor[];
}

// ---------------------------------------------------------------------------
// The order kinds + the execution event kinds (closed sets)
// ---------------------------------------------------------------------------

/**
 * The closed order-kind vocabulary of a limit-order-book venue — the
 * publicly documented order-intent concepts: a priced resting order
 * (`limit`), an immediate fill at any price (`market`), a removal
 * (`cancel`), and a re-priced/re-sized resting order (`amend`). Closed:
 * any other kind is the loud refusal `unknown-order-kind`.
 */
export type LobOrderKind = "limit" | "market" | "cancel" | "amend";

/** The closed order-kind set. */
export const LOB_ORDER_KINDS: readonly LobOrderKind[] = ["limit", "market", "cancel", "amend"];

/**
 * The closed execution-event vocabulary — the publicly documented
 * lifecycle concepts of one order in a book venue: entry (`submission`),
 * removal (`cancellation`), fill (`execution`), and change
 * (`amendment`). Closed: any other kind is the loud refusal
 * `unknown-execution-event-kind`.
 */
export type LobExecutionEventKind = "submission" | "cancellation" | "execution" | "amendment";

/** The closed execution-event set. */
export const LOB_EXECUTION_EVENT_KINDS: readonly LobExecutionEventKind[] = [
  "submission",
  "cancellation",
  "execution",
  "amendment",
];

/**
 * ONE execution event — DATA: its kind, the side it touched, the order
 * kind it carried, and its size. The adapter never executes events
 * (A14); this is the venue's declared event vocabulary, validated as
 * data.
 */
export interface LobExecutionEventDescriptor {
  readonly eventKind: LobExecutionEventKind;
  readonly side: LobSide;
  readonly orderKind: LobOrderKind;
  readonly size: number;
}

// ---------------------------------------------------------------------------
// The episode-step shape (book-style environments — a closed protocol)
// ---------------------------------------------------------------------------

/**
 * The closed step-kind vocabulary of ONE book-style training step — the
 * publicly documented observe/act/report/reward concepts, in canonical
 * protocol order (the terminal marker only on an episode's last step).
 */
export type LobStepKind = "book-observation" | "order-action" | "execution-report" | "reward-signal" | "terminal-marker";

/** The closed step-kind set, in canonical protocol order. */
export const LOB_STEP_KINDS: readonly LobStepKind[] = [
  "book-observation",
  "order-action",
  "execution-report",
  "reward-signal",
  "terminal-marker",
];

/**
 * The declared shape of one episode step in a book-style environment —
 * DATA: the ordered closed subset of step kinds every step carries.
 * Laws: non-empty; closed-set kinds; one kind once; canonical protocol
 * order; begins with the book observation and carries both the order
 * action and the reward signal (a learning step observes, acts, and is
 * scored); the terminal marker, when declared, is LAST.
 */
export interface LobEpisodeStepShape {
  readonly stepKinds: readonly LobStepKind[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type LobVocabularyErrorCode =
  | "unknown-side" // outside the closed LOB_SIDES set
  | "unknown-order-kind" // outside the closed LOB_ORDER_KINDS set
  | "unknown-execution-event-kind" // outside the closed LOB_EXECUTION_EVENT_KINDS set
  | "unknown-step-kind" // outside the closed LOB_STEP_KINDS set
  | "duplicate-step-kind" // one step kind joins one shape once
  | "empty-book-side" // a book side with no levels is never silently carried
  | "malformed-level" // non-finite/non-positive price or size, or a non-positive order count
  | "non-canonical-level-order" // the levels are not best-first strictly ordered
  | "crossed-book" // the best bid is not strictly below the best ask
  | "malformed-execution-event" // a non-positive event size
  | "empty-step-shape" // a shape over no step kinds
  | "step-order" // the kinds are not in canonical protocol order
  | "missing-step-kind" // the shape does not begin with the observation or lacks action/reward
  | "misplaced-terminal"; // the terminal marker is not last

/** One typed vocabulary error (fail-closed). */
export interface LobVocabularyError {
  readonly code: LobVocabularyErrorCode;
  readonly message: string;
}

export type LobBookStateOutcome =
  | { readonly ok: true; readonly book: LobBookState }
  | { readonly ok: false; readonly errors: readonly LobVocabularyError[] };

export type LobExecutionEventOutcome =
  | { readonly ok: true; readonly event: LobExecutionEventDescriptor }
  | { readonly ok: false; readonly errors: readonly LobVocabularyError[] };

export type LobEpisodeStepShapeOutcome =
  | { readonly ok: true; readonly shape: LobEpisodeStepShape }
  | { readonly ok: false; readonly errors: readonly LobVocabularyError[] };

// ---------------------------------------------------------------------------
// The gates (pure, deterministic, fail-closed — every law collected)
// ---------------------------------------------------------------------------

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The book-state id: the canonical content digest over the recorded levels (A9). */
export function lobBookStateIdOf(state: LobBookStateDescriptor): LobBookStateId {
  return `${LOB_BOOK_STATE_ID_PREFIX}${canonicalDigestHex({
    kind: "lob-book-state",
    bidLevels: state.bidLevels,
    askLevels: state.askLevels,
  })}` as LobBookStateId;
}

/**
 * Construct one book state — THE BOOK-STATE GATE. Laws: both sides
 * non-empty; every level a finite positive price/size with a positive
 * integer order count; bid levels strictly decreasing, ask levels
 * strictly increasing (best first); the best bid strictly below the
 * best ask (no crossed or locked book). The sealed state is frozen.
 */
export function lobBookStateOf(state: LobBookStateDescriptor): LobBookStateOutcome {
  const errors: LobVocabularyError[] = [];

  for (const side of LOB_SIDES) {
    const levels = side === "bid" ? state.bidLevels : state.askLevels;
    if (levels.length === 0) {
      errors.push({
        code: "empty-book-side",
        message: `the '${side}' side of the book state carries no levels — an order-book state is two non-empty sides of aggregated levels (fail-closed, never an empty side)`,
      });
    }
    levels.forEach((level, index) => {
      if (!finitePositive(level.price) || !finitePositive(level.size)) {
        errors.push({
          code: "malformed-level",
          message: `the '${side}' level at index ${String(index)} carries a non-finite or non-positive price/size — levels are aggregated price data, explicitly positive`,
        });
      }
      if (!Number.isInteger(level.orderCount) || level.orderCount < 1) {
        errors.push({
          code: "malformed-level",
          message: `the '${side}' level at index ${String(index)} aggregates '${String(level.orderCount)}' order(s) — a level aggregates at least one resting order`,
        });
      }
    });
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1]!;
      const current = levels[index]!;
      const canonical = side === "bid" ? current.price < previous.price : current.price > previous.price;
      if (!canonical) {
        errors.push({
          code: "non-canonical-level-order",
          message: `the '${side}' levels are not best-first strictly ordered (level ${String(index)} does not ${side === "bid" ? "fall below" : "rise above"} level ${String(index - 1)}) — book state is canonical data (A9)`,
        });
      }
    }
  }

  if (state.bidLevels.length > 0 && state.askLevels.length > 0) {
    const bestBid = state.bidLevels[0]!.price;
    const bestAsk = state.askLevels[0]!.price;
    if (bestBid >= bestAsk) {
      errors.push({
        code: "crossed-book",
        message: `the best bid ${String(bestBid)} is not strictly below the best ask ${String(bestAsk)} — a crossed or locked book is malformed, never silently carried`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const book: LobBookState = {
    bookStateId: lobBookStateIdOf(state),
    bidLevels: state.bidLevels.map((level) => ({ ...level })),
    askLevels: state.askLevels.map((level) => ({ ...level })),
  };
  Object.freeze(book);
  return { ok: true, book };
}

/**
 * Construct one execution event — THE EVENT GATE. Laws: the event kind
 * and the order kind are from the closed sets, the side is from the
 * closed side set, and the size is finite and positive. The sealed event
 * is frozen.
 */
export function lobExecutionEventOf(event: LobExecutionEventDescriptor): LobExecutionEventOutcome {
  const errors: LobVocabularyError[] = [];
  if (!LOB_EXECUTION_EVENT_KINDS.includes(event.eventKind)) {
    errors.push({
      code: "unknown-execution-event-kind",
      message: `the execution event kind '${String(event.eventKind)}' is outside the closed vocabulary (${LOB_EXECUTION_EVENT_KINDS.join(", ")}) — a venue's event kinds are declared data (A14)`,
    });
  }
  if (!LOB_SIDES.includes(event.side)) {
    errors.push({
      code: "unknown-side",
      message: `the side '${String(event.side)}' is outside the closed vocabulary (${LOB_SIDES.join(", ")}) — a book has exactly two declared sides`,
    });
  }
  if (!LOB_ORDER_KINDS.includes(event.orderKind)) {
    errors.push({
      code: "unknown-order-kind",
      message: `the order kind '${String(event.orderKind)}' is outside the closed vocabulary (${LOB_ORDER_KINDS.join(", ")}) — a venue's order kinds are declared data (A14)`,
    });
  }
  if (!finitePositive(event.size)) {
    errors.push({
      code: "malformed-execution-event",
      message: `the execution event size '${String(event.size)}' is not a finite positive quantity — sizes are explicit positive data (A9)`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const sealed: LobExecutionEventDescriptor = { ...event };
  Object.freeze(sealed);
  return { ok: true, event: sealed };
}

/**
 * The lawful shape test: non-empty, closed-set kinds, one kind once, and
 * the kinds in CANONICAL PROTOCOL ORDER (the LOB_STEP_KINDS order). Shared
 * by the shape gate and the whole-record re-validation.
 */
export function stepShapeViolations(shape: LobEpisodeStepShape): LobVocabularyError[] {
  const errors: LobVocabularyError[] = [];
  const kinds = Array.isArray(shape.stepKinds) ? shape.stepKinds : [];
  if (kinds.length === 0) {
    errors.push({
      code: "empty-step-shape",
      message: "the episode-step shape declares no step kinds — a book-style step carries at least the observation and the action (fail-closed)",
    });
    return errors;
  }
  const seen = new Set<string>();
  for (const kind of kinds) {
    if (!LOB_STEP_KINDS.includes(kind)) {
      errors.push({
        code: "unknown-step-kind",
        message: `the step kind '${String(kind)}' is outside the closed vocabulary (${LOB_STEP_KINDS.join(", ")}) — the step protocol is declared data (A14)`,
      });
      continue;
    }
    if (seen.has(kind)) {
      errors.push({
        code: "duplicate-step-kind",
        message: `the step kind '${String(kind)}' joins the shape twice — one kind, one declaration, deterministic data (A9)`,
      });
    }
    seen.add(kind);
  }
  const positions = kinds
    .filter((kind): kind is LobStepKind => LOB_STEP_KINDS.includes(kind))
    .map((kind) => LOB_STEP_KINDS.indexOf(kind));
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index]! <= positions[index - 1]!) {
      errors.push({
        code: "step-order",
        message: `the step kinds are not in canonical protocol order (${LOB_STEP_KINDS.join(" → ")}) — the observe/act/report/reward protocol order is venue data (A9)`,
      });
      break;
    }
  }
  if (seen.size > 0 && !seen.has("book-observation")) {
    errors.push({
      code: "missing-step-kind",
      message: "the shape does not begin with the book observation — one book-style step observes the book before acting on it",
    });
  }
  if (seen.size > 0 && !seen.has("order-action")) {
    errors.push({
      code: "missing-step-kind",
      message: "the shape declares no order action — a book-style training step acts on the observed book (an observation-only step is never silently shaped)",
    });
  }
  if (seen.size > 0 && !seen.has("reward-signal")) {
    errors.push({
      code: "missing-step-kind",
      message: "the shape declares no reward signal — 'Raw P&L is never the sole objective' (§13) rides through the carried reward signal; a step without one is never shaped",
    });
  }
  if (seen.has("terminal-marker") && kinds[kinds.length - 1] !== "terminal-marker") {
    errors.push({
      code: "misplaced-terminal",
      message: "the terminal marker is not the shape's last step kind — a terminal marker mid-step is meaningless data (fail-closed)",
    });
  }
  return errors;
}

/**
 * Construct one episode-step shape — THE SHAPE GATE. Laws (all errors at
 * once): non-empty, closed-set kinds, one kind once, canonical protocol
 * order, the shape begins with the book observation and carries both the
 * order action and the reward signal, and the terminal marker is last.
 * The sealed shape is frozen.
 */
export function lobEpisodeStepShapeOf(shape: LobEpisodeStepShape): LobEpisodeStepShapeOutcome {
  const errors = stepShapeViolations(shape);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const sealed: LobEpisodeStepShape = { stepKinds: [...shape.stepKinds] };
  Object.freeze(sealed);
  return { ok: true, shape: sealed };
}
