/**
 * Public surface of the W028 `tradrl-evidence` package — the evidence/
 * provenance projection layer (the auditability spine).
 *
 * Spec: spec/WORK-ITEMS.md W028, spec/ARCHITECTURE-LOCK.md A7 (the
 * information firewall applies to evidence reads), A9 (deterministic,
 * content-addressed projections), spec/WORLD-PROTOCOL.md "Ports"
 * (EvidencePort) + "UI projection law" (pure projections never fabricate
 * facts), spec/ACCEPTANCE-WORLD-ALPHA.md L (causal events + provenance).
 *
 * Layering (each module stands alone):
 * - `./citations.js` — the pure citation law: one journal event envelope ⇒
 *   its declared source citation (W027 payload identity, W020 import
 *   causation, or the honest no-declared-source marker — never fabricated);
 * - `./chain.js` — the deterministic projection digest chain (inventory
 *   anchor + rolling per-event links) and its local verification;
 * - `./projection.js` — `projectEvidence`: journal + artifacts + dataset
 *   descriptors ⇒ the EVIDENCE VIEW (plain frozen data);
 * - `./query.js` — `createEvidenceQuery`: the typed lookup surface (by
 *   event, by artifact, by dataset — unknown ids are typed errors) and the
 *   `ProvenanceRecord` bridge for the W016 EvidencePort;
 * - `./errors.js` — the typed error taxonomy.
 *
 * The CONTRACTS the identities come from live in `tradrl-world-contracts`
 * (`./data`, `./information-data`); the journal records and the hashing
 * family live in `tradrl-world-sim`. This package owns only the projection.
 */

export {
  EvidenceProjectionError,
  UnknownEvidenceEntityError,
  type EvidenceEntityKind,
  type EvidenceViolation,
  type EvidenceViolationKind,
} from "./errors.js";
export {
  citedDatasetIdOf,
  isArtifactCitation,
  isDatasetCitation,
  isInformationArtifactIdentity,
  resolveSourceCitation,
  type CitationResolution,
  type SourceCitation,
} from "./citations.js";
export {
  chainLinkOf,
  citationDigestOf,
  envelopeDigestOf,
  inventoryDigestOf,
  verifyEvidenceChain,
  type ChainVerification,
  type EvidenceDigestChain,
} from "./chain.js";
export {
  projectEvidence,
  type ArtifactEvidence,
  type DatasetEvidence,
  type EventEvidence,
  type EvidenceDatasetDescriptor,
  type EvidenceProjection,
  type EvidenceProjectionInput,
  type EvidenceSummary,
} from "./projection.js";
export {
  createEvidenceQuery,
  type EvidenceEventFilter,
  type EvidenceQuery,
} from "./query.js";
