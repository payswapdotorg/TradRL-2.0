/**
 * The announced-regime timeline list of the simulation-clock strip — W012.
 *
 * Renders ONLY the ANNOUNCED regimes of the world's journal —
 * `market.regime.changed` events read through `query.getTimeline`
 * (A7-firewalled server-side), each with its simulation time, the
 * transition (from → to, or the ORIGIN RULE's "from the world origin"),
 * the journal sequence and a jump action. Never fabricated: an unannounced
 * schedule entry is the watchlist's "scheduled" context, not this list —
 * the timeline is the journal's regime truth only (the W017 ORIGIN RULE).
 *
 * Jump issues a REAL `clock.jumpToEvent(sequence)`; because journaled
 * events are always at-or-before the clock position, a jump is a backward
 * move and the engine answers with the typed `rewind-requires-branch`
 * rejection (A8) — rendered as the honest typed outcome, never hidden.
 */

import { Button } from "@/components/ui/button.js";

import { formatSimulationTimestampMs } from "../market/marketData.js";
import type { TimelineRegimeEntry } from "./clockTimelineData.js";

/** The timeline list (announced regimes, journal order). */
export function ClockTimelineList({
  entries,
  timelineError,
  pending,
  onJump,
}: {
  readonly entries: readonly TimelineRegimeEntry[];
  readonly timelineError: string | undefined;
  readonly pending: boolean;
  readonly onJump: (sequence: number) => void;
}) {
  if (timelineError !== undefined) {
    return (
      <p
        data-trading-world-clock-timeline-error=""
        title={`The timeline read rejected: ${timelineError}`}
        className="shrink-0 px-2 font-mono text-ui-xs text-foreground-subtle"
      >
        timeline: {timelineError}
      </p>
    );
  }
  if (entries.length === 0) {
    return (
      <p
        data-trading-world-clock-timeline-empty=""
        className="shrink-0 px-2 text-ui-xs text-foreground-subtlest"
        title="The W017 ORIGIN RULE: the regime in force at the world origin is announced on the FIRST clock advance — step the clock and the journal's regime truth appears here."
      >
        No regime announced yet — the journal announces on the first clock advance (the origin
        rule). Nothing is shown without journal truth.
      </p>
    );
  }
  return (
    <div
      data-trading-world-clock-timeline=""
      data-trading-world-clock-timeline-entries={entries.length}
      className="flex min-h-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1"
    >
      {entries.map((entry, index) => (
        <ClockTimelineEntryChip
          key={`${entry.sequence}-${entry.eventId}`}
          entry={entry}
          latest={index === entries.length - 1}
          pending={pending}
          onJump={onJump}
        />
      ))}
    </div>
  );
}

function ClockTimelineEntryChip({
  entry,
  latest,
  pending,
  onJump,
}: {
  readonly entry: TimelineRegimeEntry;
  readonly latest: boolean;
  readonly pending: boolean;
  readonly onJump: (sequence: number) => void;
}) {
  const announcement = entry.announcement;
  const transition =
    announcement.from === undefined
      ? `origin → ${announcement.to}`
      : `${announcement.from} → ${announcement.to}`;
  const parameters =
    announcement.parameters === undefined
      ? ""
      : ` · ${Object.entries(announcement.parameters)
          .map(([key, value]) => `${key} ${String(value)}`)
          .join(" · ")}`;
  return (
    <span
      data-trading-world-clock-regime-entry={entry.sequence}
      data-trading-world-clock-regime-latest={latest ? "true" : "false"}
      title={
        `Announced ${formatSimulationTimestampMs(announcement.at)} (market.regime.changed, ` +
        `journal seq ${entry.sequence})${parameters}${
          announcement.instrumentId === undefined
            ? " · world-scoped"
            : ` · instrument ${announcement.instrumentId}`
        } — jumping to a journaled event is a backward move: the engine answers the typed ` +
        `rewind-requires-branch rejection (A8); branching is a command for a later work order.`
      }
      className="flex shrink-0 items-center gap-1 rounded-sm border border-border/50 bg-surface px-1.5 py-0.5 font-mono text-ui-xs text-foreground-subtle"
    >
      <span className="text-foreground-subtlest">
        {formatSimulationTimestampMs(announcement.at).slice(11, 19)}
      </span>
      <span>{transition}</span>
      {latest ? (
        <span data-trading-world-clock-regime-in-force="" className="text-foreground">
          · latest
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        data-trading-world-clock-regime-jump={entry.sequence}
        onClick={() => onJump(entry.sequence)}
        className="h-4 px-1 text-ui-xs"
        title={`clock.jumpToEvent(${String(entry.sequence)}) — a REAL port call; the engine's typed outcome is rendered`}
      >
        jump
      </Button>
    </span>
  );
}
