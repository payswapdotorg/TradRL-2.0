/**
 * Type-only re-export of the canonical W003 world-contract port types —
 * the seam `worldClient.ts` compiles against (spec/WORK-ITEMS.md W006: "the
 * seam compiles against W003 contracts types only").
 *
 * WHY A .d.ts SHIM: a declaration file is never emitted, and it re-exports
 * the REAL contract types with zero duplication — drift is impossible
 * because this file literally points at the canonical sources through the
 * package specifier (the manifest dependency `tradrl-world-contracts` is
 * wired in packages/ui/package.json, so the reference resolves through the
 * package `exports` map with a packageId — an external module, never an
 * emit input of the `tsc -b packages/ui` composite project). This is the
 * W030 "real-specifier flip" (8cc3d82) applied to the shim: the earlier
 * RELATIVE-path form (`../../../../tradrl-world-contracts/src/*.js`)
 * resolved WITHOUT a packageId, pulling the contracts sources — and their
 * whole relative-import closure — into the ui program as project files,
 * which is exactly the TS6059/TS6307 storm that broke the root typecheck
 * gate. The package-specifier form is the one the tsc -b graph accepts.
 *
 * The drift guard in packages/ui/test/tradingWorldWorldClient.test.ts
 * imports the real contracts directly (outside the ui tsc project, the
 * W005-established pattern) and fails if the seam ever diverges.
 */
export type {
  ClockPort,
  ClockStatus,
  ClockView,
  CommandPort,
  EvidencePort,
  QueryPort,
  WorldProtocol,
} from "tradrl-world-contracts/ports";
export type {
  BranchRecord,
  DeterminismDeclaration,
  DeterminismManifest,
  ExecutionAuthority,
  SnapshotDescriptor,
  WorldMeta,
  WorldMode,
} from "tradrl-world-contracts/world";
