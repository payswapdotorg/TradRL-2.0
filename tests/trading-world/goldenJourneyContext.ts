/**
 * The W019 golden journey — the shared journey context (the attached client
 * plus the small read/submit helpers every stage uses). Split from
 * goldenJourney.helpers.ts for the 400-line lint law; the code is verbatim.
 */

import type { EngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import {
  GOLDEN_ACCOUNT_ID,
  GOLDEN_INSTRUMENT_ID,
  GOLDEN_PARTICIPANT_ID,
  GOLDEN_WORLD_ID,
} from "./goldenJourneyFacts.js";

/** Everything the journey stages share: the client + collectors + helpers. */
export interface JourneyContext {
  readonly client: EngineWorldClient;
  readonly inst: never;
  readonly account: never;
  readonly participant: never;
  readonly world: never;
  readonly published: unknown[];
  readonly clockViews: unknown[];
  now(): Promise<number>;
  ourOrders(): Promise<readonly Record<string, unknown>[]>;
  regimes(): Promise<{ at: number; to: string; parameters?: unknown }[]>;
  submit(commandId: string, submission: Record<string, unknown>, issuedAt: number): Promise<Record<string, unknown>>;
}

/** Build the journey context over an already-attached client. */
export function makeJourneyContext(client: EngineWorldClient): JourneyContext {
  const published: unknown[] = [];
  const clockViews: unknown[] = [];
  client.onPublished((projection) => published.push(projection));
  client.onClock((clock) => clockViews.push(clock));

  const inst = GOLDEN_INSTRUMENT_ID as never;
  const account = GOLDEN_ACCOUNT_ID as never;
  const participant = GOLDEN_PARTICIPANT_ID as never;
  const world = GOLDEN_WORLD_ID as never;

  const now = async () => (await client.clock.getClock()).simulationTime;
  const ourOrders = async () => {
    const all = await client.query.getOrders({});
    return all.filter((order) => order.accountId === (GOLDEN_ACCOUNT_ID as never));
  };
  const regimes = async () => {
    const timeline = await client.query.getTimeline({ types: ["market.regime.changed"] });
    return timeline.events.map((event) => {
      const payload = (event as { payload?: { to?: string } }).payload;
      // Only the origin-rule announcement carries parameters (the anchor);
      // absent parameters stay ABSENT (deepStrictEqual key discipline).
      const parameters = (payload as { parameters?: unknown } | undefined)?.parameters;
      return {
        at: (event as { occurredAt?: number }).occurredAt ?? 0,
        to: payload?.to ?? "?",
        ...(parameters === undefined ? {} : { parameters }),
      };
    });
  };
  const submit = (commandId: string, submission: Record<string, unknown>, issuedAt: number) =>
    client.command.submitOrder({
      kind: "submit-order",
      commandId: commandId as never,
      worldId: world,
      issuedBy: participant,
      issuedAt: issuedAt as never,
      accountId: account,
      instrumentId: inst,
      submission,
    } as never) as Promise<Record<string, unknown>>;

  return {
    client, inst, account, participant, world, published, clockViews,
    now, ourOrders, regimes, submit,
  };
}
