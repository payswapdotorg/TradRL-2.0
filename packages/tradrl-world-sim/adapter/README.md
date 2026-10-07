# W018 — World Worker adapter + UI transport

The `adapter/` module connects the W013 headless deterministic engine
(`../world/`) to the Trading World UI through ONE typed RPC envelope and TWO
adapter topologies (spec/SIMULATION.md "Runtime topology" + "Execution
targets"):

```
TradingWorld UI (packages/ui/src/trading-world/)
   │  World Client (provider — runtime/engineWorldClient.ts)
   ▼
WorldTransport  ◄── ONE interface, both topologies:
   ├─ Node in-process: createInProcessWorldTransport()   (headless runner, tests)
   └─ Web Worker:       worker.ts entry + createWorkerWorldTransport()
   ▼
WorldAdapterHost (host.ts — the same dispatch core in both)
   ▼
HeadlessWorldEngine (four ports: query / command / clock / evidence)
```

## RPC envelope (`envelope.ts` + `transport.ts`)

One discriminated envelope, structured-clone safe end to end:

- client → host: `init` (definition over the wire — worker hosts), `request`
  (`{ port, method, args }` against the four ports + the `host` control
  pseudo-port), `subscribe`/`unsubscribe` (`published` / `clock` channels),
  `dispose`.
- host → client: `response` (correlated by `requestId`; ok value or a
  serialized `WorldRemoteError`), `published` (the engine's `onPublished`
  seam: ack + ordered events with the ENGINE's sequence numbers), `clock`
  (the settled `ClockView` after acked mutating clock calls).

Determinism guard (work order W018): the transport NEVER fabricates or
reorders — requests dispatch in arrival order (FIFO postMessage), the
ENGINE's arrival-order queue is the only serializer, responses/pushes carry
engine data verbatim, and unknown ports/methods fail closed with typed
adapter errors.

`host` pseudo-port (adapter-level control, never world data): `describe`
(adapter/engine identity + envelope version) and `headlessReport` (the
SIMULATION.md headless run report — `eventCount` + `eventHash`, the parity
artifact of ACCEPTANCE I).

## Topologies

- **Node in-process** (`inProcess.ts`): engine + host core + an async
  (microtask) loopback wire with `structuredClone` on by default — the same
  wire discipline as a real worker. This is the headless-half of the UI/headless
  parity law and the intended transport for the headless runner (W019/W031).
- **Web Worker** (`worker.ts` + `workerHost.ts` + `workerTransport.ts`):
  bundle `adapter/worker.ts` as a module worker; it self-installs the host
  session on `self` (detected; importing it elsewhere is a no-op). The world
  definition arrives in the `init` message; every call crosses a real
  postMessage/structured-clone boundary. `asNodeWorkerChannel` runs the SAME
  host under `node:worker_threads` in tests (`adapter/test/worker.test.ts`).

## Realtime driver (`realtimeDriver.ts`)

The engine's `followRealtime` is a mode flag only (headless determinism, A9 —
no wall-clock timers in the engine). The optional TRANSPORT-layer driver steps
the clock by elapsed wall time × speed while `playing && followingRealtime`,
through the engine's ClockPort (so driver steps serialize with commands in
true arrival order). DISABLED by default: headless/parity runs leave it off;
interactive UIs enable it via `realtime: { enabled: true }` in the transport
options / init wire options.

## Parity evidence (ACCEPTANCE I)

`adapter/test/parity.test.ts` runs ONE fixed command+clock stream through
(a) the direct engine, (b) the in-process adapter and (c) a REAL
`worker_threads` adapter (different wall clocks) — identical headless reports
(`eventCount` + `eventHash`), identical determinism manifests, identical event
envelopes. The provider-level twin (the REAL UI client over both adapters) is
`packages/ui/test/tradingWorldTransportParity.test.ts`.

## TL wiring note (the W005 launcher pattern)

W006 mounted the shell with the fail-closed noop provider
(`TradingWorldShell.tsx` line ~109 — outside W018's frozen surface). The real
provider ships from W018's surface; the one-line swap (TL-owned) is:

```tsx
// packages/ui/src/trading-world/components/TradingWorldShell.tsx
const worldClient = useEngineWorldClient({
  worldId: tab.worldId,
  attachTransport: () =>
    createWorkerWorldTransport(
      asDomWorkerChannel(
        new Worker(
          new URL("../../../../tradrl-world-sim/adapter/worker.ts", import.meta.url),
          { type: "module" },
        ),
      ),
      { definition }, // the world catalog (W016/W019) supplies definitions
    ),
});
```

`useEngineWorldClient` (W018, `../ui/src/trading-world/runtime/`) fails
closed until the transport attaches and disposes on unmount. Wiring it
requires adding `tradrl-world-sim` to `packages/ui/package.json` — a TL-owned
manifest, deliberately not touched by W018.

## Test-side TypeScript in worker threads

tsx's loader does not register inside `node:worker_threads`; the worker tests
run the engine on Node's native `--experimental-transform-types` plus a
15-line `.js`→`.ts` resolver hook (`test/fixtures/tsjsResolver.mjs`) that
restores the repo's NodeNext specifier convention inside the thread. This is
test-fixture-only; production files keep the `.js` specifier convention.
