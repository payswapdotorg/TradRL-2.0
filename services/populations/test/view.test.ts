/**
 * The W045 aggregate view laws — the pure projection over REAL members:
 * per-capability coverage (carried from the members' own W044 routing
 * contracts), per-position fill (the W039 seats), the membership census
 * — canonical-id ordered, input-order independent, carry-never-rescore.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { membersView } from "../view.js";
import { populationMembers } from "./fixtures.js";

test("the census counts the members, their kinds, their substrates and their authority grants", () => {
  const members = populationMembers();
  const view = membersView(members);
  assert.equal(view.census.memberCount, 3);
  assert.equal(view.census.agentMembers, 2);
  assert.equal(view.census.organizationMembers, 1);
  // all fixture bodies ride the same selected momentum substrate — one entry, three members
  assert.equal(view.census.substrates.length, 1);
  assert.equal(view.census.substrates[0]!.members.length, 3);
  assert.equal(view.census.participantKinds.length, 1);
  assert.equal(view.census.participantKinds[0]!.kind, "human");
  assert.equal(view.census.participantKinds[0]!.members.length, 3);
  // three distinct commissioned possessions ⇒ three distinct backing grant digests
  assert.equal(view.census.authorityGrants, 3);
});

test("the per-capability coverage carries the members' own routing kinds", () => {
  const members = populationMembers();
  const view = membersView(members);
  const observation = view.capabilityCoverage.filter((entry) => entry.surface === "observation");
  const command = view.capabilityCoverage.filter((entry) => entry.surface === "command");
  assert.deepEqual(observation.map((entry) => entry.capability), ["market-quote", "own-portfolio"]);
  assert.deepEqual(command.map((entry) => entry.capability), ["close-position", "submit-order"]);
  for (const entry of view.capabilityCoverage) {
    assert.equal(entry.members.length, 3, `every member covers ${String(entry.surface)}:${entry.capability}`);
    const ids = [...entry.members];
    assert.deepEqual([...ids].sort(), ids, "coverage member lists are canonical-id ordered");
  }
});

test("the per-position fill carries the organization member's W039 seats", () => {
  const members = populationMembers();
  const view = membersView(members);
  assert.equal(view.positionFill.length, 1);
  const fill = view.positionFill[0]!;
  assert.ok(String(fill.positionId).startsWith("position-"));
  assert.equal(fill.members.length, 1);
  assert.equal(fill.seats.length, 1);
  const org = members.find((member) => member.kind === "organization");
  assert.ok(org !== undefined);
  assert.equal(fill.members[0], String(org.bindingId));
});

test("the projection is pure: input order never matters (A9)", () => {
  const members = populationMembers();
  assert.deepEqual(membersView(members), membersView([...members].reverse()));
});

test("the projection carries counts, never re-scores (a dropped member just disappears)", () => {
  const members = populationMembers();
  const full = membersView(members);
  const reduced = membersView(members.slice(0, 2));
  assert.equal(full.census.memberCount, 3);
  assert.equal(reduced.census.memberCount, 2);
  assert.equal(reduced.positionFill.length, 0, "the organization member's fill disappears with the member");
  for (const entry of reduced.capabilityCoverage) {
    assert.equal(entry.members.length, 2);
  }
  assert.equal(reduced.census.authorityGrants, 2);
});

test("entries are key-sorted (canonical-id ordering)", () => {
  const view = membersView(populationMembers());
  const keys = view.capabilityCoverage.map((entry) => `${String(entry.surface)}:${entry.capability}`);
  assert.deepEqual([...keys].sort(), keys);
  const positions = view.positionFill.map((entry) => entry.positionId);
  assert.deepEqual([...positions].sort(), positions);
  const kinds = view.census.participantKinds.map((entry) => entry.kind);
  assert.deepEqual([...kinds].sort(), kinds);
});
