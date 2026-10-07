# tradrl-world-cli (W031)

The headless World CLI/replay runner: runs a World from a definition file
(JSON), drives a scripted command/clock stream, and prints the deterministic
run report — plus REPLAY: rebuild the world state from a journal file and
continue. Pure node — no UI, no servers.

Built on the merged surfaces of TradRL-2.0:
- `tradrl-world-sim/world` (W013+) — `createHeadlessWorldEngine`,
  `headlessReport`, the definition validator, `stableDigest`;
- `tradrl-world-sim/generator` (W017) — `createGeneratedWorldEngine` (a
  definition that declares a `regimeSchedule` runs the generated market);
- `tradrl-world-sim/journal` (W013/W016) — records + restore;
- `tradrl-data` (W020) + `tradrl-information` (W027) — the `datasets` section.

## Usage

```
tradrl-world run --definition <file.json> [--script <commands.json>]
                 [--report <out.json>] [--journal <out.jsonl>]
tradrl-world replay --journal <file.jsonl> [--definition <file.json>]
                    [--script <commands.json>] [--report <out.json>]
tradrl-world help | --help
```

`run` prints the run report to stdout as JSON: the engine kind
(`generated` when the definition declares a `regimeSchedule`, `headless`
otherwise), the definition digest, the dataset-import evidence, the
per-entry script outcomes, the W013 headless report (balances, positions,
P&L, risk, event count, journal digest, branch lineage), the determinism
manifest and the whole-report `reportDigest` (the A9 claim: the same
definition + script ⇒ the same digest — proven by two independent runs in
the tests, in-process AND across two real processes through the bin).

`--journal` writes the replayable journal (JSONL): a first-line header
(embedding the engine definition + definition digest + dataset evidence,
self-contained) followed by one `JournalRecord` per line.

`replay` rebuilds the engine from the records (full deterministic replay —
the `restore.journal` genesis; snapshot payloads referenced by
`world.snapshot.created` records are rebuilt by the engine fold) and drives
the optional continuation script. The journal header makes the file
self-contained; a bare records file requires `--definition`. When both
exist they are compared canonically — a replay must reproduce the recorded
run's definition and dataset imports exactly (`definition-mismatch`
otherwise).

Exit codes: `0` success — typed command/clock rejections inside the script
are honest deterministic OUTCOMES recorded per entry, not failures;
`1` usage error; `2` invalid input (files, JSON, schema, dataset imports,
mismatches); `3` engine failure (an invariant violation).

Errors print to stderr: one human line (`tradrl-world: <code>: <message>`)
plus the JSON error value with the complete violation list where
applicable. Nothing is ever silently dropped.

## Input files

**Definition file** — the `WorldDefinition` JSON (see
`packages/tradrl-world-sim/world/definition.ts`) plus one CLI-owned
optional section:

```jsonc
{
  // ...the WorldDefinition fields verbatim...
  "datasets": [
    { "id": "news-1", "kind": "information", "path": "news-dataset.json" },
    { "id": "bars-1", "kind": "historical", "path": "bars.json" }
  ]
}
```

Validation is loud: unknown top-level keys are rejected (a typo must never
silently change the definition digest), the engine's own validator collects
every definition violation, and regime-schedule parameters must be
string→number records. Dataset paths resolve against the definition file's
directory.

Dataset files carry `{ descriptor, records, symbolMap }` (historical, W020)
or `{ descriptor, records, sources, symbolMap }` (information, W027) — the
loaders' own validators reject invalid imports with the complete violation
list. Honesty law: both loaders produce JOURNAL-READY events, but
engine-level replay of imported events is the W021 adapter surface —
information artifacts are merged into the definition (the only imported
facts that enter the engine's world, behind the A7 firewall), and every
import is reported as `journalReadyOnly: true` evidence (never claimed as
appended).

**Script file** — a JSON array of ordered entries, each with an explicit
`id` and exactly one driver:

```jsonc
[
  { "id": "step-1", "clock": { "op": "step", "deltaMs": 10000 } },
  { "id": "seek-1", "clock": { "op": "seek", "to": 1700044830000 } },
  { "id": "buy-1", "command": {
      "kind": "submit-order",
      "commandId": "cmd-buy-1",           // explicit ids are required
      "issuedBy": "participant-trader",
      "accountId": "account-trader",
      "instrumentId": "instrument-btcusd",
      "submission": { "kind": "market", "side": "buy", "quantity": "0.25",
                      "constraints": { "timeInForce": "IOC" } } } }
]
```

Clock ops: `step` (optional `deltaMs`), `seek`, `pause`, `play`,
`set-speed`, `follow-realtime`, `jump-to-event`. Command kinds: every
W003 `WorldCommand` (`submit-order`, `cancel-order`, `replace-order`,
`close-position`, `add-annotation`, `create-snapshot`, `branch-world`,
`set-scenario`). Envelope fills: `worldId` may be omitted (targets this
world; a mismatched value fails at load) and `issuedAt` may be omitted
(stamped with the CURRENT SIMULATION TIME at execution — deterministic, so
the command-stream hash is a pure function of definition + script).

## Layout

- `bin/tradrl-world.mjs` — the node bootstrap (resolves the repo's tsx
  loader; typed bootstrap errors otherwise);
- `src/args.ts` — argv parsing + usage; `src/errors.ts` — the typed error
  taxonomy + exit classes; `src/jsonFile.ts` — typed JSON file reading;
- `src/definitionFile.ts`, `src/scriptFile.ts`, `src/datasets.ts` — the
  input surfaces (loud validation);
- `src/runner.ts` — engine selection, script driving, the run report;
- `src/journalFile.ts` — the run↔replay journal format;
- `src/replay.ts` — restore + continuation; `src/cli.ts` (testable
  `main`) + `src/entry.ts` (the bin entry);
- `test/` — node:test suites: validation laws, runner/replay behavior, THE
  A9 determinism golden (two independent runs in-process and across two
  real processes; run↔replay continuation equivalence), and the spawn
  end-to-end.

## Environment note (worktree)

The app is TypeScript-source-exported (the `tradrl-world-sim` package
convention). Until the TL registers it in `pnpm-workspace.yaml` + the
lockfile (a TL action item), the worktree uses untracked package-local
`node_modules` copies of the four workspace dependencies (the
tradrl-information pattern); the imports are plain package specifiers, so
real workspace links replace the copies with zero source changes.
