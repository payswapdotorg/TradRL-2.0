/**
 * The CLI-invocation plumbing of the e2e replay verification (W022 internal):
 * drives the REAL `tradrl-world-cli` `main(argv)` IN-PROCESS (the W021-tested
 * seam — exactly what the CLI's own runner tests drive), capturing stdout/
 * stderr so the printed-report contract is itself verifiable evidence.
 *
 * Stdout capture: `main` prints the report JSON to stdout; the harness swaps
 * `process.stdout.write`/`process.stderr.write` for the duration of ONE
 * awaited call (node:test runs files sequentially — no interleaving), then
 * restores them. The capture is disclosed plumbing, not behavior.
 *
 * Everything here is deterministic fixture data + IO; the VERDICTS live in
 * `./e2eReplay.ts` as pure functions over the captured observations.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "tradrl-world-cli";
import { MINUTE_MS, T0_MS } from "./fixtures.js";

/** One captured CLI invocation (the process streams + exit code). */
export interface CapturedInvocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `main(argv)` with stdout/stderr captured (restored on completion). */
export async function runCliMain(argv: readonly string[]): Promise<CapturedInvocation> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const exitCode = await main([...argv]);
    return { exitCode, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

/** A fresh temp dir for one e2e fixture set. */
export async function e2eDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Write one JSON fixture; returns its path. */
export async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

/** A deterministic limit-buy command for the e2e scripts. */
function buyLimit(commandId: string, limitPrice: string): Record<string, unknown> {
  return {
    kind: "submit-order",
    commandId,
    issuedBy: "participant-trader",
    accountId: "account-trader",
    instrumentId: "instrument-btcusdt",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "0.5",
      limitPrice,
      constraints: { timeInForce: "GTC" },
    },
  };
}

/**
 * The e2e world definition (the W031 plain-world shape): one instrument the
 * dataset's symbol map targets, one trading account + participant, a fixed
 * clock window, and the `datasets` declaration that runs the Nautilus
 * dataset through the W020 loader inside the CLI run.
 */
export function e2eDefinition(worldId: string, datasetFile: string): Record<string, unknown> {
  return {
    scope: { tenantId: "tenant-w022", projectId: "project-w022", worldId },
    mode: "reactive-replay",
    seed: "w022-e2e-seed",
    worldDefinitionVersion: "w022-e2e-def@1",
    inputDataSource: "nautilus-fixture://w022-verification",
    clock: {
      start: T0_MS,
      end: T0_MS + 10 * MINUTE_MS,
      defaultStepMs: 1000,
      initialWallTime: T0_MS + 500_000,
    },
    instruments: [
      {
        instrumentId: "instrument-btcusdt",
        worldId,
        venueId: "venue-w022",
        symbol: "BTCUSDT-BINANCE",
        assetClass: "crypto",
        quoteCurrency: "USDT",
        tickSize: "0.1",
        lotSize: "0.0001",
        pricePrecision: 1,
        quantityPrecision: 4,
        tradingState: "open",
        tradable: true,
      },
    ],
    accounts: [
      {
        accountId: "account-trader",
        worldId,
        balances: { USDT: { amount: "100000.00", currency: "USDT" } },
        buyingPower: { amount: "100000.00", currency: "USDT" },
        marginUsed: { amount: "0.00", currency: "USDT" },
        marginAvailable: { amount: "100000.00", currency: "USDT" },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
    ],
    participants: [
      { participantId: "participant-trader", worldId, kind: "human", accountId: "account-trader" },
    ],
    datasets: [{ id: "nautilus-bars-e2e", kind: "historical", path: datasetFile }],
  };
}

/** How many leading entries of the full script make up the prefix run. */
export const E2E_PREFIX_ENTRIES = 4;

/** The full e2e script: clock steps, orders, one mid-run snapshot. */
export function e2eFullScript(): unknown[] {
  return [
    { id: "step-1", clock: { op: "step", deltaMs: 5000 } },
    { id: "buy-1", command: buyLimit("cmd-e2e-buy-1", "48000.10") },
    { id: "seek-1", clock: { op: "seek", to: T0_MS + 10_000 } },
    {
      id: "snapshot-1",
      command: {
        kind: "create-snapshot",
        commandId: "cmd-e2e-snap-1",
        issuedBy: "participant-trader",
        label: "w022-e2e-snapshot",
      },
    },
    { id: "step-2", clock: { op: "step", deltaMs: 5000 } },
    { id: "buy-2", command: buyLimit("cmd-e2e-buy-2", "47999.90") },
  ];
}

/** The prefix script (first E2E_PREFIX_ENTRIES entries — ends with the snapshot). */
export function e2ePrefixScript(): unknown[] {
  return e2eFullScript().slice(0, E2E_PREFIX_ENTRIES);
}

/** The continuation script (the remaining entries — driven after the replay). */
export function e2eContinuationScript(): unknown[] {
  return e2eFullScript().slice(E2E_PREFIX_ENTRIES);
}
