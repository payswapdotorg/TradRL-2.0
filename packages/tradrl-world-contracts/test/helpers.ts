/**
 * Shared test helpers for the contracts package.
 *
 * - `Equal`/`Expect` give compile-time assertions (checked by
 *   `pnpm --filter tradrl-world-contracts typecheck`, which includes `test/`).
 * - branded-value constructors give readable runtime fixtures.
 */

import type { CurrencyCode, DecimalString, Price, Quantity, TimestampMs } from "../src/primitives.js";

/** Exact type equality (strict, compares deeply mutually-assignable types). */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

/** Compile-time assertion: fails `typecheck` when `T` is not `true`. */
export type Expect<T extends true> = T;

/** Keys of `T` that are required (non-optional). */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

/** Keys of `T` that are optional. */
export type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];

export const asTimestamp = (ms: number): TimestampMs => ms as TimestampMs;
export const asPrice = (value: string): Price => value as Price;
export const asQuantity = (value: string): Quantity => value as Quantity;
export const asDecimal = (value: string): DecimalString => value as DecimalString;
export const asCurrency = (code: string): CurrencyCode => code as CurrencyCode;
/** Construct any opaque id from its underlying string (ids are opaque at runtime). */
export const asId = <T>(value: string): T => value as T;
