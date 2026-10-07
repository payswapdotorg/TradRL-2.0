/**
 * Type-only re-export of the canonical W003 world-contract port types —
 * the seam `worldClient.ts` compiles against (spec/WORK-ITEMS.md W006: "the
 * seam compiles against W003 contracts types only").
 *
 * WHY A .d.ts SHIM: packages/ui does not (yet) depend on
 * tradrl-world-contracts — adding that dependency requires the TL-owned
 * root manifests (packages/ui/package.json + pnpm workspace wiring), which
 * are outside W006's frozen write surface. A direct source import from
 * packages/ui/src would break `tsc -b packages/ui` (TS6059/TS6307: files
 * outside the project's rootDir/file list become emit inputs of a composite
 * project). A declaration-file shim is never emitted, and with the repo's
 * `skipLibCheck: true` (tsconfig.base.json) it re-exports the REAL contract
 * types with zero duplication — drift is impossible because this file
 * literally points at the canonical sources.
 *
 * W018 (World Worker adapter + UI transport) replaces this shim with a real
 * package specifier when the TL wires the manifest dependency; the drift
 * guard in packages/ui/test/tradingWorldWorldClient.test.ts imports the real
 * contracts directly (outside the ui tsc project, the W005-established
 * pattern) and fails if the seam ever diverges.
 */
export type {
  ClockPort,
  ClockStatus,
  ClockView,
  CommandPort,
  EvidencePort,
  QueryPort,
  WorldProtocol,
} from "../../../../tradrl-world-contracts/src/ports.js";
export type {
  BranchRecord,
  DeterminismDeclaration,
  DeterminismManifest,
  ExecutionAuthority,
  SnapshotDescriptor,
  WorldMeta,
  WorldMode,
} from "../../../../tradrl-world-contracts/src/world.js";
