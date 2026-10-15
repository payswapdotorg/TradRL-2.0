/**
 * The pure, deterministic projection coalescer (W030).
 *
 * THE LAW (spec/WORLD-PROTOCOL.md "UI projection law" + ARCHITECTURE-LOCK
 * A6): N journal events between two observation points coalesce into ONE
 * refresh per surface key, and the refreshed view IS the latest projection —
 * a fresh port read at the drain point — NEVER a blend of intermediate
 * states. The coalescer tracks DIRTINESS (which surfaces changed and how many
 * events piled up) and WINDOW BOUNDS (how stale a key may get before a drain
 * is forced); it never holds, merges or fabricates projection values.
 *
 * Determinism (A9): every input is (config, ordered event stream, clock
 * observations, drain points) and the outputs are pure functions of them —
 * canonical drain order (the surface table order, keys in first-touch
 * order), no wall time, no unordered iteration in output positions.
 *
 * The state machine:
 * - `ingestEvent` / `ingestPublication` — mark the touched (surface, key)
 *   pairs dirty, advance their window counters, and report which keys'
 *   windows JUST overflowed (a hint for the host to schedule a drain; never
 *   an implicit observation point — the coalescer stays pure).
 * - `ingestClock` — a settled clock observation. Clock motion changes
 *   asOf-stamped and availableAt-gated projections, so it dirties every
 *   existing (configured/observed) key of every configured surface.
 * - `drain` — the observation point: one entry per dirty (surface, key) in
 *   canonical order; clears the pending window. `drain({ force: true })`
 *   additionally dirties every known key (the final full read).
 */

import type { SequenceNumber, WorldEventEnvelope } from "tradrl-world-contracts";
import {
  COALESCED_SURFACES,
  isUnknownEventType,
  surfacesTouchedByEvent,
  type CoalescedSurfaceKey,
  type CoalescedSurfaceName,
  type SurfaceKeyKind,
} from "./surfaces.js";

/** Bounds how long one (surface, key) may stay un-refreshed. */
export interface CoalescingWindow {
  /**
   * Force a drain once this many journal events have touched one key since
   * its last refresh. Integer >= 1 (1 disables coalescing for the key — a
   * legal degenerate config).
   */
  readonly maxEvents?: number;
  /**
   * Force a drain once the `occurredAt` span of the events coalesced for one
   * key exceeds this many simulation ms. Finite number > 0.
   */
  readonly maxSimMs?: number;
}

/** Per-surface coalescing configuration. */
export interface SurfaceCoalescingConfig {
  /** At least one window bound is REQUIRED (loud validation). */
  readonly window: CoalescingWindow;
  /**
   * Restrict the surface to these keys (instrument or account ids, per the
   * surface's key kind; world-keyed surfaces ignore this). Events touching
   * other keys are not coalesced. Undefined: every key the stream produces.
   */
  readonly keys?: readonly string[];
}

/** The coalescer configuration: windows/keys per surface. */
export interface ProjectionCoalescerConfig {
  /**
   * The surfaces to coalesce. At least one is required; unknown names are
   * rejected loudly (typed, all issues at once).
   */
  readonly surfaces: Readonly<Partial<Record<CoalescedSurfaceName, SurfaceCoalescingConfig>>>;
}

/** One typed configuration issue (loud validation: every issue, not the first). */
export interface CoalescerConfigIssue {
  readonly surface: string;
  readonly kind:
    | "unknown-surface"
    | "empty-config"
    | "window-missing"
    | "window-unbounded"
    | "window-max-events"
    | "window-max-sim-ms"
    | "key-blank"
    | "key-duplicate";
  readonly message: string;
}

/** The loud, typed configuration error. */
export class ProjectionCoalescerConfigError extends Error {
  constructor(readonly issues: readonly CoalescerConfigIssue[]) {
    super(
      `projection coalescer config is invalid:\n${issues
        .map((issue) => `  - [${issue.surface}] ${issue.kind}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "ProjectionCoalescerConfigError";
  }
}

/** Why one (surface, key) is being refreshed at a drain. */
export type CoalescedDirtyReason = "initial" | "events" | "clock";

/** One coalesced refresh: the read plan for one (surface, key) at a drain. */
export interface CoalescedSurfaceEntry {
  readonly surface: CoalescedSurfaceName;
  readonly key: CoalescedSurfaceKey;
  readonly reason: CoalescedDirtyReason;
  /** Journal sequence of the first coalesced event (`undefined` for initial). */
  readonly fromSequence: SequenceNumber | undefined;
  /** Journal sequence of the last coalesced event (`undefined` for initial). */
  readonly toSequence: SequenceNumber | undefined;
  /** How many journal events were coalesced into this entry. */
  readonly eventCount: number;
}

/** The drain result: one entry per dirty (surface, key), canonical order. */
export interface CoalescedDrain {
  readonly entries: readonly CoalescedSurfaceEntry[];
  /** The last ingested journal sequence at the observation point. */
  readonly observedSequence: SequenceNumber | undefined;
  /** How many journal events were ingested since the previous drain. */
  readonly ingestedEvents: number;
}

/** A (surface, key) whose window just overflowed — the host should drain soon. */
export interface SurfaceOverflow {
  readonly surface: CoalescedSurfaceName;
  readonly key: CoalescedSurfaceKey;
}

interface KeyState {
  readonly insertion: number;
  dirty: boolean;
  clockTouched: boolean;
  overflowing: boolean;
  eventCount: number;
  fromSequence: SequenceNumber | undefined;
  toSequence: SequenceNumber | undefined;
  firstOccurredAt: number | undefined;
  lastOccurredAt: number | undefined;
}

interface SurfaceState {
  readonly keyKind: SurfaceKeyKind;
  readonly maxEvents: number | undefined;
  readonly maxSimMs: number | undefined;
  readonly keyFilter: ReadonlySet<string> | undefined;
  readonly keys: Map<CoalescedSurfaceKey, KeyState>;
}

export interface ProjectionCoalescer {
  /** Ingest one journal event; returns the keys whose windows just overflowed. */
  ingestEvent(event: WorldEventEnvelope): readonly SurfaceOverflow[];
  /** Ingest a published batch (convenience over {@link ingestEvent}). */
  ingestPublication(events: readonly WorldEventEnvelope[]): readonly SurfaceOverflow[];
  /** Ingest a settled clock observation: dirties every existing key. */
  ingestClock(): void;
  /** The observation point: one entry per dirty (surface, key). */
  drain(options?: { readonly force?: boolean }): CoalescedDrain;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Validate a coalescer config; throws with EVERY issue (loud). */
function assertValidConfig(
  config: ProjectionCoalescerConfig,
): Map<CoalescedSurfaceName, SurfaceState> {
  const issues: CoalescerConfigIssue[] = [];
  const provided = isRecord(config?.surfaces) ? Object.entries(config.surfaces) : [];
  if (provided.length === 0) {
    issues.push({
      surface: "(config)",
      kind: "empty-config",
      message: "at least one surface must be configured — a coalescer over nothing is a config bug",
    });
  }
  const known = new Map(COALESCED_SURFACES.map((spec) => [spec.name, spec]));
  for (const [surfaceName, surfaceConfig] of provided) {
    if (!known.has(surfaceName as CoalescedSurfaceName)) {
      issues.push({
        surface: surfaceName,
        kind: "unknown-surface",
        message: `unknown surface '${surfaceName}' (known: ${COALESCED_SURFACES.map((s) => s.name).join(", ")})`,
      });
      continue;
    }
    if (surfaceConfig === undefined) {
      issues.push({
        surface: surfaceName,
        kind: "window-missing",
        message: "surface config is undefined",
      });
      continue;
    }
    const window = surfaceConfig.window;
    if (!isRecord(window)) {
      issues.push({
        surface: surfaceName,
        kind: "window-missing",
        message: "window is required (an unbounded window would coalesce indefinitely)",
      });
      continue;
    }
    if (window.maxEvents === undefined && window.maxSimMs === undefined) {
      issues.push({
        surface: surfaceName,
        kind: "window-unbounded",
        message: "at least one of window.maxEvents / window.maxSimMs is required",
      });
    }
    if (
      window.maxEvents !== undefined &&
      (!Number.isInteger(window.maxEvents) || (window.maxEvents as number) < 1)
    ) {
      issues.push({
        surface: surfaceName,
        kind: "window-max-events",
        message: `maxEvents must be an integer >= 1, got ${String(window.maxEvents)}`,
      });
    }
    if (
      window.maxSimMs !== undefined &&
      (typeof window.maxSimMs !== "number" ||
        !Number.isFinite(window.maxSimMs) ||
        (window.maxSimMs as number) <= 0)
    ) {
      issues.push({
        surface: surfaceName,
        kind: "window-max-sim-ms",
        message: `maxSimMs must be a finite number > 0, got ${String(window.maxSimMs)}`,
      });
    }
    if (surfaceConfig.keys !== undefined) {
      const seen = new Set<string>();
      for (const key of surfaceConfig.keys) {
        if (typeof key !== "string" || key.length === 0) {
          issues.push({
            surface: surfaceName,
            kind: "key-blank",
            message: "keys must be non-empty strings",
          });
          continue;
        }
        if (seen.has(key)) {
          issues.push({
            surface: surfaceName,
            kind: "key-duplicate",
            message: `duplicate key '${key}'`,
          });
          continue;
        }
        seen.add(key);
      }
    }
  }
  if (issues.length > 0) {
    throw new ProjectionCoalescerConfigError(issues);
  }

  const states = new Map<CoalescedSurfaceName, SurfaceState>();
  let insertion = 0;
  for (const [surfaceName, surfaceConfig] of provided) {
    const spec = known.get(surfaceName as CoalescedSurfaceName)!;
    const keys = surfaceConfig?.keys;
    const state: SurfaceState = {
      keyKind: spec.keyKind,
      maxEvents: surfaceConfig?.window.maxEvents,
      maxSimMs: surfaceConfig?.window.maxSimMs,
      keyFilter: keys === undefined ? undefined : new Set(keys),
      keys: new Map(),
    };
    // Declared keys start dirty ("initial") — the first drain is the initial
    // refresh of every registered key (the W009 feed's first fetch).
    // World-keyed surfaces always carry their single (undefined) key.
    if (spec.keyKind === "world") {
      state.keys.set(undefined, initialKeyState(insertion++));
    } else if (state.keyFilter !== undefined) {
      for (const key of state.keyFilter) {
        state.keys.set(key, initialKeyState(insertion++));
      }
    }
    states.set(surfaceName as CoalescedSurfaceName, state);
  }
  return states;
}

function initialKeyState(insertion: number): KeyState {
  return {
    insertion,
    dirty: true,
    clockTouched: false,
    overflowing: false,
    eventCount: 0,
    fromSequence: undefined,
    toSequence: undefined,
    firstOccurredAt: undefined,
    lastOccurredAt: undefined,
  };
}

/** Create the pure projection coalescer. Throws loudly on invalid config. */
export function createProjectionCoalescer(
  config: ProjectionCoalescerConfig,
): ProjectionCoalescer {
  const surfaces = assertValidConfig(config);
  const seenInstrumentKeys: string[] = [];
  let lastSequence: SequenceNumber | undefined;
  let eventsSinceDrain = 0;

  function entryOf(state: SurfaceState, key: CoalescedSurfaceKey): KeyState | undefined {
    // World-keyed surfaces fold every key onto their single undefined key.
    const normalized = state.keyKind === "world" ? undefined : key;
    if (state.keyFilter !== undefined && normalized !== undefined && !state.keyFilter.has(normalized)) {
      return undefined; // outside the configured key set
    }
    let entry = state.keys.get(normalized);
    if (entry === undefined) {
      entry = {
        insertion: state.keys.size,
        dirty: false,
        clockTouched: false,
        overflowing: false,
        eventCount: 0,
        fromSequence: undefined,
        toSequence: undefined,
        firstOccurredAt: undefined,
        lastOccurredAt: undefined,
      };
      state.keys.set(normalized, entry);
    }
    return entry;
  }

  function applyEvent(
    surface: CoalescedSurfaceName,
    state: SurfaceState,
    key: CoalescedSurfaceKey,
    event: WorldEventEnvelope,
  ): readonly SurfaceOverflow[] {
    const entry = entryOf(state, key);
    if (entry === undefined) {
      return [];
    }
    const overflow: SurfaceOverflow[] = [];
    entry.dirty = true;
    entry.eventCount += 1;
    entry.toSequence = event.sequence;
    if (entry.fromSequence === undefined) {
      entry.fromSequence = event.sequence;
    }
    const occurredAt = event.occurredAt;
    if (entry.firstOccurredAt === undefined || occurredAt < entry.firstOccurredAt) {
      entry.firstOccurredAt = occurredAt;
    }
    if (entry.lastOccurredAt === undefined || occurredAt > entry.lastOccurredAt) {
      entry.lastOccurredAt = occurredAt;
    }
    if (!entry.overflowing && windowOverflows(state, entry)) {
      entry.overflowing = true;
      overflow.push({ surface, key: state.keyKind === "world" ? undefined : key });
    }
    return overflow;
  }

  function windowOverflows(state: SurfaceState, entry: KeyState): boolean {
    if (state.maxEvents !== undefined && entry.eventCount >= state.maxEvents) {
      return true;
    }
    if (
      state.maxSimMs !== undefined &&
      entry.firstOccurredAt !== undefined &&
      entry.lastOccurredAt !== undefined &&
      entry.lastOccurredAt - entry.firstOccurredAt > state.maxSimMs
    ) {
      return true;
    }
    return false;
  }

  function ingestEvent(event: WorldEventEnvelope): readonly SurfaceOverflow[] {
    lastSequence = event.sequence;
    eventsSinceDrain += 1;
    const payload = isRecord(event.payload) ? event.payload : {};
    const instrumentId = typeof payload.instrumentId === "string" ? payload.instrumentId : undefined;
    if (instrumentId !== undefined && !seenInstrumentKeys.includes(instrumentId)) {
      seenInstrumentKeys.push(instrumentId);
    }
    if (isUnknownEventType(event.eventType)) {
      // FAIL-SAFE: an unknown producer could change any surface's content —
      // dirty every existing key of every configured surface.
      const overflow: SurfaceOverflow[] = [];
      for (const [name, state] of surfaces) {
        for (const key of state.keys.keys()) {
          overflow.push(...applyEvent(name, state, key, event));
        }
      }
      return overflow;
    }
    const overflow: SurfaceOverflow[] = [];
    for (const touch of surfacesTouchedByEvent(event, seenInstrumentKeys)) {
      const state = surfaces.get(touch.surface);
      if (state === undefined) {
        continue;
      }
      overflow.push(...applyEvent(touch.surface, state, touch.key, event));
    }
    return overflow;
  }

  return {
    ingestEvent,
    ingestPublication(events) {
      const overflow: SurfaceOverflow[] = [];
      for (const event of events) {
        overflow.push(...ingestEvent(event));
      }
      return overflow;
    },
    ingestClock() {
      for (const state of surfaces.values()) {
        for (const entry of state.keys.values()) {
          entry.dirty = true;
          entry.clockTouched = true;
        }
      }
    },
    drain(options) {
      if (options?.force === true) {
        for (const state of surfaces.values()) {
          for (const entry of state.keys.values()) {
            entry.dirty = true;
          }
        }
      }
      const entries: CoalescedSurfaceEntry[] = [];
      for (const spec of COALESCED_SURFACES) {
        const state = surfaces.get(spec.name);
        if (state === undefined) {
          continue;
        }
        // Map iteration order is insertion order; the insertion counter is
        // the canonical first-touch order (part of the determinism contract).
        for (const [key, entry] of state.keys) {
          if (!entry.dirty) {
            continue;
          }
          entries.push({
            surface: spec.name,
            key,
            reason: entry.clockTouched ? "clock" : entry.eventCount > 0 ? "events" : "initial",
            fromSequence: entry.fromSequence,
            toSequence: entry.toSequence,
            eventCount: entry.eventCount,
          });
          entry.dirty = false;
          entry.clockTouched = false;
          entry.overflowing = false;
          entry.eventCount = 0;
          entry.fromSequence = undefined;
          entry.toSequence = undefined;
          entry.firstOccurredAt = undefined;
          entry.lastOccurredAt = undefined;
        }
      }
      const ingested = eventsSinceDrain;
      eventsSinceDrain = 0;
      return { entries, observedSequence: lastSequence, ingestedEvents: ingested };
    },
  };
}
