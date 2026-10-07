/**
 * Simulation-clock tool surface — W012 (the cockpit's clock strip + the
 * timeline surface of the Trading World cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (the full-width clock
 * strip: `◀ time ──●── time ▶` with `pause step play 0.1x 1x 10x 100x`)
 * and "Clock" (the clock is world-owned; UI controls send ClockPort
 * commands); spec/ARCHITECTURE-LOCK.md A7 (the wall and simulation axes
 * are distinct — the sim axis is the engine's ClockView, the wall axis is
 * recorded engine-side and rendered as the honest not-projected note),
 * A8 (branching, not destructive rewind — a backward seek surfaces the
 * engine's typed `rewind-requires-branch` rejection visibly; branch
 * creation is a command for later work orders) and A6 (a projection of
 * world truth through the world-client seam — never authoritative).
 *
 * Data flow: the W006 world-client seam (`useTradingWorldClient`) provides
 * the four-port protocol; the framework-free controller
 * (`./clockTimelineProjection.ts`) reads `clock.getClock` (the sim axis)
 * and `query.getTimeline` (announced `market.regime.changed` regimes) and
 * keeps them LIVE through the W018 push channels (`onClock` — the settled
 * view after acked mutating clock calls — + `onPublished`) with a polling
 * fallback. EVERY control issues a REAL ClockPort command; the engine's
 * typed outcome (ack or the W004 closed rejection set) is the visible
 * capsule — visible, typed, never silently swallowed. Every state is
 * honest: unattached → teaching state; ready → the live strip; error →
 * fail-closed (never a fake ticking clock).
 *
 * Mounted through the W006 tool registry: this component replaces the
 * simulation-clock placeholder via `withSurfaceOverride` — see
 * `./index.ts`.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ComponentType } from "react";
import { PauseIcon, PlayIcon, StepForwardIcon } from "lucide-react";

import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import { seamClientHasPushChannels } from "../market/watchlistProjection.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { ClockTimelineList } from "./ClockTimelineList.js";
import {
  CLOCK_SPEED_PRESET_OPTIONS,
  CLOCK_STEP_SIZE_OPTIONS,
  describeSimulationClockView,
  describeWallAxis,
  parseSeekTargetText,
} from "./clockTimelineData.js";
import {
  createClockTimelineProjectionController,
  type ClockTimelineProjectionSnapshot,
} from "./clockTimelineProjection.js";
import { SimulationClockSurfaceStatusBody } from "./SimulationClockSurfaceStates.js";

/** Default projection refresh cadence for the polling fallback (ms). */
export const DEFAULT_SIMULATION_CLOCK_POLL_MS = 2000;

/** Configuration for the simulation-clock surface component. */
export interface SimulationClockToolSurfaceConfig {
  /** Polling fallback cadence in ms; 0 disables (default 2000). */
  readonly pollMs?: number;
}

export function createSimulationClockToolSurface(
  config: SimulationClockToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  // Frozen at factory time (the W007/W008 composition pattern).
  const pollMs = config.pollMs ?? DEFAULT_SIMULATION_CLOCK_POLL_MS;

  function SimulationClockToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const controller = useMemo(
      () => createClockTimelineProjectionController({ client, pollMs }),
      // One controller per seam client; the config is frozen at factory time.
      [client],
    );
    useEffect(() => {
      controller.start();
      return () => controller.stop();
    }, [controller]);
    const snapshot = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getServerSnapshot,
    );

    const [stepDeltaMs, setStepDeltaMs] = useState<number>(CLOCK_STEP_SIZE_OPTIONS[1]!.deltaMs);
    const [seekText, setSeekText] = useState<string>("");
    const [seekInputError, setSeekInputError] = useState<string | undefined>(undefined);

    const live = client.status === "ready" && seamClientHasPushChannels(client);
    const pending = snapshot.status === "ready" ? snapshot.pending !== undefined : false;

    const submitSeek = (): void => {
      const parsed = parseSeekTargetText(seekText);
      if (!parsed.ok) {
        // Input parsing only — the honest local form error. The MOVE is
        // always the engine's decision (its typed outcome renders below).
        setSeekInputError(parsed.error);
        return;
      }
      setSeekInputError(undefined);
      void controller.seek(parsed.to);
    };

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-clock-surface=""
        data-trading-world-clock-status={snapshot.status}
        data-trading-world-clock-live={live ? "push" : client.status === "ready" ? "poll" : "none"}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
          <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">
            simulation clock
          </span>
          <span
            data-trading-world-simulation-disclosure=""
            title="Simulation disclosure — this world has no live execution authority (World Alpha)"
            className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
          >
            {TRADING_WORLD_SIMULATED_DISCLOSURE}
          </span>
          <span
            data-trading-world-clock-live-indicator=""
            title={
              live
                ? "Live through the W018 push channels (clock: settled views after acked mutating clock calls)"
                : "Polling fallback (no push channels on this client)"
            }
            className={cn(
              "ml-auto shrink-0 font-mono text-ui-xs",
              live ? "text-foreground-subtlest" : "text-foreground-subtle",
            )}
          >
            {live ? "live · push" : "live · poll"}
          </span>
          <ClockOutcomeCapsule snapshot={snapshot} />
        </header>

        {snapshot.status === "ready" ? (
          <>
            <SimulationClockStripControls
              snapshot={snapshot}
              pending={pending}
              stepDeltaMs={stepDeltaMs}
              onStepDelta={setStepDeltaMs}
              seekText={seekText}
              seekInputError={seekInputError}
              onSeekText={(text) => {
                setSeekText(text);
                setSeekInputError(undefined);
              }}
              onSubmitSeek={submitSeek}
              onStep={() => {
                void controller.step(stepDeltaMs);
              }}
              onPlay={() => {
                void controller.play();
              }}
              onPause={() => {
                void controller.pause();
              }}
              onSpeed={(speed) => {
                void controller.setSpeed(speed);
              }}
            />
            <div className="flex min-h-0 flex-1 flex-col border-t border-border/50">
              <ClockTimelineList
                entries={snapshot.timeline}
                timelineError={snapshot.timelineError}
                pending={pending}
                onJump={(sequence) => {
                  void controller.jumpToEvent(sequence);
                }}
              />
            </div>
          </>
        ) : (
          <SimulationClockSurfaceStatusBody
            snapshot={snapshot}
            onRetry={() => {
              void controller.refresh();
            }}
          />
        )}

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Simulation clock surface mounted in background — state kept alive while hidden
            (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return SimulationClockToolSurface;
}

/** The readout + playback/step/seek controls of the strip. */
function SimulationClockStripControls({
  snapshot,
  pending,
  stepDeltaMs,
  onStepDelta,
  seekText,
  seekInputError,
  onSeekText,
  onSubmitSeek,
  onStep,
  onPlay,
  onPause,
  onSpeed,
}: {
  readonly snapshot: Extract<ClockTimelineProjectionSnapshot, { status: "ready" }>;
  readonly pending: boolean;
  readonly stepDeltaMs: number;
  readonly onStepDelta: (deltaMs: number) => void;
  readonly seekText: string;
  readonly seekInputError: string | undefined;
  readonly onSeekText: (text: string) => void;
  readonly onSubmitSeek: () => void;
  readonly onStep: () => void;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onSpeed: (speed: number) => void;
}) {
  const clock = describeSimulationClockView(snapshot.clock);
  const wall = describeWallAxis();
  const playing = snapshot.clock.status === "playing";
  return (
    <div
      data-trading-world-clock-controls=""
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5"
    >
      <span
        data-trading-world-clock-sim-time=""
        title="The simulation axis: the engine's own clock position (clock.getClock / the W018 clock channel) — never a client-side timer"
        className="shrink-0 font-mono text-ui-sm text-foreground"
      >
        {clock.timeText}
      </span>
      <span
        data-trading-world-clock-status-chip=""
        data-trading-world-clock-engine-status={snapshot.clock.status}
        title="The engine's clock status, verbatim. Headless engines have no timers: `playing` is a recorded mode — time still advances only on step/seek (A9 determinism)."
        className="shrink-0 rounded-sm border border-border bg-surface px-1.5 font-mono text-ui-xs leading-5 text-foreground-subtle"
      >
        {clock.statusText} · {clock.speedText}
        {clock.followingRealtime ? " · following realtime" : ""}
      </span>
      <span
        data-trading-world-clock-wall-axis=""
        title={wall.title}
        className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
      >
        wall: {wall.text}
      </span>
      <span
        data-trading-world-clock-controls-group="playback"
        className="flex shrink-0 items-center gap-1"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          data-trading-world-clock-play-pause=""
          data-trading-world-clock-play-pause-action={playing ? "pause" : "play"}
          title="clock.play()/clock.pause() — a REAL port command; the engine's status settles through the clock channel"
          onClick={() => (playing ? onPause() : onPlay())}
        >
          {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          data-trading-world-clock-step=""
          title="clock.step(deltaMs) — advance the simulation axis by the selected step size (a REAL port command)"
          onClick={onStep}
        >
          <StepForwardIcon className="size-3" />
          Step
        </Button>
        {CLOCK_STEP_SIZE_OPTIONS.map((option) => (
          <Button
            key={option.deltaMs}
            type="button"
            variant={option.deltaMs === stepDeltaMs ? "default" : "ghost"}
            size="xs"
            disabled={pending}
            data-trading-world-clock-step-size={option.deltaMs}
            title={`Step size: clock.step(${String(option.deltaMs)})`}
            onClick={() => onStepDelta(option.deltaMs)}
          >
            {option.label}
          </Button>
        ))}
      </span>
      <span
        data-trading-world-clock-controls-group="speed"
        className="flex shrink-0 items-center gap-1"
      >
        {CLOCK_SPEED_PRESET_OPTIONS.map((option) => (
          <Button
            key={option.speed}
            type="button"
            variant={option.speed === snapshot.clock.speed ? "default" : "ghost"}
            size="xs"
            disabled={pending}
            data-trading-world-clock-speed-preset={option.speed}
            title="clock.setSpeed(speed) — the speed multiplier bridges the wall and sim axes (A7); 1× = realtime"
            onClick={() => onSpeed(option.speed)}
          >
            {option.label}
          </Button>
        ))}
      </span>
      <span
        data-trading-world-clock-controls-group="seek"
        className="flex min-w-0 shrink-0 items-center gap-1"
      >
        <input
          value={seekText}
          onChange={(event) => onSeekText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSubmitSeek();
            }
          }}
          disabled={pending}
          data-trading-world-clock-seek-input=""
          aria-label="Seek target (UTC date-time or absolute simulation ms)"
          placeholder="2023-11-14 22:14:00"
          title="Absolute point on the simulation axis: a UTC date-time (YYYY-MM-DD HH:MM[:SS]) or simulation-ms integer. Backward targets are SENT — the engine answers the typed rewind-requires-branch rejection (A8)."
          className="h-6 w-44 rounded-sm border border-border bg-input/50 px-1.5 font-mono text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          data-trading-world-clock-seek-submit=""
          title="clock.seek(to) — a REAL port command; the engine's typed outcome renders in the header capsule"
          onClick={onSubmitSeek}
        >
          Seek
        </Button>
        {seekInputError !== undefined ? (
          <span
            data-trading-world-clock-seek-input-error=""
            className="shrink-0 font-mono text-ui-xs text-foreground-subtle"
            title="Local input parsing only — the honest form error. The move itself is always the engine's typed outcome."
          >
            {seekInputError}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The typed outcome of the last issued clock command (never swallowed). */
function ClockOutcomeCapsule({
  snapshot,
}: {
  readonly snapshot: ClockTimelineProjectionSnapshot;
}) {
  if (snapshot.status !== "ready") {
    return null;
  }
  const outcome = snapshot.outcome;
  if (outcome === undefined) {
    return null;
  }
  const rejected = outcome.kind === "rejected";
  return (
    <span
      data-trading-world-clock-outcome=""
      data-trading-world-clock-outcome-kind={outcome.kind}
      data-trading-world-clock-outcome-code={outcome.rejection?.code ?? ""}
      data-trading-world-clock-outcome-pending={snapshot.pending !== undefined ? "true" : "false"}
      title={
        rejected
          ? outcome.rejection !== undefined
            ? `${outcome.label} REJECTED · ${outcome.rejection.message} — ${outcome.rejection.explanation}`
            : `${outcome.label} failed: ${outcome.failure ?? "unknown error"}`
          : `${outcome.label} acked by the engine`
      }
      className={cn(
        "max-w-[22rem] shrink-0 truncate rounded-sm border px-1.5 font-mono text-ui-xs leading-5",
        rejected
          ? "border-warning/60 bg-warning/10 text-foreground"
          : "border-border bg-surface text-foreground-subtlest",
      )}
    >
      {rejected
        ? outcome.rejection !== undefined
          ? `${outcome.label} ✕ ${outcome.rejection.code}`
          : `${outcome.label} ✕ error`
        : `${outcome.label} ✓`}
    </span>
  );
}

/** The default simulation-clock surface (the World Alpha clock strip). */
export const SimulationClockToolSurface = createSimulationClockToolSurface();
