/**
 * W030 `performance` — the streaming projection coalescer.
 *
 * Public surface (see the individual modules for the laws):
 * - {@link "./surfaces.js"} — the coalescable surface table + the event→surface
 *   dirty mapping (the closed alpha taxonomy, fail-safe for unknown types).
 * - {@link "./coalescer.js"} — the pure, deterministic coalescer: typed config
 *   (windows/keys per surface) with loud validation, ingest/drain, window
 *   overflow hints, canonical drain order.
 * - {@link "./reads.js"} — the drain read binder: ONE fresh port read per
 *   drain entry (the A6 projection law — the latest projection, never a blend).
 */

export {
  COALESCED_SURFACE_NAMES,
  COALESCED_SURFACES,
  coalescedSurfaceSpec,
  isUnknownEventType,
  surfacesTouchedByEvent,
  type CoalescedSurfaceKey,
  type CoalescedSurfaceName,
  type CoalescedSurfaceSpec,
  type SurfaceKeyKind,
  type SurfaceKeyTouch,
} from "./surfaces.js";
export {
  createProjectionCoalescer,
  ProjectionCoalescerConfigError,
  type CoalescedDirtyReason,
  type CoalescedDrain,
  type CoalescedSurfaceEntry,
  type CoalescingWindow,
  type CoalescerConfigIssue,
  type ProjectionCoalescer,
  type ProjectionCoalescerConfig,
  type SurfaceCoalescingConfig,
  type SurfaceOverflow,
} from "./coalescer.js";
export {
  coalescedValueOf,
  readCoalescedDrain,
  CoalescedReadError,
  type CoalescedProjection,
  type CoalescedReadParams,
  type CoalescedSurfaceValue,
} from "./reads.js";
