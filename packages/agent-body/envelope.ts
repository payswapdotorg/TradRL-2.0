/**
 * The Body risk-envelope laws (W032): shape validation, the exact
 * envelope-vs-world-limits comparison, and the effective-envelope
 * intersection.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — the envelope is a DECLARATION in
 * the W003 `RiskLimits` shape; the W015 runtime gate enforces limits, and
 * a Body whose declared envelope EXCEEDS its world's declared limits is
 * INVALID AT ATTACH — never silently clipped (a rejected attach is the
 * loud, typed outcome).
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — limit comparisons
 * happen on exact scaled integers; the only float a `Ratio` limit ever
 * crosses is its own declaration, normalized once to the W015 12-digit
 * fixed point (reused from `tradrl-world-sim/risk`, never re-derived
 * here).
 * Spec: spec/REQUIREMENTS.md R050/R024 — authority is runtime control,
 * never prompt text; the Body declares, the gate enforces.
 *
 * Comparison law (per `RiskLimits` field, both declared):
 * - `maxOrderQuantity`, `maxPositionQuantity`, `maxLeverage`,
 *   `maxGrossExposure`, `maxDrawdown`: the Body's declaration must be ≤
 *   the world's (a Body may always be tighter than its world).
 * - `minBuyingPowerAfterOrder` is a FLOOR: the Body's floor must be ≥ the
 *   world's (a Body that would leave LESS buying power than the world
 *   demands is the loose/invalid side).
 * - Where the world does not declare a limit, the W003 law applies ("unset
 *   limits are not enforced") — any Body declaration is valid, and where
 *   the Body declares none there is nothing to compare.
 */

import type { Money, RiskLimits } from "tradrl-world-contracts";
import type { BodyValidationError, RiskLimitField } from "./contracts.js";
import { isCanonicalDecimal, parseScaled } from "tradrl-world-sim/orderbook";
import { ratioToScaled, validateRiskLimits } from "tradrl-world-sim/risk";

/** The decimal-string limit fields (quantity limits). */
const DECIMAL_FIELDS = ["maxOrderQuantity", "maxPositionQuantity"] as const;

/** The Money limit fields (exposure, drawdown, buying-power floor). */
const MONEY_FIELDS = [
  "maxGrossExposure",
  "maxDrawdown",
  "minBuyingPowerAfterOrder",
] as const;

function shapeError(field: string, message: string): BodyValidationError {
  return { code: "invalid-limit-shape", field, message };
}

/**
 * Structural validation of the declared envelope. Reuses the W015
 * risk-limits structural law (fail fast, exact field rules) and adds the
 * contract-boundary law the loose W015 Money shape does not pin: every
 * declared decimal value must be CANONICAL decimal text (exponent forms
 * pass the W015 numeric checks but are not contract-boundary values), and
 * a leverage ratio must be finite (Infinity passes the W015 `> 0` check
 * but is not a declarable limit).
 *
 * The canonical checks run only on values the W015 shape already accepts —
 * a value W015 rejected is reported once, by W015 (never double-reported).
 */
export function validateRiskEnvelopeShape(
  envelope: RiskLimits,
  at: string,
): readonly BodyValidationError[] {
  const errors: BodyValidationError[] = validateRiskLimits(envelope, at).map(
    (message) => shapeError(at, message),
  );
  for (const field of DECIMAL_FIELDS) {
    const value: string | undefined = envelope[field];
    if (value === undefined || !(Number(value) > 0)) {
      // rejected (or absent) by the W015 law — reported once, by W015
      continue;
    }
    if (!isCanonicalDecimal(value)) {
      errors.push(
        shapeError(
          `${at}.${field}`,
          `${at}.${field} must be canonical decimal text when present (got '${String(value)}')`,
        ),
      );
    }
  }
  for (const field of MONEY_FIELDS) {
    const money: Money | undefined = envelope[field];
    if (money === undefined || Number(money.amount) < 0) {
      continue;
    }
    if (!isCanonicalDecimal(money.amount)) {
      errors.push(
        shapeError(
          `${at}.${field}.amount`,
          `${at}.${field}.amount must be canonical decimal text when present (got '${String(money.amount)}')`,
        ),
      );
    }
  }
  if (envelope.maxLeverage !== undefined && !Number.isFinite(envelope.maxLeverage)) {
    errors.push(
      shapeError(
        `${at}.maxLeverage`,
        `${at}.maxLeverage must be a finite ratio when present (got '${String(envelope.maxLeverage)}')`,
      ),
    );
  }
  return errors;
}

/** Parse defensively: a non-canonical value is reported, never compared. */
function parseOrUndefined(text: string): bigint | undefined {
  try {
    return parseScaled(text);
  } catch {
    return undefined;
  }
}

function breach(
  accountId: string,
  limit: RiskLimitField,
  bodyValue: string,
  worldValue: string,
): BodyValidationError {
  return {
    code: "envelope-exceeds-world-limits",
    field: `riskEnvelope.${limit}`,
    envelope: { limit, bodyValue, worldValue },
    message:
      `riskEnvelope.${limit} ${bodyValue} for account ${accountId} is looser than the ` +
      `world's declared limit ${worldValue} — invalid at attach, never silently clipped`,
  };
}

/**
 * The envelope-vs-world-limits comparison (exact scaled arithmetic).
 * Fields whose values fail to parse are skipped — the shape validator has
 * already reported them loudly; comparisons never run on broken values.
 */
export function compareRiskEnvelopeToWorldLimits(
  envelope: RiskLimits,
  worldLimits: RiskLimits,
  accountId: string,
): readonly BodyValidationError[] {
  const errors: BodyValidationError[] = [];
  const worldAccount = `riskLimits.${accountId}`;

  for (const field of DECIMAL_FIELDS) {
    const bodyValue = envelope[field];
    const worldValue = worldLimits[field];
    if (bodyValue === undefined || worldValue === undefined) {
      continue;
    }
    const body = parseOrUndefined(bodyValue);
    const world = parseOrUndefined(worldValue);
    if (body === undefined || world === undefined) {
      continue;
    }
    if (body > world) {
      errors.push(breach(accountId, field, String(bodyValue), String(worldValue)));
    }
  }

  if (
    envelope.maxLeverage !== undefined &&
    worldLimits.maxLeverage !== undefined &&
    Number.isFinite(envelope.maxLeverage) &&
    Number.isFinite(worldLimits.maxLeverage)
  ) {
    if (ratioToScaled(envelope.maxLeverage) > ratioToScaled(worldLimits.maxLeverage)) {
      errors.push(
        breach(
          accountId,
          "maxLeverage",
          String(envelope.maxLeverage),
          String(worldLimits.maxLeverage),
        ),
      );
    }
  }

  for (const field of MONEY_FIELDS) {
    const bodyMoney = envelope[field];
    const worldMoney = worldLimits[field];
    if (bodyMoney === undefined || worldMoney === undefined) {
      continue;
    }
    const body = parseOrUndefined(bodyMoney.amount);
    const world = parseOrUndefined(worldMoney.amount);
    if (body === undefined || world === undefined) {
      continue;
    }
    if (String(bodyMoney.currency) !== String(worldMoney.currency)) {
      errors.push({
        code: "envelope-currency-mismatch",
        field: `riskEnvelope.${field}`,
        message:
          `riskEnvelope.${field} is declared in ${String(bodyMoney.currency)} but the world's ` +
          `declared limit for account ${accountId} is in ${String(worldMoney.currency)} ` +
          `(${worldAccount}.${field}) — incommensurable, invalid at attach`,
      });
      continue;
    }
    // maxGrossExposure/maxDrawdown: the Body may not claim more than the
    // world allows (≤). minBuyingPowerAfterOrder is a FLOOR: the Body may
    // not leave less than the world demands (≥).
    const isFloor = field === "minBuyingPowerAfterOrder";
    const exceeds = isFloor ? body < world : body > world;
    if (exceeds) {
      errors.push(
        breach(accountId, field, String(bodyMoney.amount), String(worldMoney.amount)),
      );
    }
  }

  return errors;
}

function tighterDecimal<T extends string>(
  body: T | undefined,
  world: T | undefined,
): T | undefined {
  if (body === undefined) {
    return world;
  }
  if (world === undefined) {
    return body;
  }
  const bodyScaled = parseOrUndefined(body);
  const worldScaled = parseOrUndefined(world);
  if (bodyScaled === undefined || worldScaled === undefined) {
    return bodyScaled === undefined ? world : body;
  }
  return bodyScaled <= worldScaled ? body : world;
}

function tighterMoney(body: Money | undefined, world: Money | undefined): Money | undefined {
  if (body === undefined) {
    return world;
  }
  if (world === undefined) {
    return body;
  }
  const bodyScaled = parseOrUndefined(body.amount);
  const worldScaled = parseOrUndefined(world.amount);
  if (bodyScaled === undefined || worldScaled === undefined) {
    return body;
  }
  return bodyScaled <= worldScaled ? body : world;
}

function higherMoney(body: Money | undefined, world: Money | undefined): Money | undefined {
  if (body === undefined) {
    return world;
  }
  if (world === undefined) {
    return body;
  }
  const bodyScaled = parseOrUndefined(body.amount);
  const worldScaled = parseOrUndefined(world.amount);
  if (bodyScaled === undefined || worldScaled === undefined) {
    return body;
  }
  return bodyScaled >= worldScaled ? body : world;
}

/**
 * The EFFECTIVE envelope: per field, the more restrictive of the Body's
 * declared value and the world's declared limit (unset = not enforced, so
 * a one-sided declaration wins; the floor field keeps the HIGHER floor).
 * This is the envelope the runtime should enforce for this Body — the
 * projection used by the attach gate and by W035's action protocol. It is
 * a pure intersection, never a clip: both source declarations remain
 * intact, and on a VALID attachment (Body ⊆ world, proven by
 * `compareRiskEnvelopeToWorldLimits`) every Body-declared value is carried
 * through unchanged.
 */
export function effectiveRiskEnvelope(
  envelope: RiskLimits,
  worldLimits: RiskLimits,
): RiskLimits {
  const maxOrderQuantity = tighterDecimal(
    envelope.maxOrderQuantity,
    worldLimits.maxOrderQuantity,
  );
  const maxPositionQuantity = tighterDecimal(
    envelope.maxPositionQuantity,
    worldLimits.maxPositionQuantity,
  );
  const maxGrossExposure = tighterMoney(
    envelope.maxGrossExposure,
    worldLimits.maxGrossExposure,
  );
  const maxDrawdown = tighterMoney(envelope.maxDrawdown, worldLimits.maxDrawdown);
  const minBuyingPowerAfterOrder = higherMoney(
    envelope.minBuyingPowerAfterOrder,
    worldLimits.minBuyingPowerAfterOrder,
  );
  const maxLeverage = Math.min(
    envelope.maxLeverage ?? Number.POSITIVE_INFINITY,
    worldLimits.maxLeverage ?? Number.POSITIVE_INFINITY,
  );
  return {
    ...(maxOrderQuantity === undefined ? {} : { maxOrderQuantity }),
    ...(maxPositionQuantity === undefined ? {} : { maxPositionQuantity }),
    ...(Number.isFinite(maxLeverage) ? { maxLeverage } : {}),
    ...(maxGrossExposure === undefined ? {} : { maxGrossExposure }),
    ...(maxDrawdown === undefined ? {} : { maxDrawdown }),
    ...(minBuyingPowerAfterOrder === undefined ? {} : { minBuyingPowerAfterOrder }),
  };
}
