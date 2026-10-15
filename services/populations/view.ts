/**
 * The population aggregate view (W045) — the PURE projection of a
 * population's membership: per-capability coverage (what the population
 * can observe and do, read from the members' OWN W044 routing contracts
 * — carried verbatim, never re-scored), per-position fill (the W039
 * positions realized by organization members' seats), and the membership
 * census. Everything here is CARRIED DATA derived deterministically from
 * the members' own records: no measurement, no execution, no registry
 * read, no clock (A9), no re-scoring (the carry law — an aggregate view
 * that re-scored members would be a new authority source, and this
 * package owns none).
 *
 * A14: a view composes records; it never steps a world.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { WorldAgentBinding } from "world-agent-runtime";

/**
 * One per-capability coverage entry: a carried capability surface (the
 * observation kinds a member's W035 routing contract addresses, or the
 * command kinds its A13 authority channels open) and the member binding
 * ids that cover it, in canonical binding-id order.
 */
export interface CapabilityCoverageEntry {
  /** Which routing surface the carried capability lives on. */
  readonly surface: "observation" | "command";
  /** The carried kind itself (a W035 observation kind or a body command kind, as the members carry it). */
  readonly capability: string;
  /** The member binding ids covering it (canonical order). */
  readonly members: readonly string[];
}

/** One per-position fill entry: a W039 position realized by organization members' seats. */
export interface PositionFillEntry {
  /** The W039 position id, as carried by an organization member's seat. */
  readonly positionId: string;
  /** The organization member binding ids whose seats fill the position. */
  readonly members: readonly string[];
  /** The commissioned ids seated at the position, in the members' canonical seat order. */
  readonly seats: readonly string[];
}

/** The membership census: counts and per-surface rosters, all carried. */
export interface MembershipCensus {
  readonly memberCount: number;
  readonly agentMembers: number;
  readonly organizationMembers: number;
  /** Per participant kind (the W023 closed vocabulary, as carried by the members' slots): the occupying member ids. */
  readonly participantKinds: readonly { readonly kind: string; readonly members: readonly string[] }[];
  /** Per substrate surface (the W033 minds): the member ids riding on it. */
  readonly substrates: readonly { readonly substrateId: string; readonly members: readonly string[] }[];
  /** The count of DISTINCT W034 grant digests backing the membership's authority channels (A13). */
  readonly authorityGrants: number;
}

/** The aggregate view of one population — typed DATA, all carried. */
export interface PopulationView {
  readonly capabilityCoverage: readonly CapabilityCoverageEntry[];
  readonly positionFill: readonly PositionFillEntry[];
  readonly census: MembershipCensus;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The observation kinds one member covers (its W035 routing contract, verbatim). */
function observationKindsOf(member: WorldAgentBinding): string[] {
  if (member.kind === "agent") {
    return member.observation.config.kinds.map(String);
  }
  return [...new Set(member.seats.flatMap((seat) => seat.observation.config.kinds.map(String)))];
}

/** The command kinds one member covers (its A13 authority channels, verbatim). */
function commandKindsOf(member: WorldAgentBinding): string[] {
  if (member.kind === "agent") {
    return member.action.channels.map((channel) => String(channel.commandKind));
  }
  return [...new Set(member.seats.flatMap((seat) => seat.action.channels.map((channel) => String(channel.commandKind))))];
}

/** The participant slots one member occupies (as carried). */
function slotKindsOf(member: WorldAgentBinding): string[] {
  if (member.kind === "agent") {
    return [String(member.slot.kind)];
  }
  return member.seats.map((seat) => String(seat.slot.kind));
}

/** The substrate surfaces one member rides on (as carried). */
function substrateIdsOf(member: WorldAgentBinding): string[] {
  if (member.kind === "agent") {
    return [String(member.substrateId)];
  }
  return [...new Set(member.seats.map((seat) => String(seat.substrateId)))];
}

/** The W034 grant digests backing one member's authority channels (as carried). */
function grantDigestsOf(member: WorldAgentBinding): string[] {
  return member.lineage.grantDigests.map(String);
}

/** Group member ids by a per-member key projection: entries key-sorted, every bucket in canonical binding-id order (input-order independent — A9). */
function groupBy(
  members: readonly WorldAgentBinding[],
  keysOf: (member: WorldAgentBinding) => readonly string[],
): { readonly key: string; readonly members: readonly string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const member of members) {
    for (const key of keysOf(member)) {
      const bucket = buckets.get(key) ?? [];
      bucket.push(String(member.bindingId));
      buckets.set(key, bucket);
    }
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({ key, members: list.sort(compareStrings) }))
    .sort((left, right) => compareStrings(left.key, right.key));
}

/**
 * THE PURE AGGREGATE PROJECTION: the view of a membership, derived
 * deterministically from the members' own records alone. Founding and
 * every transition seal this projection INTO the record as carried data;
 * ./validate.ts re-derives it and refuses any drift (the carry law).
 */
export function membersView(members: readonly WorldAgentBinding[]): PopulationView {
  const coverage: CapabilityCoverageEntry[] = [
    ...groupBy(members, commandKindsOf).map((entry) => ({ surface: "command" as const, capability: entry.key, members: entry.members })),
    ...groupBy(members, observationKindsOf).map((entry) => ({ surface: "observation" as const, capability: entry.key, members: entry.members })),
  ].sort((left, right) =>
    compareStrings(left.surface, right.surface) !== 0
      ? compareStrings(left.surface, right.surface)
      : compareStrings(left.capability, right.capability),
  );

  const positionBuckets = new Map<string, { memberId: string; commissionedId: string }[]>();
  for (const member of members) {
    if (member.kind !== "organization") {
      continue;
    }
    for (const seat of member.seats) {
      const positionId = String(seat.positionId);
      const bucket = positionBuckets.get(positionId) ?? [];
      bucket.push({ memberId: String(member.bindingId), commissionedId: String(seat.commissionedId) });
      positionBuckets.set(positionId, bucket);
    }
  }
  const positionFill: PositionFillEntry[] = [...positionBuckets.entries()]
    .map(([positionId, bucket]) => {
      const pairs = bucket.sort((left, right) =>
        compareStrings(left.memberId, right.memberId) !== 0
          ? compareStrings(left.memberId, right.memberId)
          : compareStrings(left.commissionedId, right.commissionedId),
      );
      return { positionId, members: pairs.map((pair) => pair.memberId), seats: pairs.map((pair) => pair.commissionedId) };
    })
    .sort((left, right) => compareStrings(left.positionId, right.positionId));

  const grants = new Set<string>();
  for (const member of members) {
    for (const digest of grantDigestsOf(member)) {
      grants.add(digest);
    }
  }

  return {
    capabilityCoverage: coverage,
    positionFill,
    census: {
      memberCount: members.length,
      agentMembers: members.filter((member) => member.kind === "agent").length,
      organizationMembers: members.filter((member) => member.kind === "organization").length,
      participantKinds: groupBy(members, slotKindsOf).map((entry) => ({ kind: entry.key, members: entry.members })),
      substrates: groupBy(members, substrateIdsOf).map((entry) => ({ substrateId: entry.key, members: entry.members })),
      authorityGrants: grants.size,
    },
  };
}
