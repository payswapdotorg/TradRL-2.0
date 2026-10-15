# Runbook — deployment review (W062)

The operational procedure for reviewing a deployment BEFORE it is accepted.
The machinery this procedure walks is the typed contract in `deploy/`
(`composeDeploymentPlan` + `validateDeploymentPlan`); this runbook never
re-states a law the contract owns — it cites it.

## Procedure

1. **Assemble the real records.** The declarer builds every cited record
   through its own source gate: the security policy through W060's
   `declareSecurityPolicy`, every secret HANDLE through W060's
   `sealSecretReference` (typed handles only — a secret VALUE anywhere is
   refused loudly by THE REDACTION LAW), and the API/SDK/operations citations
   copied from the real W059/W061 surfaces (`worldAlphaApiV1()`,
   `buildSdkClient`, `operationsRouteDeclarations()`).
2. **Compose through the gate.** `composeDeploymentPlan(input, known?)` —
   never hand-write a plan. The gate re-proves every citation against the
   real merged-dep surfaces, re-scans THE REDACTION LAW over the entire
   declaration, enforces the mode + lineage posture laws, MINTS the custody
   enforcement + tenant-isolation records through W060's own machinery, and
   seals the content-addressed `deploy-<digest>` id.
3. **Read every violation, never just the first.** The gate collects ALL
   violations (closed vocabulary, typed). A refusal is evidence, not noise:
   each named kind names the exact law that failed. Fix the declaration and
   re-compose; never partially accept.
4. **Re-validate from the record alone.** `validateDeploymentPlan(plan)` —
   ids are re-derived, the carried verdicts are compared against fresh
   re-mints, the canonical carriage is proven. A plan that does not
   re-validate is a rewrite and is refused loudly.
5. **Check the lineage.** A progression mode (`blue-green`, `canary`,
   `rolling`) must carry a live parent plan; supply the `known` set so
   parent-existence, parent-scope and contiguity are actually proven.
6. **Record the acceptance.** The sealed plan (with its id, its carried
   citations, its minted posture records) is the acceptance record. The
   readiness gates it depends on are recorded through the `ops/` readiness
   checklist contract.

## What this procedure does NOT do

- It never executes a deployment, binds a port, starts a server, or
  supervises a process (A13/A14 — `deploy/` owns the contract only).
- It never invents a number: every count the review sees is carried by a
  cited record (A6).

## Citation chain

- `deploy/plan.ts` — the `DeploymentPlan` record + the closed vocabularies.
- `deploy/compose.ts` — THE GATE.
- `deploy/validate.ts` — whole-record re-validation.
- W059 `services/api` + `packages/sdk`, W060 `packages/security` +
  `services/security`, W061 `packages/observability` — the real surfaces
  every citation is proven against.

License: Apache-2.0 (the repository LICENSE).
