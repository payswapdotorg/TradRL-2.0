/**
 * Simulation-clock surface state shapes + honest status bodies — W012.
 *
 * The non-strip bodies the clock strip renders INSTEAD of the live clock
 * when the world data is not available (the W007/W008 states-file pattern).
 * Every body is an honest disclosure (ACCEPTANCE-WORLD-ALPHA K,
 * ARCHITECTURE-LOCK A6) — no state ever shows a clock reading it does not
 * have, and the persistent SIMULATED disclosure is belt-and-braces: it is
 * rendered by the strip header in EVERY state AND repeated here so a
 * cropped/erroring strip can never lose it.
 */

import { Button } from "@/components/ui/button.js";

import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import type { ClockTimelineProjectionSnapshot } from "./clockTimelineProjection.js";

/**
 * The body rendered instead of the live clock strip for every non-ready
 * state (`ready` renders the strip itself in SimulationClockToolSurface).
 */
export function SimulationClockSurfaceStatusBody({
  snapshot,
  onRetry,
}: {
  readonly snapshot: ClockTimelineProjectionSnapshot;
  readonly onRetry: () => void;
}) {
  if (snapshot.status === "unattached") {
    return (
      <SimulationClockNotice
        stateId="unattached"
        title="No world runtime attached"
        body="The simulation clock is world-owned: its time, status and speed come from the engine's own clock through the World Protocol ports. Until a world engine attaches through the W018 transport, no clock is shown — never a local timer."
      />
    );
  }
  if (snapshot.status === "loading") {
    return (
      <SimulationClockNotice stateId="loading" title="Loading the world's clock…" body="" />
    );
  }
  if (snapshot.status === "ready") {
    // The surface renders the strip itself for ready snapshots; this body is
    // only mounted for the non-ready states.
    return null;
  }
  return (
    <div
      data-trading-world-clock-state="error"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-3 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">Simulation clock unavailable</p>
      <p className="max-w-[28rem] break-words font-mono text-ui-xs text-foreground-subtle">
        {snapshot.message}
      </p>
      <p className="max-w-[28rem] text-ui-xs text-foreground-subtlest">
        The strip never substitutes a local time or a cached reading — a failed clock read stays
        an honest failure (fail-closed, never a fake ticking clock).
      </p>
      <span
        data-trading-world-simulation-disclosure=""
        title="Simulation disclosure — this world has no live execution authority (World Alpha)"
        className="rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
      >
        {TRADING_WORLD_SIMULATED_DISCLOSURE}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function SimulationClockNotice({
  stateId,
  title,
  body,
}: {
  readonly stateId: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      data-trading-world-clock-state={stateId}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-1.5 overflow-y-auto px-4 py-3 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      {body.length > 0 ? (
        <p className="max-w-[32rem] text-ui-xs text-foreground-subtle">{body}</p>
      ) : null}
      {stateId === "unattached" ? (
        <span
          data-trading-world-simulation-disclosure=""
          title="Simulation disclosure — this world has no live execution authority (World Alpha)"
          className="rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
        >
          {TRADING_WORLD_SIMULATED_DISCLOSURE}
        </span>
      ) : null}
    </div>
  );
}
