/**
 * Test-side helpers for the W018 adapter tests: a minimal envelope client
 * (request correlation + channel collection) and a deterministic parity
 * command/clock stream shared by the adapter-level parity law tests.
 *
 * The REAL provider (what the Trading World UI uses) lives in
 * `packages/ui/src/trading-world/runtime/engineWorldClient.ts` and is proven
 * over both adapters by the UI-side parity test; this helper is the
 * envelope-level twin used by the sim package's own tests.
 */

import type { ClockPort, ClockView, CommandPort, EvidencePort } from "tradrl-world-contracts";
import type { HeadlessRunReport } from "../../world/index.js";
import type {
  WorldPortName,
  WorldPublishedProjection,
} from "../envelope.js";
import type { WorldTransport } from "../transport.js";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

const BOOTSTRAP = resolvePath(import.meta.dirname, "fixtures/nodeWorkerBootstrap.ts");

/**
 * Spawn a REAL worker thread running the adapter bootstrap.
 *
 * The thread runs on Node's native TypeScript transform
 * (`--experimental-transform-types`); tsx's loader does not register inside
 * worker threads, so the bootstrap registers the tiny `.js`→`.ts` resolver
 * hook itself (see fixtures/tsjsResolver.mjs). No tsx execArgv is forwarded.
 */
export function spawnAdapterWorker(): Worker {
  return new Worker(pathToFileURL(BOOTSTRAP), {
    execArgv: ["--experimental-transform-types"],
  });
}

/** An engine error reconstructed client-side from a serialized remote error. */
export class TestRemoteError extends Error {
  constructor(
    readonly remoteName: string,
    message: string,
    readonly data?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "TestRemoteError";
  }
}

/** The minimal client the adapter tests drive a transport with. */
export interface TestWorldClient {
  call(port: WorldPortName, method: string, args?: readonly unknown[]): Promise<unknown>;
  readonly published: readonly WorldPublishedProjection[];
  readonly clockViews: readonly ClockView[];
  close(): void;
}

/** Correlate requests over a transport and collect channel pushes. */
export function createTestWorldClient(transport: WorldTransport): TestWorldClient {
  let nextRequestId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();
  const published: WorldPublishedProjection[] = [];
  const clockViews: ClockView[] = [];
  // Fail closed: a transport that can no longer deliver rejects every pending
  // request (the same law the real UI provider enforces).
  transport.onTransportClosed(() => {
    for (const entry of Array.from(pending.values())) {
      entry.reject(new Error("world adapter transport closed"));
    }
    pending.clear();
  });
  transport.onHostMessage((message) => {
    if (message.kind === "response") {
      const entry = pending.get(message.requestId);
      if (entry === undefined) {
        return;
      }
      pending.delete(message.requestId);
      if (message.outcome.status === "ok") {
        entry.resolve(message.outcome.value);
      } else {
        entry.reject(
          new TestRemoteError(
            message.outcome.error.name,
            message.outcome.error.message,
            message.outcome.error.data,
          ),
        );
      }
      return;
    }
    if (message.kind === "published") {
      published.push(message.projection);
      return;
    }
    clockViews.push(message.clock);
  });
  transport.postMessage({ kind: "subscribe", channel: "published" });
  transport.postMessage({ kind: "subscribe", channel: "clock" });
  return {
    call(port, method, args = []) {
      return new Promise((resolve, reject) => {
        const requestId = nextRequestId;
        nextRequestId += 1;
        pending.set(requestId, { resolve, reject });
        transport.postMessage({
          kind: "request",
          requestId,
          call: { port, method, args },
        });
      });
    },
    get published() {
      return published;
    },
    get clockViews() {
      return clockViews;
    },
    close() {
      transport.close();
    },
  };
}

/** The four ports + the headless report — the surface a parity stream runs on. */
export interface ParityWorldRuntime {
  readonly command: CommandPort;
  readonly clock: ClockPort;
  readonly evidence: EvidencePort;
  headlessReport(): Promise<HeadlessRunReport>;
}

/**
 * The fixed parity stream: a deterministic mix of acked commands (annotation,
 * scenario), typed rejections (structural, unknown participant, W014 stub,
 * duplicate), and clock operations (steps, forward seeks, speed, play/pause),
 * interleaved. Runs identically over any {@link ParityWorldRuntime}.
 */
export async function runParityStream(
  runtime: ParityWorldRuntime,
  options: { readonly worldId: string; readonly participant: string; readonly start: number },
): Promise<{ readonly report: HeadlessRunReport; readonly manifest: unknown; readonly events: readonly unknown[] }> {
  const { worldId, participant, start } = options;
  const annotate = (commandId: string, text: string) =>
    runtime.command.addAnnotation({
      kind: "add-annotation",
      commandId: commandId as never,
      worldId: worldId as never,
      issuedBy: participant as never,
      issuedAt: start as never,
      at: (start + 500) as never,
      text,
    });
  let rngState = 0x5eed_018 >>> 0;
  const rng = () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  await runtime.clock.play();
  for (let i = 0; i < 24; i += 1) {
    const roll = rng();
    if (roll < 0.2) {
      await runtime.clock.step(1_000 + Math.floor(rng() * 9_000));
    } else if (roll < 0.3) {
      const clock = await runtime.clock.getClock();
      await runtime.clock.seek((clock.simulationTime + 2_000) as never);
    } else if (roll < 0.35) {
      await runtime.clock.setSpeed(1 + Math.floor(rng() * 4));
    } else if (roll < 0.45) {
      await runtime.clock.pause();
      await runtime.clock.play();
    } else if (roll < 0.65) {
      await annotate(`parity-ann-${String(i)}`, `note ${String(i)}`);
    } else if (roll < 0.72) {
      await runtime.command.setScenario({
        kind: "set-scenario",
        commandId: `parity-scn-${String(i)}` as never,
        worldId: worldId as never,
        issuedBy: participant as never,
        issuedAt: (start + i) as never,
        scenario: { entries: [{ regime: "shock", from: start as never }] },
      });
    } else if (roll < 0.8) {
      // structural rejection: blank annotation text
      await annotate(`parity-bad-${String(i)}`, " ");
    } else if (roll < 0.87) {
      // unknown-participant rejection
      await runtime.command.addAnnotation({
        kind: "add-annotation",
        commandId: `parity-ghost-${String(i)}` as never,
        worldId: worldId as never,
        issuedBy: "participant-nope" as never,
        issuedAt: (start + i) as never,
        at: start as never,
        text: "ghost",
      });
    } else if (roll < 0.94) {
      // W014 stub rejection (submit-order not implemented in the skeleton)
      await runtime.command.submitOrder({
        kind: "submit-order",
        commandId: `parity-order-${String(i)}` as never,
        worldId: worldId as never,
        issuedBy: participant as never,
        issuedAt: (start + i) as never,
        accountId: "account-trader" as never,
        instrumentId: "instrument-es-fut" as never,
        submission: {
          kind: "limit",
          side: "buy",
          quantity: "1" as never,
          limitPrice: "4800.25" as never,
          constraints: { timeInForce: "GTC" },
        },
      });
    } else {
      // duplicate re-issue of the previous annotation command id
      await annotate(`parity-ann-${String(Math.max(0, i - 1))}`, "duplicate");
    }
  }
  return {
    report: await runtime.headlessReport(),
    manifest: await runtime.evidence.getDeterminismManifest(),
    events: await runtime.evidence.getEvents({}),
  };
}
