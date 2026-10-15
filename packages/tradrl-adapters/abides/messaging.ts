/**
 * The ABIDES-style message scheduler (W024) — the ordered event/message
 * fabric over the SIMULATION clock.
 *
 * Spec: spec/WORK-ITEMS.md W024 — "an ordered message/event scheduler over
 * the simulation clock (A7 separation held — never wall time)". Spec:
 * spec/ARCHITECTURE-LOCK.md A6 — the world changes through ordered events;
 * this scheduler is the transport-level orderer that makes the reactive loop
 * causal: nothing is delivered before its `arriveAt`, and ties break by
 * (message class priority, global enqueue sequence) — fully deterministic.
 *
 * THE ARRIVAL LAW: `arriveAt = sentAt + latency` (resolved by ./latency.ts).
 * Enqueue validation is loud and fail-closed (./errors.ts
 * "out-of-order-message"): a transport message may not be SENT from the
 * simulation future, and nothing may ARRIVE in the already-delivered past.
 * Scheduled self-wakes (`agent-wake`) are the one exception on the send side:
 * a timer legitimately arms for a future time (the ABIDES wake-up request
 * semantic); it still may not arrive in the past.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  CommandId,
  CommandResult,
  Fill,
  InstrumentId,
  Order,
  OrderBookSnapshot,
  Portfolio,
  Quote,
  RiskState,
  TimestampMs,
  Trade,
  WorldCommand,
} from "tradrl-world-contracts";
import { AbidesAdapterError } from "./errors.js";

/** Message classes, with their drain priority (lower drains first on ties). */
export type AbidesMessageClass =
  | "order-command" // actor → exchange: a typed world command in flight
  | "order-delivery" // exchange → actor: outcome/order-state/account delivery
  | "market-data" // exchange → observing actors: book/quote/print propagation
  | "agent-wake"; // actor → itself: a scheduled self-wake (timer)

/** The closed priority table (ties at one arrival time drain in this order). */
export const MESSAGE_CLASS_PRIORITY: Readonly<Record<AbidesMessageClass, number>> = {
  "order-command": 0,
  "order-delivery": 1,
  "market-data": 2,
  "agent-wake": 3,
};

/** One message on the fabric. `sequence` is the global enqueue counter (final tie-break). */
export interface AbidesMessage<TPayload = unknown> {
  readonly messageId: string;
  readonly messageClass: AbidesMessageClass;
  readonly from: string;
  readonly to: string;
  readonly sentAt: TimestampMs;
  readonly arriveAt: TimestampMs;
  readonly sequence: number;
  readonly payload: TPayload;
}

// --- payload vocabulary --------------------------------------------------------

/** An in-flight typed world command (actor → exchange). */
export interface OrderCommandPayload {
  readonly command: WorldCommand;
}

/**
 * An exchange → actor delivery: the actor's own order records (post state),
 * the fills this delivery is propagating, the account projections, and — on
 * the issuer's response only — the typed CommandResult. `orders` (and the
 * projections) are OPTIONAL because a pure-result delivery (the transport
 * law's floor for typed rejections that touched nothing) carries only the
 * `commandId` + `result`.
 */
export interface OrderDeliveryPayload {
  readonly commandId?: CommandId;
  readonly result?: CommandResult;
  readonly orders?: readonly Order[];
  readonly fills?: readonly Fill[];
  readonly portfolio?: Portfolio;
  readonly risk?: RiskState;
}

/** Market-data propagation for one instrument (already depth-truncated per recipient). */
export interface MarketDataPayload {
  readonly instrumentId: InstrumentId;
  readonly venueTime: TimestampMs;
  readonly book: OrderBookSnapshot;
  readonly quote: Quote;
  readonly trades: readonly Trade[];
}

/** A scheduled self-wake (the agent's own timer). */
export interface AgentWakePayload {
  readonly reason: string;
}

// --- scheduler -----------------------------------------------------------------

/** Options for {@link createMessageScheduler}. */
export interface MessageSchedulerOptions {
  /** The simulation-clock reader (the scheduler never owns time — A7). */
  readonly now: () => TimestampMs;
  /** Allocates message ids (deterministic: the kernel's counter). */
  readonly nextMessageId: () => string;
}

/** The ordered fabric. */
export interface MessageScheduler {
  /** Validate + insert one message (throws `out-of-order-message` — fail closed). */
  enqueue(message: Omit<AbidesMessage, "messageId" | "sequence">): AbidesMessage;
  /** The next deliverable message, without removing it. */
  peek(): AbidesMessage | undefined;
  /** Remove and return the next message (the caller must have advanced the clock to its arrival). */
  pop(): AbidesMessage | undefined;
  /** Number of queued messages. */
  readonly size: number;
  /** Messages delivered so far (diagnostics). */
  readonly delivered: number;
}

/** The total order over messages: arrival time, then class priority, then enqueue sequence. */
function messageOrder(a: AbidesMessage, b: AbidesMessage): number {
  if (a.arriveAt !== b.arriveAt) return a.arriveAt < b.arriveAt ? -1 : 1;
  const pa = MESSAGE_CLASS_PRIORITY[a.messageClass];
  const pb = MESSAGE_CLASS_PRIORITY[b.messageClass];
  if (pa !== pb) return pa - pb;
  return a.sequence - b.sequence;
}

/** Create the scheduler. */
export function createMessageScheduler(options: MessageSchedulerOptions): MessageScheduler {
  const queue: AbidesMessage[] = [];
  let sequence = 0;
  let delivered = 0;

  return {
    enqueue(input) {
      const now = options.now();
      const scheduled = input.messageClass === "agent-wake";
      if (!scheduled && input.sentAt > now) {
        throw new AbidesAdapterError(
          "out-of-order-message",
          `${input.messageClass} from ${input.from} sent at ${String(input.sentAt)} but the simulation clock is at ${String(now)} (a transport message may not be sent from the future)`,
        );
      }
      if (input.arriveAt < now) {
        throw new AbidesAdapterError(
          "out-of-order-message",
          `${input.messageClass} from ${input.from} would arrive at ${String(input.arriveAt)} but the simulation clock is already at ${String(now)} (nothing may arrive in the delivered past)`,
        );
      }
      sequence += 1;
      const message: AbidesMessage = {
        ...input,
        messageId: options.nextMessageId(),
        sequence,
      };
      // Sorted insert (binary search on the total order).
      let low = 0;
      let high = queue.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (messageOrder(queue[mid]!, message) <= 0) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }
      queue.splice(low, 0, message);
      return message;
    },
    peek() {
      return queue[0];
    },
    pop() {
      const head = queue.shift();
      if (head !== undefined) {
        delivered += 1;
      }
      return head;
    },
    get size() {
      return queue.length;
    },
    get delivered() {
      return delivered;
    },
  };
}
