/**
 * Tests for the provider-descriptor laws (W026): structural validation (the
 * honesty laws — no live-fetch claims, non-empty symbol tables, unique
 * well-formed feeds), and the fixture-provenance meta-test that mechanically
 * enforces the work order's labeling requirement (every fixture labeled
 * with the doc source and snapshot date it transcribes).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { binanceSpotProvider } from "../binance.js";
import { coinbaseExchangeProvider } from "../coinbase.js";
import { feedOf, validateCryptoProvider } from "../providers.js";
import type { CryptoProviderDescriptor } from "../providers.js";
import {
  ALL_FIXTURES,
  BINANCE_SYMBOLS,
  COINBASE_SYMBOLS,
} from "./fixtures.js";

const binance = binanceSpotProvider(BINANCE_SYMBOLS);
const coinbase = coinbaseExchangeProvider(COINBASE_SYMBOLS);

/** A structurally broken variant of a valid provider (spread + override). */
function variant(
  provider: CryptoProviderDescriptor,
  overrides: Partial<CryptoProviderDescriptor>,
): CryptoProviderDescriptor {
  return { ...provider, ...overrides };
}

test("both baseline providers are structurally valid", () => {
  assert.deepEqual(validateCryptoProvider(binance), []);
  assert.deepEqual(validateCryptoProvider(coinbase), []);
});

test("blank identity/docs fields are invalid-provider violations", () => {
  assert.equal(validateCryptoProvider(variant(binance, { providerId: " " })).length > 0, true);
  assert.equal(validateCryptoProvider(variant(binance, { exchange: "" })).length > 0, true);
  assert.equal(
    validateCryptoProvider(
      variant(binance, { docs: { ...binance.docs, shapeSnapshotDate: "" } }),
    ).length > 0,
    true,
  );
});

test("an empty symbol table is invalid (a provider maps SOMETHING or is not a provider)", () => {
  const result = validateCryptoProvider(variant(binance, { symbols: {} }));
  assert.equal(result.length > 0, true);
  assert.match(result[0]?.detail ?? "", /at least one exchange symbol/);
});

test("blank instruments in the symbol table are invalid", () => {
  const result = validateCryptoProvider(
    variant(binance, { symbols: { BTCUSDT: "" as never } }),
  );
  assert.equal(result.length > 0, true);
});

test("duplicate feed ids are invalid", () => {
  const duplicated = variant(binance, {
    feeds: [...binance.feeds, binance.feeds[0]!],
  });
  const result = validateCryptoProvider(duplicated);
  assert.equal(
    result.some((violation) => /duplicate feed id/.test(violation.detail)),
    true,
  );
});

test("an empty feed list or malformed feed fields are invalid", () => {
  assert.equal(validateCryptoProvider(variant(binance, { feeds: [] })).length > 0, true);
  const badOrder = variant(binance, {
    feeds: [
      ...binance.feeds.slice(1),
      { ...binance.feeds[0]!, recordOrder: "random" as never },
    ],
  });
  assert.equal(validateCryptoProvider(badOrder).length > 0, true);
});

test("a live-fetch polling claim is INVALID — the baseline performs no network IO (honesty law)", () => {
  const result = validateCryptoProvider(
    variant(binance, {
      polling: { ...binance.polling, liveFetch: "implemented" as never },
    }),
  );
  assert.equal(result.length > 0, true);
  assert.match(result[0]?.detail ?? "", /no network IO/);
});

test("malformed fidelity declarations are invalid", () => {
  const result = validateCryptoProvider(
    variant(binance, { fidelity: { ...binance.fidelity, knownGaps: [""] } }),
  );
  assert.equal(result.length > 0, true);
  assert.equal(validateCryptoProvider(variant(binance, { fidelity: { ...binance.fidelity, gives: [] } })).length > 0, true);
});

test("feedOf resolves declared feeds and nothing else", () => {
  assert.equal(feedOf(binance, "binance.klines")?.feedId, "binance.klines");
  assert.equal(feedOf(binance, "coinbase.candles"), undefined);
  assert.equal(feedOf(coinbase, "coinbase.ticker")?.outputKind, "quote");
});

test("META: every fixture is labeled with endpoint, doc source and snapshot date", () => {
  assert.ok(ALL_FIXTURES.length >= 7, "fixture inventory unexpectedly small");
  for (const fixture of ALL_FIXTURES) {
    const label = fixture.provenance;
    assert.ok(label.feedId.trim().length > 0, "fixture feedId must be non-blank");
    assert.ok(label.endpoint.trim().length > 0, `${label.feedId}: endpoint must be non-blank`);
    assert.ok(label.docSource.trim().length > 0, `${label.feedId}: docSource must be non-blank`);
    assert.match(
      label.shapeSnapshotDate,
      /^\d{4}-\d{2}-\d{2}$/,
      `${label.feedId}: snapshot date must be ISO YYYY-MM-DD`,
    );
    assert.match(label.note, /not a live capture/, `${label.feedId}: note must be honest`);
    assert.notEqual(fixture.payload, undefined, `${label.feedId}: payload must exist`);
  }
});

test("META: fixture labels pin the SAME doc source and snapshot date the providers declare", () => {
  const providersByPrefix: readonly [string, CryptoProviderDescriptor][] = [
    ["binance.", binance],
    ["coinbase.", coinbase],
  ];
  for (const fixture of ALL_FIXTURES) {
    const entry = providersByPrefix.find(([prefix]) =>
      fixture.provenance.feedId.startsWith(prefix),
    );
    assert.ok(entry !== undefined, `no provider owns feed '${fixture.provenance.feedId}'`);
    const providerDescriptor = entry[1];
    assert.ok(
      providerDescriptor.docs.source.startsWith(fixture.provenance.docSource),
      `${fixture.provenance.feedId}: fixture docSource must match the provider's declared source`,
    );
    assert.equal(
      providerDescriptor.docs.shapeSnapshotDate,
      fixture.provenance.shapeSnapshotDate,
      `${fixture.provenance.feedId}: snapshot dates must agree`,
    );
    const feed = feedOf(providerDescriptor, fixture.provenance.feedId);
    assert.ok(feed !== undefined, `provider must declare the fixture's feed`);
    // The fixture documents the concrete REQUEST; the feed declares the
    // endpoint TEMPLATE — the fixture route must match the template's
    // static path (up to the first path parameter) and query marker.
    const staticPath = feed.endpoint.split("?")[0]!.split("<")[0]!;
    assert.ok(
      fixture.provenance.endpoint.split("?")[0]!.startsWith(staticPath),
      `${fixture.provenance.feedId}: fixture route '${fixture.provenance.endpoint.split("?")[0]}' ` +
        `must match the declared route template '${staticPath}…'`,
    );
  }
});

test("META: the mapper registry covers every mappable declared feed of both providers", async () => {
  const { mapCryptoRecord } = await import("../mapping.js");
  for (const providerDescriptor of [binance, coinbase]) {
    for (const feed of providerDescriptor.feeds) {
      const result = mapCryptoRecord(providerDescriptor, feed.feedId, {}, {});
      if (feed.outputKind === "unmappable") {
        assert.ok(!result.ok);
        assert.equal(result.violations[0]?.kind, "unmappable-feed");
      } else {
        // A mappable feed must reach the record mapper (record-level
        // violations, not feed-level "unsupported-feed").
        assert.ok(!result.ok);
        assert.notEqual(result.violations[0]?.kind, "unsupported-feed");
      }
    }
  }
  const unknown = mapCryptoRecord(binance, "binance.depth", {}, {});
  assert.ok(!unknown.ok);
  assert.equal(unknown.violations[0]?.kind, "unsupported-feed");
});
