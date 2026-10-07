/**
 * Participant contracts.
 *
 * Spec: spec/SIMULATION.md "Participants" — World Alpha may include
 * deterministic noise traders, liquidity takers, passive market makers and
 * momentum participants; "Participant code cannot bypass venue/account/risk
 * contracts."
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — human and AI traders use the same
 * World Protocol; headless parity. Every participant — human or endogenous —
 * terminates at the same typed CommandPort (WORLD-PROTOCOL.md "Human/agent
 * symmetry").
 */

import type { AccountId, ParticipantId, WorldId } from "./ids.js";

/**
 * Participant kinds. `human` is the trader; the rest are the deterministic
 * endogenous participants allowed in World Alpha (SIMULATION.md).
 */
export type ParticipantKind =
  | "human"
  | "noise-trader"
  | "liquidity-taker"
  | "passive-market-maker"
  | "momentum";

/**
 * A world participant. Participants act ONLY through the CommandPort; the
 * contracts package intentionally exposes no back door — venue/account/risk
 * contracts apply to every participant equally.
 */
export interface Participant {
  readonly participantId: ParticipantId;
  readonly worldId: WorldId;
  readonly kind: ParticipantKind;
  readonly displayName?: string;
  /** Account the participant trades through. */
  readonly accountId: AccountId;
}
