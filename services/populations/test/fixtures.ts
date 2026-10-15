/**
 * Shared deterministic fixtures for the W045 population tests — REAL
 * W044 bindings built through world-agent-runtime's OWN gates: the
 * commissioned bodies are built through body-forge's commissioning test
 * fixtures (REAL forged plans over the REAL extracted skills + W040
 * registry, REAL selections over the REAL benchmark catalogue — the
 * same zero-drift cross-package relative import W044 itself uses,
 * disclosed), the organization member through the W039 compiler's own
 * gate (W044's compiledPlanFixture), and every member bound through
 * bindAgent / bindOrganization against a world ADAPTED from W044's
 * bindingWorldDefinition with a four-seat participants + accounts
 * override (three founding seats + the addition seat; the per-seat
 * accounts mirror W044's seatAccount shape — the W032 attach proof
 * requires each body's account to be a declared world account). The
 * momentum substrate the fixtures select is the W040 registry's bearer,
 * so the deprecated/revoked momentum registry variants (re-exported
 * from W044's fixtures, themselves re-exporting body-forge's evidence)
 * realize the dead-endowment-capability transition refusals.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { Account, Participant } from "tradrl-world-contracts";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { forgeBody } from "body-forge";
import { commissionBody } from "body-forge/commissioning";
import type { CommissionedBody } from "body-forge/commissioning";
import { bindAgent, bindOrganization } from "world-agent-runtime";
import type { AgentBinding, OrganizationBinding, WorldAgentBinding } from "world-agent-runtime";
import { bodyRequirements, forgeComponents, selectionPlanFixture } from "../../body-forge/commissioning/test/fixtures.js";
import {
  GRANTED_AT,
  ORG_GRANT,
  ORG_POSITION,
  SCOPE,
  bindingWorldDefinition,
  compiledPlanFixture,
  deprecatedMomentumRegistry,
  grantsFor,
  registryFixture,
  revokedMomentumRegistry,
} from "../../world-agent-runtime/test/fixtures.js";

export { deprecatedMomentumRegistry, revokedMomentumRegistry, registryFixture, SCOPE, ORG_POSITION, GRANTED_AT };

interface Seat {
  readonly participantId: string;
  readonly accountId: string;
}

export const SEAT_A: Seat = { participantId: "participant-pop-exec-a", accountId: "account-pop-exec-a" };
export const SEAT_B: Seat = { participantId: "participant-pop-exec-b", accountId: "account-pop-exec-b" };
export const SEAT_D: Seat = { participantId: "participant-pop-exec-d", accountId: "account-pop-exec-d" };
export const SEAT_ORG: Seat = { participantId: "participant-pop-org", accountId: "account-pop-org" };
export const SEAT_GHOST: Seat = { participantId: "participant-pop-ghost", accountId: "account-pop-ghost" };

function seatParticipantOf(seat: Seat): Participant {
  return {
    participantId: seat.participantId as never,
    worldId: SCOPE.worldId as never,
    kind: "human",
    accountId: seat.accountId as never,
  };
}

/** The seat's account (W044's seatAccount shape, per-seat — the W032 attach proof requires a declared account). */
function seatAccountOf(accountId: string): Account {
  return {
    accountId: accountId as never,
    worldId: SCOPE.worldId as never,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

/** The founding world (W044's bindingWorldDefinition, participants + accounts overridden): three founding seats + the addition seat. */
export function populationWorldDefinition(): WorldDefinition {
  const seats = [SEAT_A, SEAT_B, SEAT_D, SEAT_ORG];
  return {
    ...bindingWorldDefinition({ participants: seats.map(seatParticipantOf) }),
    accounts: seats.map((seat) => seatAccountOf(seat.accountId)),
  };
}

/** A world that declares ONLY the ghost seat (for the unknown-member-slot refusal). */
export function ghostWorldDefinition(): WorldDefinition {
  return {
    ...bindingWorldDefinition({ participants: [seatParticipantOf(SEAT_GHOST)] }),
    accounts: [seatAccountOf(SEAT_GHOST.accountId)],
  };
}

/** Each agent seat's OWN backing grant (distinct per seat — one commissioned possession, one distinct W034 grant digest). */
function seatGrant(seat: Seat): typeof ORG_GRANT {
  return {
    grantedBy: "principal-pop-fixture" as typeof ORG_GRANT.grantedBy,
    channel: "commissioning",
    grantedAt: GRANTED_AT as typeof ORG_GRANT.grantedAt,
    basis: `the population fixture commissions seat ${seat.participantId} for the selected momentum substrate`,
  };
}

function commissionedAt(seat: Seat, bodyId: string, grant: typeof ORG_GRANT | undefined): CommissionedBody {
  const components = forgeComponents({
    bodyRequirements: bodyRequirements({
      participantId: seat.participantId as never,
      accountId: seat.accountId as never,
      bodyId: bodyId as never,
      grant: grant ?? seatGrant(seat),
    }),
  });
  const plan = forgeBody(components);
  if (!plan.ok) {
    throw new Error(`population fixture forging failed (${plan.errors.map((entry) => entry.code).join(", ")})`);
  }
  const outcome = commissionBody(plan.plan, selectionPlanFixture(), registryFixture());
  if (!outcome.ok) {
    throw new Error(`population fixture commissioning failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.body;
}

function agentBindingAt(seat: Seat, bodyId: string, world: WorldDefinition = populationWorldDefinition()): AgentBinding {
  const commissioned = commissionedAt(seat, bodyId, undefined);
  const outcome = bindAgent(world, commissioned, grantsFor(commissioned));
  if (!outcome.ok) {
    throw new Error(`population fixture agent binding failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.binding;
}

/** The org member: the compiled plan's seat commissioned on the org's issued grant. */
function organizationBinding(): OrganizationBinding {
  const commissioned = commissionedAt(SEAT_ORG, "body-pop-org-1", ORG_GRANT);
  const compiled = compiledPlanFixture(commissioned);
  const outcome = bindOrganization(populationWorldDefinition(), compiled, [commissioned], grantsFor(commissioned));
  if (!outcome.ok) {
    throw new Error(`population fixture organization binding failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.binding;
}

let cachedMembers: WorldAgentBinding[] | undefined;

/** The founding membership: two agent members + one organization member (deterministic). */
export function populationMembers(): WorldAgentBinding[] {
  cachedMembers ??= [
    agentBindingAt(SEAT_A, "body-pop-a-1"),
    agentBindingAt(SEAT_B, "body-pop-b-1"),
    organizationBinding(),
  ];
  return [...cachedMembers];
}

/** A fourth, not-yet-joined agent member (for the add transition). */
export function additionMember(): WorldAgentBinding {
  return agentBindingAt(SEAT_D, "body-pop-d-1");
}

/** A W044-valid binding whose seat this world never declared (for the founding slot refusal). */
export function ghostMember(): WorldAgentBinding {
  return agentBindingAt(SEAT_GHOST, "body-pop-ghost-1", ghostWorldDefinition());
}

/** The member binding ids of the founding membership (canonical after founding). */
export function foundingMemberIds(): string[] {
  return populationMembers().map((member) => String(member.bindingId)).sort();
}

/** A deeply-writable clone type (tampering a frozen record needs one; branded primitives pass through). */
export type Writable<T> =
  T extends string | number | boolean | bigint | symbol | null | undefined
    ? T
    : T extends (...args: never[]) => unknown
      ? T
      : T extends object
        ? { -readonly [K in keyof T]: Writable<T[K]> }
        : T;

/** A deep, unfrozen, writable clone of a sealed record (for the tamper laws). */
export function thaw<T>(value: T): Writable<T> {
  return structuredClone(value) as Writable<T>;
}
