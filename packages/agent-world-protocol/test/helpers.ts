/**
 * The W035 test harness — the real-world attachments + the disciplined
 * drive (the W023 referenceRuntime pattern).
 *
 * Two attachments, both REAL:
 * - the compact protocol world: this suite's own deterministic definition
 *   (fixtures.ts — the W023 agent-world shape: the synthetic cast, the
 *   agent seat, declared risk limits, declared information artifacts)
 *   hosted by the REAL W018 in-process transport over the REAL W017
 *   generated engine — the engineAttachment.ts wiring verbatim; the
 *   definition is test-side (the W023 helpers precedent, disclosed);
 * - the REAL alpha world: `createAlphaEngineTransport` +
 *   `attachEngineWorldClient` — the EXACT composed binding the Trading
 *   World pane mounts (packages/ui/src/trading-world/runtime/
 *   engineAttachment.ts, consumed through the disclosed relative seam).
 */

import {
  attachEngineWorldClient,
  type EngineWorldClient,
} from "../../ui/src/trading-world/runtime/engineWorldClient.js";
import {
  alphaWorldDefinition,
  createAlphaEngineTransport,
} from "../../ui/src/trading-world/runtime/engineAttachment.js";
import { createInProcessWorldTransport } from "tradrl-world-sim/adapter";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { InformationArtifact, NewsPayload } from "tradrl-world-contracts";
import type { AgentSession } from "../index.js";
import { protocolWorldDefinition } from "./fixtures.js";

/** A wall-time source fixed at an arbitrary origin (determinism runs). */
export function fixedWallSource(at: number): () => number {
  return () => at;
}

/**
 * Attach the REAL provider over the compact protocol world: the W018
 * in-process transport hosting the W017 generated market — the
 * engineAttachment.ts wiring verbatim, with this suite's definition.
 */
export async function attachProtocolWorld(
  worldId: string,
  options: { readonly wallTimeSource?: () => number } = {},
): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: protocolWorldDefinition(worldId),
      createEngine: (engineOptions) =>
        createGeneratedWorldEngine({
          definition: engineOptions.definition,
          wallTimeSource: engineOptions.wallTimeSource,
          onPublished: engineOptions.onPublished,
        }),
      ...(options.wallTimeSource === undefined
        ? {}
        : { wallTimeSource: options.wallTimeSource as () => never }),
    }),
    expectedWorldId: worldId,
  });
}

/**
 * Attach the REAL alpha world — the EXACT Trading World pane binding:
 * `createAlphaEngineTransport` (the generated alpha market behind the W018
 * transport) + `attachEngineWorldClient`. The wall source is injectable
 * for the A9 twins (the W019 seam, forwarded verbatim).
 */
export async function attachAlphaWorld(
  worldId: string,
  wallAt: number,
): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createAlphaEngineTransport(worldId, {
      wallTimeSource: fixedWallSource(wallAt) as () => never,
    }),
    expectedWorldId: worldId,
  });
}

/**
 * The REAL alpha world with DECLARED information artifacts (the A7 alpha
 * case): the real definition plus an artifact list — the same transport
 * wiring `createAlphaEngineTransport` runs, with the augmented definition
 * (test-side wiring, the W023 helpers precedent, disclosed).
 */
export async function attachAlphaWorldWithArtifacts(
  worldId: string,
  wallAt: number,
  artifacts: readonly InformationArtifact<NewsPayload>[],
): Promise<EngineWorldClient> {
  const definition: WorldDefinition = {
    ...alphaWorldDefinition(worldId),
    informationArtifacts: artifacts,
  };
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition,
      createEngine: (engineOptions) =>
        createGeneratedWorldEngine({
          definition: engineOptions.definition,
          wallTimeSource: engineOptions.wallTimeSource,
          onPublished: engineOptions.onPublished,
        }),
      wallTimeSource: fixedWallSource(wallAt) as () => never,
    }),
    expectedWorldId: worldId,
  });
}

/** The disciplined drive: one step, one settle, N times (the W023 law). */
export async function driveSession(
  client: EngineWorldClient,
  session: AgentSession,
  steps: number,
  stepMs: number,
): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await client.clock.step(stepMs);
    await session.settle();
  }
}
