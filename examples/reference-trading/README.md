# The reference end-to-end trading journey (W064)

ONE §14 scope, the WHOLE trading-improvement pipeline, every record composed
through its own package's OWN gate — never hand-forged. This directory is a
plain example directory (the `docs/benchmarks` + `tests/trading-world`
precedent): no `package.json`, no workspace membership, no lockfile change.

Run it from the repository root:

```
npx tsx examples/reference-trading/journey.ts
```

It prints every composed stage — `stage [gate] → record id · carries N` —
and the journey's own content-addressed id (`journey-<digest>`, A9). The
end-to-end suite that re-runs this journey and re-validates every record
through its source package's own validator lives in `tests/e2e/`.

## The scope

The journey lives at ONE §14 scope — the populations fixture family's own
scope (the W041→W042→W043→W044→W045→W046 chain's own identity):

- tenant `tenant-model-selection` · project `project-selection` · world `world-selection-fixture`
- the declaring principal (`{tenantId, principalId}` — §14's principal tuple,
  the W058 grantee / W060 declarer vocabulary): `principal-reference-journey`
  at the same tenant.

## The journey map (stage → gate → record id shape)

| Stage | Gate (the record's own source) | Record id shape |
| --- | --- | --- |
| S1 forge the body plan | W041 `forgeBody` | `forge-<digest>` |
| S2 commission the body | W043 `commissionBody` | `commission-<digest>` |
| S3 bind the agent to the world | W044 `bindAgent` | `binding-<digest>` |
| S4 found the population | W045 `foundPopulation` | `pop-<digest>` |
| S5 grow the challenger generation | W045 `addMembers` | `pop-<digest>` |
| S6 found the curriculum | W046 `foundCurriculum` | `curr-<digest>` |
| S7 pair the population for self-play | W046 `composeSelfPlay` | `selfplay-<digest>` |
| S8 pair champion against challenger | W046 `composeAdversarial` | `adversarial-<digest>` |
| S9 compose the experiment | W037 `createExperiment` | `exp-<digest>` |
| S10 evaluate the walk | W038 `evaluateExperiment` | `expeval-<digest>` |
| S11 verify the evaluation | W038 `verifyExperimentEvaluation` | the findings digest |
| S12 seal the search history | W051 `buildSearchHistory` | `search-<digest>` |
| S13 derive the post-mortem | W053 `derivePostMortem` | `pm-<digest>` |
| S14 seal the point-in-time view | W050 `buildPointInTimeQuery`+`sealView` | `pitv-<digest>` |
| S15 assemble the view through the engine | W050 (service) `assembleView` | `pitv-<digest>` |
| S16 seal the knowledge records | W054 `sealKnowledgeRecord` | `mem-<digest>` ×4 kinds |
| S17 found + feed the firm brain | W054 `foundBrain`+`ingest` | `brain-<digest>` |
| S18 recall post-mortem knowledge | W054 `recall` | the brain id @ generation |
| S19 bridge trajectories into episodes | W047 `assembleEpisodes` | `epi-<digest>` ×N |
| S20 assemble the training batch | W047 `assembleBatch` | `batch-<digest>` |
| S21 compose the improvement cycle | W055 `composeImprovementCycle` | `impcycle-<digest>` |
| S22 register the arena provider | W057 `registerArenaProvider` (over W056) | `arena-<digest>` |
| S23 project the arena leaderboard | W057 `projectArenaLeaderboard` | the arena id |
| S24 register the capability provider | W056 `registerProvider` | `provider-<digest>` |
| S25 list the marketplace offer | W058 `listOffer` | `mkt-<digest>` |
| S26 grant + verify the entitlement | W058 `grantEntitlement`+`verifyEntitlement` | `ent-<digest>` |
| S27 declare the security policy | W060 `declareSecurityPolicy` | `pol-<digest>` |
| S28 seal the secret reference | W060 `sealSecretReference` | `sec-<digest>` |
| S29 prove cross-record tenant isolation | W060 `proveIsolation` | `iso-<digest>` |
| S30 enforce the secret-custody policy | W060 `enforceSecretPolicy` | `enf-<digest>` |
| S31 mint the operational events | W061 `mintOperationalEvent` | `oev-<digest>` ×4 |
| S32 assemble + verify the audit trail | W061 `assembleTrail`+`verifyTrail` | `atr-<digest>` |
| S33 compose the operational report | W061 `composeOperationsReport` | `opr-<digest>` |
| S34 project the view through the API surface | W059 `buildSdkRequest`+`validateSdkResponse` | `sdkreq-<digest>` |

Every stage line carries the count the RECORD itself carries (A6 — no
invented numbers; the `tests/e2e/journeyCoherence.test.ts` suite re-proves
every printed number against the cited records).

## Files

- `journeyFacts.ts` — the ONE §14 scope + the declaring principal + every
  declared constant (commerce terms, custody policy, ops declared times,
  the market-event instants, the view cutoff).
- `journeyHelpers.ts` — the fail-closed `mustOk` (a refused gate stops the
  journey with the gate's own errors carried verbatim) + the
  content-addressed journey id over the ordered stage lines (A9).
- `journeyStagesA.ts` — the founding family (W041→W045).
- `journeyStagesB.ts` — the learning family (W037→W055).
- `journeyStagesC.ts` — the improvement loop + the commerce family
  (W055→W058).
- `journeyStagesD.ts` — the governance family (W059→W061).
- `journey.ts` — `composeJourney()` + the printing entry point.
- `tsconfig.json` — the plain-dir typecheck arrangement (the
  `research/benchmarks` precedent; never built).

## OWNS / does-NOT-own

OWNS: the reference composition — the declared facts, the stage
construction through the REAL gates (relative source imports, no shims),
the printed summary (cited counts only), and the journey's own
content-addressed id.

does-NOT-own: any gate, validator, record vocabulary, or law — every one
of those belongs to its own package/service (W037–W061). No execution, no
training, no serving, no network, no filesystem writes, no process
spawning, no clocks (declared data only — A9/A14).

## Disclosed design decisions

1. **The scope** is the populations fixture family's own scope — the
   W055 fixture chain's scope, the order's named "fastest proven path".
   Every record in the journey lives at that ONE tenant/project/world; the
   principal tuple (`{tenantId, principalId}`) is the journey's own
   declaring principal at the same tenant.
2. **The deep W037→W053 chain** (experiment, evaluation, findings, search
   history, post-mortem, and the W051 view inside it) is composed at this
   scope through the W055 fixture chain's own builders
   (`services/autonomous-learning/test/fixtures.ts`) — every one of those
   builders constructs through the REAL gates (createExperiment →
   experimentManifestOf → evaluateExperiment → verifyExperimentEvaluation
   → buildSearchHistory → derivePostMortem, with a view built through
   W050's own `buildPointInTimeQuery`+`sealView`). Zero fixture drift; the
   fixture family's exported builders are the journey's declared inputs.
3. **The founding family is composed HERE, through the real gates**
   (forgeBody, commissionBody, bindAgent, foundPopulation, addMembers),
   mirroring the population fixture family's own seat commissioning (the
   world's DECLARED founding seat, the distinct per-seat W034 grant) — the
   default body requirements bind to a different world's seats and are
   refused loudly by W044's attach proof (pinned by the fixture family's
   own tests).
4. **Two forged plans** appear: the canonical plan (S1 — the W055 cycle's
   cited plan at this scope) and the seat plan (S2's commissioning input).
   Both are forged through W041's own gate; they differ only in declared
   body requirements.
5. **The journey's market events** are its OWN hand-fixed W004 envelopes
   (fixed event ids — the fixture family's `aMarketEvent` shares a module
   counter, which would leak composition-call order into the view ids and
   break the A9 twin). The events are declared data, validated through
   W004's own stream laws inside W050's assembly gate.
6. **The declaration-order twin**: `composeJourney("reversed")` re-declares
   the knowledge records in reverse order at W054's ingest and the
   improvement-cycle steps in reverse order at W055's seal — the gates
   canonicalize, so every composed id (and the journey id) is IDENTICAL
   (pinned in `tests/e2e/journeyIdentity.test.ts`).
7. **The API projection** (S34) carries the journey's sealed point-in-time
   view as a prepared SDK request over W059's default World-Alpha route
   table (`time-machine-view-get`, the R016 explicit-cutoff route) and
   re-validates a response payload composed from the journey's own view
   records against the route's declared response contract — the point
   where the api's own gates accept the journey's records. No transport is
   involved (A14 — serving is W062's).
8. **The ops records** (S31–S33) are minted at the journey's own scope
   through W061's mint/assemble/verify/compose gates; the audit provenance
   alternates the honest W028 dataset citation and the honest none-marker
   (the `services/operations` fixture precedent).
9. **Ids are printed verbatim**; where a stage composes MANY records
   (knowledge, episodes, events) the line prints the carried count and the
   id prefix (`N× prefix…`) — the count is cross-proven against a CARRYING
   record (the brain's record count, the batch's episode count, the
   report's event total) in the coherence suite.
