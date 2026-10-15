/**
 * Public surface of the W059 `services/api` package — the typed API
 * contract service: every public/private route as TYPED DATA.
 *
 * Modules (the package.json exports map is the authority):
 * - `./routes.js` — the RouteTable type system: closed vocabularies, the
 *   §14 scope hierarchy, the W028 provenance citation, the content-addressed
 *   id derivation, the default table's drift anchor;
 * - `./point-in-time.js` — the time-machine route family + THE R016 LAW
 *   (explicit cutoffs — never implicit-latest);
 * - `./errors.js` — the typed error families (wire codes + table laws);
 * - `./validate.js` — fail-closed construction + whole-record
 *   re-validation (ids re-derived);
 * - THIS module — the core route DECLARATIONS (platform / evidence /
 *   organization families) and the assembled default World-Alpha table.
 *
 * A14: CONTRACTS ONLY — no HTTP serving (W062), no authn/authz execution
 * (W060), no observability (W061), no network I/O.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { buildRouteTable } from "./validate.js";
import { pointInTimeRouteDeclarations } from "./point-in-time.js";
import type { ApiRouteDeclaration, ApiRouteTable } from "./routes.js";
import type { RouteTableOutcome } from "./validate.js";

export * from "./routes.js";
export * from "./point-in-time.js";
export * from "./errors.js";
export * from "./validate.js";

// ---------------------------------------------------------------------------
// The core route declarations (platform / evidence / organization families)
// ---------------------------------------------------------------------------

const WORLD = "/v1/tenants/:tenantId/projects/:projectId/worlds/:worldId";
const ORG = "/v1/tenants/:tenantId/projects/:projectId/organizations/:organizationId";

/**
 * The platform + evidence + organization route DECLARATIONS. The
 * time-machine family is declared in `./point-in-time.ts`; together they
 * compose the default table below.
 */
export function coreRouteDeclarations(): readonly ApiRouteDeclaration[] {
  return [
    {
      name: "health",
      family: "platform",
      visibility: "public",
      version: "v1",
      method: "GET",
      path: "/v1/tenants/:tenantId/health",
      scope: "tenant",
      request: { fields: [] },
      response: {
        payloadType: "HealthReport",
        fields: [
          { name: "status", kind: "string", required: true, description: "The service's health status." },
          { name: "apiVersion", kind: "string", required: true, description: "The route table version in force." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: a health datum declares no evidence source." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "The platform health probe (public): one tenant-scoped heartbeat.",
    },
    {
      name: "route-table",
      family: "platform",
      visibility: "public",
      version: "v1",
      method: "GET",
      path: "/v1/tenants/:tenantId/routes",
      scope: "tenant",
      request: { fields: [] },
      response: {
        payloadType: "ApiRouteTable",
        fields: [
          { name: "tableId", kind: "string", required: true, description: "The route table's content-addressed id." },
          { name: "apiVersion", kind: "string", required: true, description: "The table's version." },
          { name: "routes", kind: "json", required: true, description: "The canonically ordered route records." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: the table is declared data." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "The self-describing route table (public): the table this service enforces.",
    },
    {
      name: "evidence-view",
      family: "evidence",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/evidence`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "EvidenceProjection",
        fields: [
          { name: "summary", kind: "json", required: true, description: "The W028 evidence summary." },
          { name: "events", kind: "json", required: true, description: "The per-event evidence records (citations carried verbatim)." },
          { name: "artifacts", kind: "json", required: true, description: "The per-artifact evidence records." },
          { name: "datasets", kind: "json", required: true, description: "The per-dataset evidence records." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 citation: this response projects event, artifact and dataset evidence." },
        ],
        provenance: { kind: "evidence-projection", entities: ["event", "artifact", "dataset"] },
      },
      description: "The W028 evidence view for one world: which facts cite which sources.",
    },
    {
      name: "evidence-event",
      family: "evidence",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/evidence/events/:eventId`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "EventEvidence",
        fields: [
          { name: "eventId", kind: "record-id", required: true, description: "The journal event's opaque id." },
          { name: "citation", kind: "json", required: true, description: "The event's declared source citation (W028, carried verbatim)." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 citation: this response projects event evidence." },
        ],
        provenance: { kind: "evidence-projection", entities: ["event"] },
      },
      description: "One journal event's evidence record (W028): its declared source citation.",
    },
    {
      name: "evidence-artifact",
      family: "evidence",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/evidence/artifacts/:artifactId`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "ArtifactEvidence",
        fields: [
          { name: "artifactId", kind: "record-id", required: true, description: "The imported artifact's opaque id." },
          { name: "citedBy", kind: "json", required: true, description: "The events citing this artifact (W028)." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 citation: this response projects artifact evidence." },
        ],
        provenance: { kind: "evidence-projection", entities: ["artifact"] },
      },
      description: "One imported artifact's evidence record (W028): the events that cite it.",
    },
    {
      name: "evidence-dataset",
      family: "evidence",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${WORLD}/evidence/datasets/:datasetId`,
      scope: "tenant-project-world",
      request: { fields: [] },
      response: {
        payloadType: "DatasetEvidence",
        fields: [
          { name: "datasetId", kind: "record-id", required: true, description: "The dataset's opaque id." },
          { name: "citedBy", kind: "json", required: true, description: "The events citing this dataset (W028)." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The W028 citation: this response projects dataset evidence." },
        ],
        provenance: { kind: "evidence-projection", entities: ["dataset"] },
      },
      description: "One dataset's evidence record (W028): the events that cite it.",
    },
    {
      name: "organization-get",
      family: "organization",
      visibility: "private",
      version: "v1",
      method: "GET",
      path: `${ORG}`,
      scope: "tenant-project",
      request: { fields: [] },
      response: {
        payloadType: "OrganizationDefinition",
        fields: [
          { name: "organizationId", kind: "record-id", required: true, description: "The organization's opaque canonical id." },
          { name: "definition", kind: "json", required: true, description: "The W039 declarative organization definition." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: a declaration, not an evidence projection." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "One organization's declarative definition (W039): positions, units, bindings, lineage.",
    },
    {
      name: "organization-compile",
      family: "organization",
      visibility: "private",
      version: "v1",
      method: "POST",
      path: `${ORG}/compile`,
      scope: "tenant-project",
      request: { fields: [] },
      response: {
        payloadType: "CompiledOrganization",
        fields: [
          { name: "compiledId", kind: "record-id", required: true, description: "The compiled plan's content-addressed id." },
          { name: "plan", kind: "json", required: true, description: "The W039 compiled organization plan (bindings in canonical execution order)." },
          { name: "provenance", kind: "provenance-citation", required: true, description: "The honest W028 marker: a compiled plan, not an evidence projection." },
        ],
        provenance: { kind: "no-declared-source" },
      },
      description: "Compile one organization into its resolved binding plan (W039): deterministic, fail-closed.",
    },
  ];
}

// ---------------------------------------------------------------------------
// The default table (World-Alpha public/private surface, v1)
// ---------------------------------------------------------------------------

/**
 * The DEFAULT route table: the platform + evidence + organization families
 * (`coreRouteDeclarations`) composed with the time-machine family
 * (`pointInTimeRouteDeclarations`) — every route public or private, every
 * scope explicit, every data-carrying response citing W028 provenance,
 * every point-in-time route carrying its explicit cutoff (R016).
 */
export function worldAlphaApiV1(): RouteTableOutcome {
  return buildRouteTable([
    ...coreRouteDeclarations(),
    ...pointInTimeRouteDeclarations(),
  ]);
}

const WORLD_ALPHA_ASSEMBLY = worldAlphaApiV1();
if (!WORLD_ALPHA_ASSEMBLY.ok) {
  throw new Error(
    `the default World-Alpha route table is unlawful: ${JSON.stringify(WORLD_ALPHA_ASSEMBLY.violations)}`,
  );
}

/** The assembled default table (frozen data; ids content-addressed — A9). */
export const WORLD_ALPHA_API_V1: ApiRouteTable = WORLD_ALPHA_ASSEMBLY.table;
