# tests/trading-world — the W019 World Alpha golden integration suite

THE acceptance gate for Trader World Alpha (`spec/ACCEPTANCE-WORLD-ALPHA.md`):
the golden journey, the determinism golden, the honest-state journeys and the
transport-parity extension, all on the REAL composed product — the W018
provider (`attachEngineWorldClient`) over the TL-wired alpha attachment
(`createAlphaEngineTransport`: the W017 generated market behind the W018
in-process adapter), which is exactly what `TradingWorldShell` mounts for a
Trading World pane. Every surface package (W007–W012) is cross-checked
against the engine's direct projections (ACCEPTANCE F).

## Invocation (the gate)

From `packages/ui` (cwd matters: tsx discovers tsconfig per run-directory —
running from `packages/ui` gives every file — suite and product sources —
the correct `jsx: react-jsx` + `@/` alias resolution; running from the repo
root does NOT):

```
cd packages/ui
../../node_modules/.bin/tsx --test ../../tests/trading-world/goldenJourney.test.ts
../../node_modules/.bin/tsx --test ../../tests/trading-world/honestStateJourneys.test.ts
../../node_modules/.bin/tsx --test ../../tests/trading-world/determinismGolden.test.ts
../../node_modules/.bin/tsx --test ../../tests/trading-world/determinismGoldenWallTwin.test.ts
../../node_modules/.bin/tsx --test ../../tests/trading-world/parityExtension.test.ts
```

(Run the five files as separate invocations: the two multi-minute files run
their journeys sequentially inside one process each, so peak memory stays at
~one engine per file; a single glob also picks up `zz-*` scratch probes that
are never part of the gate.)

No package manifest, no install, no workspace changes: the suite imports the
real merged sources directly (the established test-side pattern since W005).
Files are executed by the Node test runner; the two multi-minute files
(`determinismGolden`, `goldenJourney`) run their journeys sequentially inside
one process each, so peak memory stays at ~one engine per file.

## Files

| File | Part | What it proves |
| --- | --- | --- |
| `goldenJourney.helpers.ts` | — | The frozen scripted journey (command stream + per-stage fact capture). Any command/clock change changes every pinned digest. |
| `goldenJourney.test.ts` | 1 — THE GOLDEN JOURNEY | One scripted trader session through the multi-regime day (mean-reversion → trend → high-volatility → low-liquidity → mean-reversion): fills/rests/cancels/replaces/typed rejections, every surface's numbers cross-checked against direct engine projections (B/C/D/E/F/L + the projection law + pinned digests). ~6 min. |
| `determinismGolden.test.ts` | 2 — THE DETERMINISM GOLDEN | The SAME journey twice with wall axes a day apart ⇒ identical journal digests + manifests + end state (A9 at the integration level); a different seed diverges. ~12 min. |
| `honestStateJourneys.test.ts` | 3 — HONEST-STATE JOURNEYS | The A7 information firewall (a fill's print withheld until `availableAt`); transport death fails closed (in-process AND a real worker thread killed mid-seek, with the live surfaces degrading honestly); unknown entities are typed remote errors and unlawful commands typed rejection values; the A8 rewind-requires-branch refusal surfaced through the real clock surface; the SIMULATED disclosure present in every composed tool surface (K). ~1 min. |
| `parityExtension.test.ts` | 4 — PARITY EXTENSION | The generated alpha market behind the REAL provider over the in-process adapter == over a REAL `worker_threads` adapter (identical published projections, digests, manifests, clock views). ~2 min. |
| `workerFixture.helpers.ts` | — | Spawns the real worker twin + attaches the provider (shared by parts 3/4). |
| `fixtures/generatedEngineWorkerBootstrap.ts` | — | The worker-thread entry hosting the W017 generated engine (the same `createEngine` wiring the composed alpha attachment uses — the shipped W018 bootstrap hosts the plain headless engine). |

## Disclosed integration seam (the one product-file change of W019)

`packages/ui/src/trading-world/runtime/engineAttachment.ts`:
`createAlphaEngineTransport(worldId, options?)` gained an OPTIONAL
`wallTimeSource` (forwarded to the W018 in-process adapter's existing seam).
Default behavior is bit-identical to before; the option exists so the
determinism golden can run the same composed attachment with wall axes a day
apart (the W017-golden methodology). Disclosed in the W019 PR.

## Honest scope notes

- The full-day worker-parity leg is deliberately NOT run (it would double
  the suite's wall cost for no additional law); part 4 crosses the first
  regime boundary (~5k events) over both topologies. The full day is proven
  twice over the in-process topology in part 2.
- ACCEPTANCE J (performance) is NOT this suite's law — W030 owns it; the
  suite only records wall timings as diagnostics.
- ACCEPTANCE A (dock) browser behavior is the W005/W006 pane contracts and
  their browser E2E evidence; this suite proves the composed product's data
  laws in-process.
