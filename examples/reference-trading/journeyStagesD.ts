/**
 * The W064 reference journey — STAGE SET D, THE GOVERNANCE FAMILY
 * (W059/W060/W061): the security policy + the secret handle + the
 * cross-record isolation proof + the custody enforcement (W060's gates),
 * the audit trail assembled + verified + the operational report composed
 * (W061's gates over the observability contracts), and the API surface —
 * the default route table validated, the SDK client projected over it, the
 * journey's sealed point-in-time view carried as a prepared request and
 * its payload re-validated against the route's response contract (W059's
 * gates through packages/sdk).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  declareSecurityPolicy,
  sealSecretReference,
} from "../../packages/security/index.js";
import type { IsolationProof, SecurityPolicy, SecretReference } from "../../packages/security/index.js";
import {
  brainEvidence,
  enforceSecretPolicy,
  knowledgeRecordEvidence,
  proveIsolation,
} from "../../services/security/index.js";
import type { SecretEnforcement } from "../../services/security/index.js";
import { mintAuditRecord, mintOperationalEvent } from "../../packages/observability/index.js";
import type { AuditTrail, OperationalEvent, OpsScope, SourceCitation } from "../../packages/observability/index.js";
import {
  assembleTrail,
  composeOperationsReport,
  verifyTrail,
} from "../../services/operations/index.js";
import type { OperationsReport } from "../../services/operations/index.js";
import { WORLD_ALPHA_API_V1, validateRouteTable } from "../../services/api/index.js";
import {
  buildSdkClient,
  buildSdkRequest,
  validateSdkResponse,
} from "../../packages/sdk/index.js";
import type { SdkPreparedRequest } from "../../packages/sdk/index.js";
import { T0 } from "../../packages/tradrl-time-machine/test/fixtures.js";
import {
  AUDIT_DECLARED_AT,
  CUSTODY,
  DATASET_CITATION,
  EVENT_DECLARED_AT,
  NO_SOURCE,
  OPS_ACTOR,
  REQUIRED_SCOPE_KIND,
  SCOPE,
  VIEW_CUTOFF,
} from "./journeyFacts.js";
import { mustOk, type StageLine } from "./journeyHelpers.js";
import type { LearningRecords } from "./journeyStagesB.js";

/** The governance family's composed records. */
export interface GovernanceRecords {
  readonly policy: SecurityPolicy;
  readonly secret: SecretReference;
  readonly isolation: IsolationProof;
  readonly enforcement: SecretEnforcement;
  readonly events: readonly OperationalEvent[];
  readonly trail: AuditTrail;
  readonly trailRecordCount: number;
  readonly report: OperationsReport;
  readonly preparedRequest: SdkPreparedRequest;
  readonly viewRouteName: string;
}

const OPS_SCOPE: OpsScope = {
  kind: "tenant-project-world",
  tenantId: SCOPE.tenantId,
  projectId: SCOPE.projectId,
  worldId: SCOPE.worldId,
};

/** Compose the governance family through every gate, at the journey's scope. */
export function stagesGovernance(learning: LearningRecords): {
  readonly lines: readonly StageLine[];
  readonly records: GovernanceRecords;
} {
  const policy = mustOk(
    declareSecurityPolicy({
      scope: { ...SCOPE },
      requiredScopeKind: REQUIRED_SCOPE_KIND,
      declaredBy: { tenantId: SCOPE.tenantId, principalId: "principal-reference-journey" },
      secretCustody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
      authorizationModel: "entitlement-grants",
    }),
    "declare-security-policy",
  ).policy;
  const policyLine: StageLine = {
    stage: "S27 declare the security policy",
    gate: "W060 declareSecurityPolicy",
    recordId: String(policy.policyId),
    carriedCount: null,
  };

  const secret = mustOk(
    sealSecretReference({
      scope: { ...SCOPE },
      kind: "api-key",
      displayName: "the journey's upstream exchange handle",
      custody: { ...CUSTODY, rotation: { ...CUSTODY.rotation }, accessScopes: [...CUSTODY.accessScopes] },
    }),
    "seal-secret-reference",
  ).reference;
  const secretLine: StageLine = {
    stage: "S28 seal the secret reference",
    gate: "W060 sealSecretReference",
    recordId: String(secret.secretId),
    carriedCount: null,
  };

  const evidence = [
    ...learning.knowledge.map((record) => knowledgeRecordEvidence(record)),
    brainEvidence(learning.brain),
  ];
  const isolation = mustOk(proveIsolation(evidence), "prove-isolation").proof;
  const isolationLine: StageLine = {
    stage: "S29 prove cross-record tenant isolation",
    gate: "W060 proveIsolation",
    recordId: String(isolation.proofId),
    carriedCount: isolation.checked,
  };

  const enforcement = mustOk(enforceSecretPolicy(policy, [secret]), "enforce-secret-policy").enforcement;
  const enforcementLine: StageLine = {
    stage: "S30 enforce the secret-custody policy",
    gate: "W060 enforceSecretPolicy",
    recordId: String(enforcement.enforcementId),
    carriedCount: enforcement.checked,
  };

  const events: OperationalEvent[] = [
    mustOk(mintOperationalEvent({
      sequence: 1,
      kind: "world-created",
      scope: OPS_SCOPE,
      actor: OPS_ACTOR,
      payload: { kind: "world-created", worldId: SCOPE.worldId, definitionDigest: "defdigest-w064-reference-journey-1", seed: 7 },
      declaredAt: EVENT_DECLARED_AT + 1,
    }), "mint-event-1").event,
    mustOk(mintOperationalEvent({
      sequence: 2,
      kind: "dataset-imported",
      scope: OPS_SCOPE,
      actor: OPS_ACTOR,
      payload: { kind: "dataset-imported", datasetId: "ds-reference-journey-1", recordCount: 11 },
      declaredAt: EVENT_DECLARED_AT + 2,
    }), "mint-event-2").event,
    mustOk(mintOperationalEvent({
      sequence: 3,
      kind: "dataset-imported",
      scope: OPS_SCOPE,
      actor: OPS_ACTOR,
      payload: { kind: "dataset-imported", datasetId: "ds-reference-journey-1", recordCount: 12 },
      declaredAt: EVENT_DECLARED_AT + 3,
    }), "mint-event-3").event,
    mustOk(mintOperationalEvent({
      sequence: 4,
      kind: "audit-appended",
      scope: OPS_SCOPE,
      actor: OPS_ACTOR,
      payload: { kind: "audit-appended", auditRecordId: "aud-journey-2", auditAction: "world-accessed" },
      declaredAt: EVENT_DECLARED_AT + 4,
    }), "mint-event-4").event,
  ];
  const eventsLine: StageLine = {
    stage: "S31 mint the operational events",
    gate: "W061 mintOperationalEvent",
    recordId: `${String(events.length)}× oev-…`,
    carriedCount: null,
  };

  const audits = [1, 2, 3].map((sequence) =>
    mustOk(mintAuditRecord({
      sequence,
      action: "world-accessed",
      scope: OPS_SCOPE,
      actor: OPS_ACTOR,
      subject: `subject-journey-${String(sequence)}`,
      detail: { route: "evidence-view", code: 200 },
      provenance: (sequence % 2 === 0 ? DATASET_CITATION : NO_SOURCE) as SourceCitation,
      declaredAt: AUDIT_DECLARED_AT + sequence,
    }), `mint-audit-${String(sequence)}`).record,
  );
  const trail = mustOk(assembleTrail(audits), "assemble-trail").trail;
  const verification = mustOk(verifyTrail(trail), "verify-trail");
  const trailLine: StageLine = {
    stage: "S32 assemble + verify the audit trail",
    gate: "W061 assembleTrail+verifyTrail",
    recordId: String(trail.trailId),
    carriedCount: verification.recordCount,
  };

  const report = mustOk(composeOperationsReport(trail, events), "compose-operations-report").report;
  const reportLine: StageLine = {
    stage: "S33 compose the operational report",
    gate: "W061 composeOperationsReport",
    recordId: String(report.reportId),
    carriedCount: report.eventTotal,
  };

  mustOk(validateRouteTable(WORLD_ALPHA_API_V1), "validate-route-table");
  const client = mustOk(buildSdkClient(WORLD_ALPHA_API_V1), "build-sdk-client").client;
  const route = WORLD_ALPHA_API_V1.routes.find((candidate) => candidate.name === "time-machine-view-get");
  if (route === undefined) {
    throw new Error("journey stage 'build-sdk-request' — the default table declares no time-machine-view-get route");
  }
  const cutoff = T0 + VIEW_CUTOFF;
  const preparedRequest = mustOk(
    buildSdkRequest(WORLD_ALPHA_API_V1.tableId, route, {
      scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
      pathParams: { viewId: String(learning.view.viewId) },
      fields: { cutoff },
    }),
    "build-sdk-request",
  ).request;
  mustOk(
    validateSdkResponse(route, {
      viewId: String(learning.view.viewId),
      cutoff,
      records: learning.view.records,
      provenance: { kind: "evidence-projection", entities: ["event"] },
    }),
    "validate-sdk-response",
  );
  const apiLine: StageLine = {
    stage: "S34 project the view through the API surface",
    gate: "W059 buildSdkRequest+validateSdkResponse",
    recordId: String(preparedRequest.preparedRequestId),
    carriedCount: client.methods.length,
  };

  return {
    lines: [
      policyLine,
      secretLine,
      isolationLine,
      enforcementLine,
      eventsLine,
      trailLine,
      reportLine,
      apiLine,
    ],
    records: {
      policy,
      secret,
      isolation,
      enforcement,
      events,
      trail,
      trailRecordCount: verification.recordCount,
      report,
      preparedRequest,
      viewRouteName: route.name,
    },
  };
}
