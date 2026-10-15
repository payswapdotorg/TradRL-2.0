# experiments (W037)

The experiment PROTOCOL — the declarative descriptor + the manifest that
bind trajectory records into one experiment. Flat source-exported contract
package (the W035 `agent-world-protocol` / W036 `learning-objectives`
pattern).

## What this package OWNS

- **descriptor.ts** — `ExperimentDescriptor` (DECLARATIVE data: the world
  definition reference with its content digest, the participant specs, the
  W036 reward model, the constraint set, and the §13 evaluation policy);
  the deterministic identity `experimentIdOf` (a canonical hash over the
  descriptor — same descriptor bytes → same experiment id, A9; the id is
  opaque and never parsed); `createExperiment` — the construction gate
  (structure + the W036 construction laws, with W036's own typed errors
  carried verbatim — e.g. the §13 `pnl-sole-objective` law surfaces here
  by name).
- **manifest.ts** — `HoldoutSplitDescriptor` (the holdout split assignments
  per the policy's holdout kinds: periods/regimes/assets/venues
  walk-forward splits AS DATA — declarative split descriptors, never
  computed statistics), `TrajectoryRef` (membership: the opaque trajectory
  id + its explicit scope), `ExperimentManifest`, and
  `experimentManifestOf` — the manifest gate (scope mismatch, duplicate
  membership, unknown holdout kinds/axes, kind mismatches, empty/
  duplicate/overlapping split sides — every law a loud typed error); the
  policy's integrity requirements are carried forward onto the manifest
  verbatim.

## What this package deliberately does NOT own

- NO execution: the experiment protocol RECORDS and DESCRIBES; the world
  runtime runs sessions (W035); W038 walks what this defines. No RL, no
  training loops, no model calls (the W036 scope-honesty precedent).
- NO trajectory capture or storage — the sibling `trajectory` package owns
  the capture protocol; store implementations live elsewhere.
- NO computed statistics: split sides are DECLARED atoms (periods, regime/
  asset/venue ids); measuring what the data says is the evaluation
  consumer's job (W038), never the protocol's.
- NO enforcement (A13): constraints ride as data through the W036 policy;
  the world runtime's gates stay the sole authority.
- NO id parsing (DOMAIN-MODEL): the experiment id is a canonical digest;
  the scope is carried explicitly on the descriptor and the manifest.

Consumers: W038 (evaluation/verification — walks the experiments), W041
(skill extraction), W047 (RL interface — deterministic episode records).

License: Apache-2.0 (the repository LICENSE).
