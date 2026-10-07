/**
 * W019 determinism pins — the shared IDENTITY of the golden journey's
 * deterministic output (suite helper, not a test file).
 *
 * ONE source of truth for the journal-level identity of the frozen golden
 * journey (`./goldenJourney.helpers.ts`):
 * - `goldenJourney.test.ts` pins these same values observed under the
 *   transport's DEFAULT wall axis (the real host clock);
 * - `determinismGolden.test.ts` runs the journey under a FIXED wall axis
 *   (T1) and pins the SAME values;
 * - `determinismGoldenWallTwin.test.ts` runs it under T1 + one day and
 *   pins the SAME values again.
 *
 * Digest(T_host) = P ∧ Digest(T1) = P ∧ Digest(T1 + 1d) = P ⇒ the three
 * wall axes produce IDENTICAL journals + manifests — that transitive
 * equality through the pins IS the A9 wall-invariance law at the
 * integration level (the W017-golden methodology). Every value below was
 * OBSERVED on the frozen stream; they are golden output, not expectations.
 */

/** The golden journey's journal size (every generated + commanded event). */
export const PINNED_EVENT_COUNT = 96_209;

/** THE journal digest of the golden journey (headless report eventHash). */
export const PINNED_EVENT_HASH = "25b9f583";

/** The determinism manifest's world-definition input hash. */
export const PINNED_WORLD_DEFINITION_HASH = "723295ff";

/** The determinism manifest's lineage input hash. */
export const PINNED_LINEAGE_HASH = "741638a5";

/** The determinism manifest's command-stream identity hash. */
export const PINNED_COMMAND_STREAM_HASH = "1ed6c7d8:54129";

/** Headless-report balances (trader, mm cast, synth cast), exact strings. */
export const PINNED_BALANCES: readonly string[] = [
  "99964.0799",
  "93368.9922",
  "83819.986375",
];

/** Published-projection batches the journey's push channel settled. */
export const PINNED_PUBLISHED_BATCHES = 45_416;

/** Clock views the journey's push channel settled (one per acked clock op). */
export const PINNED_CLOCK_VIEWS = 15;

/** A7-filtered evidence/timeline reads at the journey's end state. */
export const PINNED_EVIDENCE_EVENTS = 96_203;

/** Latent (firewalled) events at the journey's end state. */
export const PINNED_HIDDEN_EVENTS = 6;

/** The final clock view of the journey (paused, 2×, at +120.5166… min). */
export const PINNED_FINAL_CLOCK = {
  simulationTime: 1_700_007_231_000,
  status: "paused",
  speed: 2,
  followingRealtime: false,
} as const;

/** Exact financial figures the determinism runs re-observe mid-journey. */
export const PINNED_FINANCIALS = {
  /** S10 (+610s): the maker sell filled at 4801.75 (fee 1.06035, realized +1.5). */
  s10Cash: "99965.1379",
  s10Equity: "99960.1379",
  /** S11 (+32 min): the deep maker buy filled at 4790 (fee 1.058). */
  s11Cash: "99964.0799",
  s11AverageEntryPrice: "4799.517857142857",
  s11UnrealizedPnl: "-406.249999999998",
  /** S14 (the closing mean-reversion window). */
  s14UnrealizedPnl: "-10584.249999999998",
  /** The end state (mark 4043.25 on 14 lots). */
  endCash: "99964.0799",
  endEquity: "89377.829900000002",
  endUnrealizedPnl: "-10587.749999999998",
  endTotalPnl: "-10586.249999999998",
} as const;
