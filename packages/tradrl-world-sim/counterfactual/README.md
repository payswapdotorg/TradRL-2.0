# tradrl-world-sim/counterfactual (W025)

The counterfactual world framework: **"what if" worlds branched from a parent
world's point in time** — derived from the parent's IMMUTABLE snapshot artifacts
(A8: the parent is never written; branching is never a destructive rewind).

## The deliberate contrast with the W016 branch command

A **W016 branch** is JOURNALED on the parent (one `world.branch.created` record)
and the child inherits the parent's definition verbatim (rescoped). A **W025
counterfactual** is a HOST-SIDE derivation — the parent journal is not touched
at all — whose definition carries the branch's OWN seed, the `counterfactual`
world mode, and an optional **scenario overlay** (a regime-schedule override
and/or injected information artifacts behind the A7 firewall). The two families
compose: a counterfactual can branch from a W016 branch child.

## Surface

- **definition.ts** — the typed `CounterfactualBranch` descriptor + the closed
  `CounterfactualProblem` rejection set; the content-addressed identity law
  (`cf:<parentWorldId>:<digest>` over the whole descriptor — the same parent +
  the same descriptor yield the SAME branch world; any input difference is a
  different world; a branch id is a strict extension of its parent's id, so a
  branch can never BE its parent — the `branch-is-parent` guard is
  defense-in-depth for any future encoder change).
- **genesis.ts** — `planCounterfactualBranch`: loud validation against the live
  parent (unknown/foreign/tampered snapshots, prefix mismatches, branch-point
  bounds, overlay validity incl. artifact-id collisions with the parent), the
  genesis capture (the restore point + journal tail), pure planning.
- **engine.ts** — `createCounterfactualBranchEngine`: restore-from-genesis +
  the branch definition; the parent is READ ONLY (the `CounterfactualParentReader`
  seam); the handle (engine + record + definition + genesisSnapshot, re-restorable).
- **participants.ts** — a W023 reactive participant runtime attached to a
  branched engine: the same protocol, the same A7 firewall, branch-scoped.
- **comparison.ts** — typed cross-branch divergence summaries: portfolio/position
  diffs, the first journal divergence point, per-branch digests (the W016
  hashing family — content-addressed, comparable).

## Tests (`test/`)

`cd packages/tradrl-world-sim && ../../node_modules/.bin/tsx --test counterfactual/test/*.test.ts`
— the descriptor laws (closed set + the identity property proof), genesis
semantics (own journal, rescoped state, overlay in force in the branch — never
the parent), read-only parent journal access, the restore-equivalence law
(genesis + journalTail ≡ the live branch, future commands included), parent
immutability under three concurrent branches + a W016 child + a nested
counterfactual (byte-identical parent truth), family composition, and telemetry
honesty.
