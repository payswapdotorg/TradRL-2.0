/**
 * The observed-view firewall and digest (W033): the substrate's ONLY input,
 * validated fail-closed, addressed once.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — a substrate physically cannot see
 * beyond the view grant. Two mechanisms make this true: the TYPE (the only
 * input is `ObservedBodyView` — there is no port, no world handle, no
 * clock) and THIS validator — content beyond the grant is a typed error,
 * never silently seen:
 * - a content family may be present only when its observation kind is
 *   admitted by the view (`observation-kind-not-in-view`);
 * - market content may only carry instruments inside the view
 *   (`instrument-not-in-view`);
 * - own-state may only be the view's own account/world (`account-mismatch`
 *   / `world-mismatch`);
 * - every timestamp in the content must be ≤ the view's `asOf`
 *   (`future-dated-content` — no future data ever);
 * - artifacts must be available at `asOf` (the canonical A7 predicate
 *   `isInformationAvailable`, reused — never re-derived;
 *   `artifact-not-available`);
 * - decimal values must be canonical decimal text (`malformed-decimal`);
 * - one projection per instrument/id (`duplicate-projection`).
 *
 * `viewDigestOf` addresses the WHOLE observed view with the W016 hashing
 * family (`stableDigest`: canonical JSON + FNV-1a) — the same family the
 * engine and the W028 evidence chain use, so a decision's citation commits
 * to everything its substrate saw (bit-identical across runs, A9).
 */

import { isInformationAvailable } from "tradrl-world-contracts";
import type { ObservedBodyView, SubstrateError, ViewDigest } from "./contracts.js";
import { stableDigest } from "tradrl-world-sim/world";
import { isCanonicalDecimal } from "tradrl-world-sim/orderbook";
import { isCanonicalSignedDecimal } from "./decimal.js";

function error(code: SubstrateError["code"], message: string, field?: string): SubstrateError {
  return field === undefined ? { code, message } : { code, message, field };
}

/** The content-family → observation-kind table (the closed-set law). */
const FAMILY_KIND = {
  quotes: "market-quote",
  books: "market-book",
  trades: "market-trades",
  ownOrders: "own-orders",
  ownPositions: "own-positions",
  portfolio: "own-portfolio",
  riskState: "own-risk",
  artifacts: "information-artifacts",
} as const;

type ContentFamily = keyof typeof FAMILY_KIND;

function checkDecimal(
  errors: SubstrateError[],
  at: string,
  value: string | undefined,
  signed: boolean,
): void {
  if (value === undefined) {
    return;
  }
  const ok = signed ? isCanonicalSignedDecimal(value) : isCanonicalDecimal(value);
  if (!ok) {
    errors.push(
      error("malformed-decimal", `${at} must be canonical decimal text (got '${String(value)}')`, at),
    );
  }
}

function checkMoney(
  errors: SubstrateError[],
  at: string,
  money: { readonly amount: string } | undefined,
): void {
  if (money === undefined) {
    return;
  }
  checkDecimal(errors, `${at}.amount`, money.amount, true);
}

/** The kind/instrument/account/world grant check shared by every family. */
function checkFamilyPresence(
  view: ObservedBodyView,
  family: ContentFamily,
  errors: SubstrateError[],
): boolean {
  const kind = FAMILY_KIND[family];
  if (!view.observations.includes(kind)) {
    errors.push(
      error(
        "observation-kind-not-in-view",
        `'${family}' content is present but the observation kind '${kind}' is not admitted by this view`,
        family,
      ),
    );
    return false;
  }
  return true;
}

function checkInstrument(view: ObservedBodyView, instrumentId: string, at: string, errors: SubstrateError[]): void {
  if (!view.instruments.includes(instrumentId as never)) {
    errors.push(
      error(
        "instrument-not-in-view",
        `${at} carries instrument ${instrumentId}, which is outside this view's instruments`,
        at,
      ),
    );
  }
}

function checkTimestamp(errors: SubstrateError[], at: string, value: number, asOf: number, finiteAsOf: boolean): void {
  if (finiteAsOf && value > asOf) {
    errors.push(
      error("future-dated-content", `${at} (${String(value)}) is after the view's asOf (${String(asOf)}) — no future data`, at),
    );
  }
}

/**
 * Validate one observed view against its own grant (fail-closed): all
 * violations are collected loudly; the outcome is ok only when the view is
 * exactly what it claims to be.
 */
export function validateObservedView(view: ObservedBodyView): { readonly ok: true } | { readonly ok: false; readonly errors: readonly SubstrateError[] } {
  const errors: SubstrateError[] = [];
  const finiteAsOf = Number.isFinite(view.asOf);
  if (!finiteAsOf) {
    errors.push(
      error("non-finite-as-of", "asOf must be a finite simulation time — the substrate refuses a broken time axis (fail-closed)", "asOf"),
    );
  }

  const seenQuoteInstruments = new Set<string>();
  for (const [index, quote] of (view.quotes ?? []).entries()) {
    const at = `quotes[${String(index)}]`;
    if (seenQuoteInstruments.has(String(quote.instrumentId))) {
      errors.push(error("duplicate-projection", `${at} repeats the quote projection for ${String(quote.instrumentId)}`, at));
    }
    seenQuoteInstruments.add(String(quote.instrumentId));
    checkInstrument(view, String(quote.instrumentId), at, errors);
    checkTimestamp(errors, `${at}.asOf`, quote.asOf, view.asOf, finiteAsOf);
    checkDecimal(errors, `${at}.bid`, quote.bid, false);
    checkDecimal(errors, `${at}.ask`, quote.ask, false);
    checkDecimal(errors, `${at}.last`, quote.last, false);
    checkDecimal(errors, `${at}.bidSize`, quote.bidSize, false);
    checkDecimal(errors, `${at}.askSize`, quote.askSize, false);
  }
  if (view.quotes !== undefined && view.quotes.length > 0) {
    checkFamilyPresence(view, "quotes", errors);
  }

  const seenBookInstruments = new Set<string>();
  for (const [index, book] of (view.books ?? []).entries()) {
    const at = `books[${String(index)}]`;
    if (seenBookInstruments.has(String(book.instrumentId))) {
      errors.push(error("duplicate-projection", `${at} repeats the book projection for ${String(book.instrumentId)}`, at));
    }
    seenBookInstruments.add(String(book.instrumentId));
    checkInstrument(view, String(book.instrumentId), at, errors);
    checkTimestamp(errors, `${at}.asOf`, book.asOf, view.asOf, finiteAsOf);
    if (!Number.isFinite(book.sequence)) {
      errors.push(error("malformed-decimal", `${at}.sequence must be a finite number (got '${String(book.sequence)}')`, `${at}.sequence`));
    }
    for (const [levelIndex, level] of book.bids.entries()) {
      checkDecimal(errors, `${at}.bids[${String(levelIndex)}].price`, level.price, false);
      checkDecimal(errors, `${at}.bids[${String(levelIndex)}].quantity`, level.quantity, false);
    }
    for (const [levelIndex, level] of book.asks.entries()) {
      checkDecimal(errors, `${at}.asks[${String(levelIndex)}].price`, level.price, false);
      checkDecimal(errors, `${at}.asks[${String(levelIndex)}].quantity`, level.quantity, false);
    }
  }
  if (view.books !== undefined && view.books.length > 0) {
    checkFamilyPresence(view, "books", errors);
  }

  for (const [index, trade] of (view.trades ?? []).entries()) {
    const at = `trades[${String(index)}]`;
    checkInstrument(view, String(trade.instrumentId), at, errors);
    checkTimestamp(errors, `${at}.occurredAt`, trade.occurredAt, view.asOf, finiteAsOf);
    checkDecimal(errors, `${at}.price`, trade.price, false);
    checkDecimal(errors, `${at}.quantity`, trade.quantity, false);
  }
  if (view.trades !== undefined && view.trades.length > 0) {
    checkFamilyPresence(view, "trades", errors);
  }

  for (const [index, order] of (view.ownOrders ?? []).entries()) {
    const at = `ownOrders[${String(index)}]`;
    if (String(order.accountId) !== String(view.accountId)) {
      errors.push(error("account-mismatch", `${at} targets account ${String(order.accountId)}, not the view's own ${String(view.accountId)}`, at));
    }
    if (String(order.worldId) !== String(view.worldId)) {
      errors.push(error("world-mismatch", `${at} belongs to world ${String(order.worldId)}, not the view's ${String(view.worldId)}`, at));
    }
    checkTimestamp(errors, `${at}.submittedAt`, order.submittedAt, view.asOf, finiteAsOf);
    if (order.updatedAt !== undefined) {
      checkTimestamp(errors, `${at}.updatedAt`, order.updatedAt, view.asOf, finiteAsOf);
    }
    checkDecimal(errors, `${at}.quantity`, order.quantity, false);
    checkDecimal(errors, `${at}.filledQuantity`, order.filledQuantity, false);
    checkDecimal(errors, `${at}.limitPrice`, order.limitPrice, false);
    checkDecimal(errors, `${at}.stopPrice`, order.stopPrice, false);
  }
  if (view.ownOrders !== undefined && view.ownOrders.length > 0) {
    checkFamilyPresence(view, "ownOrders", errors);
  }

  for (const [index, position] of (view.ownPositions ?? []).entries()) {
    const at = `ownPositions[${String(index)}]`;
    if (String(position.accountId) !== String(view.accountId)) {
      errors.push(error("account-mismatch", `${at} targets account ${String(position.accountId)}, not the view's own ${String(view.accountId)}`, at));
    }
    if (String(position.worldId) !== String(view.worldId)) {
      errors.push(error("world-mismatch", `${at} belongs to world ${String(position.worldId)}, not the view's ${String(view.worldId)}`, at));
    }
    checkTimestamp(errors, `${at}.updatedAt`, position.updatedAt, view.asOf, finiteAsOf);
    checkDecimal(errors, `${at}.quantity`, position.quantity, true);
    checkDecimal(errors, `${at}.averageEntryPrice`, position.averageEntryPrice, false);
    checkDecimal(errors, `${at}.markPrice`, position.markPrice, false);
    checkMoney(errors, `${at}.realizedPnl`, position.realizedPnl);
    checkMoney(errors, `${at}.unrealizedPnl`, position.unrealizedPnl);
  }
  if (view.ownPositions !== undefined && view.ownPositions.length > 0) {
    checkFamilyPresence(view, "ownPositions", errors);
  }

  if (view.portfolio !== undefined) {
    const at = "portfolio";
    if (String(view.portfolio.accountId) !== String(view.accountId)) {
      errors.push(error("account-mismatch", `${at} targets account ${String(view.portfolio.accountId)}, not the view's own ${String(view.accountId)}`, at));
    }
    if (String(view.portfolio.worldId) !== String(view.worldId)) {
      errors.push(error("world-mismatch", `${at} belongs to world ${String(view.portfolio.worldId)}, not the view's ${String(view.worldId)}`, at));
    }
    checkTimestamp(errors, `${at}.asOf`, view.portfolio.asOf, view.asOf, finiteAsOf);
    checkMoney(errors, `${at}.cash`, view.portfolio.cash);
    checkMoney(errors, `${at}.buyingPower`, view.portfolio.buyingPower);
    checkMoney(errors, `${at}.realizedPnl`, view.portfolio.realizedPnl);
    checkMoney(errors, `${at}.unrealizedPnl`, view.portfolio.unrealizedPnl);
    checkMoney(errors, `${at}.equity`, view.portfolio.equity);
  }

  if (view.riskState !== undefined) {
    const at = "riskState";
    if (String(view.riskState.accountId) !== String(view.accountId)) {
      errors.push(error("account-mismatch", `${at} targets account ${String(view.riskState.accountId)}, not the view's own ${String(view.accountId)}`, at));
    }
    if (String(view.riskState.worldId) !== String(view.worldId)) {
      errors.push(error("world-mismatch", `${at} belongs to world ${String(view.riskState.worldId)}, not the view's ${String(view.worldId)}`, at));
    }
    checkTimestamp(errors, `${at}.asOf`, view.riskState.asOf, view.asOf, finiteAsOf);
    checkDecimal(errors, `${at}.limits.maxOrderQuantity`, view.riskState.limits.maxOrderQuantity, false);
    checkDecimal(errors, `${at}.limits.maxPositionQuantity`, view.riskState.limits.maxPositionQuantity, false);
    if (view.riskState.limits.maxLeverage !== undefined && !Number.isFinite(view.riskState.limits.maxLeverage)) {
      errors.push(error("malformed-decimal", `${at}.limits.maxLeverage must be finite when present (got '${String(view.riskState.limits.maxLeverage)}')`, `${at}.limits.maxLeverage`));
    }
    checkMoney(errors, `${at}.limits.maxGrossExposure`, view.riskState.limits.maxGrossExposure);
    checkMoney(errors, `${at}.limits.maxDrawdown`, view.riskState.limits.maxDrawdown);
    checkMoney(errors, `${at}.limits.minBuyingPowerAfterOrder`, view.riskState.limits.minBuyingPowerAfterOrder);
    for (const [index, breach] of view.riskState.breaches.entries()) {
      checkTimestamp(errors, `${at}.breaches[${String(index)}].occurredAt`, breach.occurredAt, view.asOf, finiteAsOf);
    }
  }

  const seenArtifacts = new Set<string>();
  for (const [index, artifact] of (view.artifacts ?? []).entries()) {
    const at = `artifacts[${String(index)}]`;
    if (seenArtifacts.has(String(artifact.artifactId))) {
      errors.push(error("duplicate-projection", `${at} repeats artifact ${String(artifact.artifactId)}`, at));
    }
    seenArtifacts.add(String(artifact.artifactId));
    if (String(artifact.worldId) !== String(view.worldId)) {
      errors.push(error("world-mismatch", `${at} belongs to world ${String(artifact.worldId)}, not the view's ${String(view.worldId)}`, at));
    }
    if (!isInformationAvailable(artifact, view.asOf)) {
      errors.push(
        error("artifact-not-available", `${at} (${String(artifact.artifactId)}) is not available at asOf ${String(view.asOf)} — the A7 firewall refuses it (fail-closed)`, at),
      );
    }
  }
  if (view.artifacts !== undefined && view.artifacts.length > 0) {
    checkFamilyPresence(view, "artifacts", errors);
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * The content digest of one observed view — the citation every decision
 * from it carries (the W028 chain discipline: the digest commits to the
 * WHOLE observation, canonical key order, bit-identical across runs).
 */
export function viewDigestOf(view: ObservedBodyView): ViewDigest {
  return stableDigest(view) as ViewDigest;
}
