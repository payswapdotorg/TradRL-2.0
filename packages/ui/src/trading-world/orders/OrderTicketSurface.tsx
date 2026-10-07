/**
 * Order ticket tool surface — W010 (the order-entry ticket of the cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Order Ticket cell) and
 * "Simulation disclosure"; spec/WORK-ITEMS.md W010 ("order-entry ticket
 * (kind: market/limit/stop/stop-limit; side buy/sell; quantity; price(s);
 * TIF constraints) submitting through client.command.submitOrder");
 * spec/ARCHITECTURE-LOCK.md A6/A13/A14 (the venue is the authority; the UI
 * never fabricates; simulation is visibly disclosed).
 *
 * OUTCOMES ARE THE ENGINE'S TYPED VALUES (work order W010): every submission
 * goes through the real CommandPort and surfaces the ack (journalCursor +
 * commandId displayed) or the typed rejection (stage + code + message —
 * never swallowed). Thrown typed errors (TradingWorldRemoteError, closed
 * transport) surface as honest error capsules. Structural pre-submit
 * validation only PREPARES the submission (disabled-with-reason); it never
 * replaces the engine's verdict.
 *
 * Form discipline: the ticket only offers what the venue policy allows
 * (composition config; the alpha venue declaration). Forbidden kinds/TIFs
 * render disabled WITH reasons — never silently removed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { ClockView } from "../runtime/worldContracts.js";
import {
  ALPHA_TRADER_IDENTITY,
  ALPHA_VENUE_POLICY,
  buildSubmitOrderCommand,
  createDefaultOrderTicketFormState,
  newUiCommandId,
  ORDER_TICKET_KINDS,
  ORDER_TICKET_SIDES,
  ORDER_TICKET_TIFS,
  resolveOrderTicketIdentity,
  validateOrderTicketForm,
  type OrderTicketFormState,
  type OrderTicketIdentitySpec,
  type OrderTicketInstrumentFacts,
  type OrderTicketVenuePolicy,
} from "./orderTicket.js";
import {
  describeCommandOutcome,
  describeThrownCommandError,
  type CommandOutcomeCapsule,
} from "./orderLifecycle.js";
import {
  DEFAULT_ORDERS_POLL_MS,
  OrderOptionButton,
  OrderSurfaceHeader,
  TicketOutcomeList,
  useEngineClockView,
  useEngineProjectionRevision,
} from "./OrderSurfaceStates.js";

/** Configuration for the order-ticket surface component. */
export interface OrderTicketSurfaceConfig {
  /** The trader identity the ticket submits as (default: alpha convention). */
  readonly identity?: OrderTicketIdentitySpec;
  /** Venue policy — what the form may offer (default: alpha venue). */
  readonly policy?: OrderTicketVenuePolicy;
  /** Projection refresh cadence for instrument facts + clock (default 2000). */
  readonly pollMs?: number;
}

const MAX_OUTCOME_CAPSULES = 5;

export function createOrderTicketSurface(
  config: OrderTicketSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec = config.identity ?? ALPHA_TRADER_IDENTITY;
  const policy = config.policy ?? ALPHA_VENUE_POLICY;
  const pollMs = config.pollMs ?? DEFAULT_ORDERS_POLL_MS;

  function OrderTicketSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const identity = useMemo(
      () => resolveOrderTicketIdentity(identitySpec, props.worldId),
      [props.worldId],
    );
    const revision = useEngineProjectionRevision(client, pollMs);
    const clockView: ClockView | undefined = useEngineClockView(client, pollMs);
    const [form, setForm] = useState<OrderTicketFormState>(createDefaultOrderTicketFormState);
    const [instrumentState, setInstrumentState] = useState<
      { status: "loading" } | { status: "ready"; facts: OrderTicketInstrumentFacts } | { status: "error"; message: string }
    >({ status: "loading" });
    const [outcomes, setOutcomes] = useState<readonly CommandOutcomeCapsule[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // Instrument facts (tick/lot/trading state) from the REAL projection —
    // used for structural pre-submit hints. A failed read is an honest
    // absence: the form stays usable and the engine still judges submissions.
    const fetchInstrument = useCallback(
      async (signal: { cancelled: boolean }): Promise<void> => {
        try {
          const instrument = await client.query.getInstrument(identity.instrumentId);
          if (signal.cancelled) {
            return;
          }
          setInstrumentState({
            status: "ready",
            facts: {
              tickSize: instrument.tickSize,
              lotSize: instrument.lotSize,
              tradingState: instrument.tradingState,
              tradable: instrument.tradable,
            },
          });
        } catch (error) {
          if (signal.cancelled) {
            return;
          }
          setInstrumentState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      [client, identity.instrumentId],
    );

    useEffect(() => {
      if (client.status !== "ready") {
        return;
      }
      const signal = { cancelled: false };
      void fetchInstrument(signal);
      return () => {
        signal.cancelled = true;
      };
    }, [client, revision, fetchInstrument]);

    const problems = useMemo(
      () =>
        validateOrderTicketForm(form, {
          policy,
          ...(instrumentState.status === "ready" ? { instrument: instrumentState.facts } : {}),
        }),
      [form, policy, instrumentState],
    );

    const submitDisabledReasons = useMemo(() => {
      const reasons: readonly string[] = [
        ...(client.status !== "ready"
          ? ["no world runtime attached (fail-closed — commands go to the real CommandPort only)"]
          : []),
        ...(problems.map((problem) => problem.message)),
      ];
      return reasons;
    }, [client.status, problems]);

    const handleSubmit = useCallback(async () => {
      if (submitting || submitDisabledReasons.length > 0) {
        return;
      }
      setSubmitting(true);
      const recordOutcome = (capsule: CommandOutcomeCapsule): void => {
        setOutcomes((previous) => [capsule, ...previous].slice(0, MAX_OUTCOME_CAPSULES));
      };
      try {
        // issuedAt in the WORLD's time domain (W004/A7): the settled
        // simulation-clock view — fetched fresh when no view is cached.
        let issuedAt = clockView?.simulationTime;
        if (issuedAt === undefined) {
          const view = await client.clock.getClock();
          issuedAt = view.simulationTime;
        }
        const command = buildSubmitOrderCommand({
          identity,
          worldId: props.worldId,
          form,
          commandId: newUiCommandId("submit"),
          issuedAt,
        });
        const result = await client.command.submitOrder(command);
        recordOutcome(describeCommandOutcome(result));
      } catch (error) {
        // Typed remote/transport errors surface as honest error capsules.
        recordOutcome(describeThrownCommandError(error));
      } finally {
        setSubmitting(false);
      }
    }, [submitting, submitDisabledReasons, client, clockView, identity, props.worldId, form]);

    const update = useCallback((patch: Partial<OrderTicketFormState>): void => {
      setForm((previous) => ({ ...previous, ...patch }));
    }, []);

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-order-ticket=""
        data-trading-world-ticket-runtime={client.status}
        data-trading-world-ticket-instrument={identity.instrumentId}
        data-trading-world-ticket-submission={submitting ? "submitting" : "idle"}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <OrderSurfaceHeader toolId={props.toolId} instrumentId={identity.instrumentId} clock={clockView} />
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2">
          {client.status !== "ready" ? (
            <p
              data-trading-world-ticket-notice="unattached"
              className="rounded-sm border border-border/50 bg-surface px-2 py-1 text-ui-xs text-foreground-subtle"
            >
              No world runtime attached — the ticket submits through the real CommandPort only
              (fail-closed; no fabricated outcomes).
            </p>
          ) : null}
          {instrumentState.status === "error" ? (
            <p
              data-trading-world-ticket-notice="instrument-error"
              title="query.getInstrument rejected (typed) — structural hints are unavailable; the engine still judges every submission"
              className="rounded-sm border border-border/50 bg-surface px-2 py-1 font-mono text-ui-xs text-foreground-subtle"
            >
              instrument rules unavailable: {instrumentState.message}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2" data-trading-world-ticket-kind-group="">
            {ORDER_TICKET_KINDS.map((kind) => {
              const offered = policy.allowedOrderKinds.includes(kind);
              return (
                <OrderOptionButton
                  key={kind}
                  selected={form.kind === kind}
                  offered={offered}
                  label={kind}
                  suffix={offered ? undefined : "(not on venue)"}
                  data-trading-world-ticket-kind={kind}
                  data-trading-world-ticket-kind-offered={offered ? "true" : "false"}
                  title={
                    offered
                      ? `${kind} order`
                      : `venue ${policy.label} does not accept ${kind} orders (order-kind-not-supported)`
                  }
                  onClick={() => update({ kind })}
                  className="text-left"
                />
              );
            })}
          </div>

          <div className="flex items-center gap-2" data-trading-world-ticket-side-group="">
            {ORDER_TICKET_SIDES.map((side) => (
              <OrderOptionButton
                key={side}
                selected={form.side === side}
                label={side}
                data-trading-world-ticket-side={side}
                title={`${side} side`}
                onClick={() => update({ side })}
                className="flex-1"
              />
            ))}
          </div>

          <label className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
            <span className="w-14 shrink-0">Quantity</span>
            <input
              type="text"
              value={form.quantity}
              data-trading-world-ticket-field="quantity"
              onChange={(event) => update({ quantity: event.target.value })}
              className="h-6 min-w-0 flex-1 rounded-sm border border-input-border bg-input px-2 font-mono text-ui-xs text-foreground outline-none"
              inputMode="decimal"
              placeholder="e.g. 3"
            />
          </label>

          <label className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
            <span className="w-14 shrink-0">Limit px</span>
            <input
              type="text"
              value={form.limitPrice}
              disabled={form.kind === "market" || form.kind === "stop"}
              data-trading-world-ticket-field="limitPrice"
              title={
                form.kind === "market" || form.kind === "stop"
                  ? `a ${form.kind} order cannot carry a limit price (engine: invalid-price)`
                  : "limit price — canonical decimal text on the venue's tick grid"
              }
              onChange={(event) => update({ limitPrice: event.target.value })}
              className="h-6 min-w-0 flex-1 rounded-sm border border-input-border bg-input px-2 font-mono text-ui-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
              inputMode="decimal"
              placeholder="e.g. 4800.25"
            />
          </label>

          <label className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
            <span className="w-14 shrink-0">Stop px</span>
            <input
              type="text"
              value={form.stopPrice}
              disabled={form.kind === "market" || form.kind === "limit"}
              data-trading-world-ticket-field="stopPrice"
              title={
                form.kind === "market" || form.kind === "limit"
                  ? `a ${form.kind} order cannot carry a stop price (engine: invalid-price)`
                  : "stop price — canonical decimal text on the venue's tick grid"
              }
              onChange={(event) => update({ stopPrice: event.target.value })}
              className="h-6 min-w-0 flex-1 rounded-sm border border-input-border bg-input px-2 font-mono text-ui-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
              inputMode="decimal"
              placeholder="e.g. 4800.00"
            />
          </label>

          <div className="flex items-center gap-1" data-trading-world-ticket-tif-group="">
            <span className="w-14 shrink-0 text-ui-xs text-foreground-subtle">TIF</span>
            {ORDER_TICKET_TIFS.map((tif) => {
              const offered = policy.allowedTimeInForce.includes(tif);
              return (
                <OrderOptionButton
                  key={tif}
                  selected={form.timeInForce === tif}
                  offered={offered}
                  label={tif}
                  data-trading-world-ticket-tif={tif}
                  data-trading-world-ticket-tif-offered={offered ? "true" : "false"}
                  title={
                    offered ? `time-in-force ${tif}` : `venue ${policy.label} does not accept ${tif}`
                  }
                  onClick={() => update({ timeInForce: tif })}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <label
              className="flex items-center gap-1 text-ui-xs text-foreground-subtle"
              title={
                form.kind === "market"
                  ? "a post-only market order takes by definition — the venue rejects it (post-only-would-take)"
                  : "reject if the order would take liquidity"
              }
            >
              <input
                type="checkbox"
                checked={form.postOnly}
                disabled={form.kind === "market"}
                data-trading-world-ticket-field="postOnly"
                onChange={(event) => update({ postOnly: event.target.checked })}
                className="size-3"
              />
              post-only
            </label>
            <label
              className="flex items-center gap-1 text-ui-xs text-foreground-subtle"
              title="reject if executing would increase the position's absolute size"
            >
              <input
                type="checkbox"
                checked={form.reduceOnly}
                data-trading-world-ticket-field="reduceOnly"
                onChange={(event) => update({ reduceOnly: event.target.checked })}
                className="size-3"
              />
              reduce-only
            </label>
          </div>

          {problems.length > 0 ? (
            <ul data-trading-world-ticket-problems="" className="flex flex-col gap-0.5">
              {problems.map((problem, index) => (
                <li
                  key={`${problem.field}-${String(index)}`}
                  data-trading-world-ticket-problem={problem.field}
                  className="font-mono text-ui-xs text-foreground-subtle"
                >
                  · {problem.message}
                </li>
              ))}
            </ul>
          ) : null}

          {instrumentState.status === "ready" ? (
            <p data-trading-world-ticket-instrument-facts="" className="font-mono text-ui-xs text-foreground-subtlest">
              venue {policy.label} · tick {instrumentState.facts.tickSize} · lot{" "}
              {instrumentState.facts.lotSize} · market {instrumentState.facts.tradingState}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={submitDisabledReasons.length > 0 || submitting}
              data-trading-world-ticket-submit=""
              title={
                submitDisabledReasons.length > 0
                  ? submitDisabledReasons.join(" · ")
                  : "submit through client.command.submitOrder (the engine's typed outcome decides)"
              }
              onClick={() => void handleSubmit()}
            >
              {submitting ? "Submitting…" : `Submit ${form.side} ${form.kind}`}
            </Button>
            {submitDisabledReasons.length > 0 ? (
              <span className="text-ui-xs text-foreground-subtlest">
                submission disabled: {submitDisabledReasons.length} structural reason
                {submitDisabledReasons.length === 1 ? "" : "s"} (listed above)
              </span>
            ) : null}
          </div>

          <TicketOutcomeList outcomes={outcomes} />
        </div>

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Order ticket mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return OrderTicketSurface;
}

/** The default order ticket (alpha-world identity + venue policy). */
export const OrderTicketSurface = createOrderTicketSurface();
