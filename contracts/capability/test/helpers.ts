/**
 * Compile-time assertion helpers for contracts/capability tests (the
 * contracts/ui convention).
 *
 * `Equal`/`Expect` turn contract-law violations into
 * `tsc -p contracts/capability` failures; the forbidden-key scan helper
 * exists for the runtime neutrality guard.
 */

/** Exact type equality (strict, deeply mutually-assignable). */
export type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

/** Compile-time assertion: fails `typecheck` when `T` is not `true`. */
export type Expect<T extends true> = T;

/** Keys of `T` that are required (non-optional). */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

/** Keys of `T` that are optional. */
export type OptionalKeys<T> = {
  [K in keyof T]?: object extends Pick<T, K> ? K : never;
}[keyof T];

/** Construct an opaque-typed value from its underlying string. */
export const asOpaque = <T>(value: string): T => value as T;
