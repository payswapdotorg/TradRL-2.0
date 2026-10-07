/**
 * The A7 observation firewall for a Body (W032): the available-then grant.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — "Historical information must not be
 * observable before `availableAt`." The BodyView contract types the
 * firewall: this module is the pure transform that turns a view + a
 * request + the world's information artifacts into the GRANTED observation
 * surface at `asOf`. Artifacts whose `availableAt` is after `asOf` are
 * WITHHELD AND NAMED — never silently dropped, never leaked.
 * Spec: spec/REQUIREMENTS.md R016 — point-in-time information firewall.
 * Spec: spec/ARCHITECTURE.md §7 "Information world" — availability is part
 * of the record; the canonical predicate (`isInformationAvailable`,
 * W003 contracts) is reused here, never re-derived.
 *
 * No runtime: no subscriptions, no caching, no transport — W035's
 * observation/action protocol drives this with real artifacts.
 */

import { isInformationAvailable } from "tradrl-world-contracts";
import type { InformationArtifact } from "tradrl-world-contracts";
import type {
  BodyObservationDenial,
  BodyObservationGrant,
  BodyObservationKind,
  BodyObservationRequest,
  BodyView,
} from "./contracts.js";

function deny(code: BodyObservationDenial["code"], message: string): BodyObservationDenial {
  return { code, message };
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Project a Body's observation request against its view at `asOf`.
 *
 * Laws (pinned by tests):
 * - granted kinds ⊆ requested ∩ view.observations; every ungranted kind is
 *   denied by name (`kind-not-in-view`);
 * - granted instruments ⊆ (requested ?? view.instruments) ∩
 *   view.instruments; every ungranted instrument is denied by name
 *   (`instrument-not-in-view`);
 * - artifacts: only requested ids are judged; unknown ids are denied
 *   (`unknown-artifact`); known ids are visible exactly when
 *   `availableAt` ≤ `asOf` (the canonical A7 predicate), otherwise
 *   withheld AND named — a Body cannot subscribe beyond available-then;
 * - a non-finite `asOf` fails closed: no artifact is visible and the
 *   denial says why.
 */
export function projectBodyObservations(
  view: BodyView,
  request: BodyObservationRequest,
  artifacts: readonly InformationArtifact<unknown>[],
): BodyObservationGrant {
  const denials: BodyObservationDenial[] = [];

  const grantedKinds = dedupe(
    request.kinds.filter((kind) => view.observations.includes(kind)),
  );
  for (const kind of dedupe(request.kinds)) {
    if (!grantedKinds.includes(kind)) {
      denials.push(
        deny("kind-not-in-view", `observation kind '${kind}' is not admitted by this Body's view`),
      );
    }
  }

  const requestedInstruments = request.instruments ?? view.instruments;
  const grantedInstruments = dedupe(
    requestedInstruments.filter((instrument) => view.instruments.includes(instrument)),
  );
  for (const instrument of dedupe(requestedInstruments)) {
    if (!grantedInstruments.includes(instrument)) {
      denials.push(
        deny(
          "instrument-not-in-view",
          `instrument ${String(instrument)} is outside this Body's view`,
        ),
      );
    }
  }

  const visible: InformationArtifact<unknown>["artifactId"][] = [];
  const withheld: InformationArtifact<unknown>["artifactId"][] = [];
  const requestedArtifacts = request.artifacts ?? [];
  if (requestedArtifacts.length > 0) {
    if (!Number.isFinite(request.asOf)) {
      denials.push(
        deny(
          "non-finite-as-of",
          "asOf must be a finite simulation time — the A7 firewall refuses to grant on a broken time axis (fail-closed)",
        ),
      );
    } else if (!grantedKinds.includes("information-artifacts")) {
      denials.push(
        deny(
          "kind-not-in-view",
          "information artifacts were requested but the 'information-artifacts' observation kind is not granted",
        ),
      );
    } else {
      const artifactsById = new Map<string, InformationArtifact<unknown>>(
        artifacts.map((artifact) => [String(artifact.artifactId), artifact]),
      );
      for (const artifactId of dedupe(requestedArtifacts)) {
        const artifact = artifactsById.get(String(artifactId));
        if (artifact === undefined) {
          denials.push(
            deny("unknown-artifact", `information artifact ${String(artifactId)} does not exist`),
          );
        } else if (isInformationAvailable(artifact, request.asOf)) {
          visible.push(artifact.artifactId);
        } else {
          withheld.push(artifact.artifactId);
        }
      }
    }
  }

  return {
    bodyId: view.bodyId,
    worldId: view.worldId,
    asOf: request.asOf,
    kinds: grantedKinds as readonly BodyObservationKind[],
    instruments: grantedInstruments,
    visibleArtifacts: visible,
    withheldArtifacts: withheld,
    denials,
  };
}
