/**
 * Identity tests (W039): the canonical determinism laws.
 *
 * Run: pnpm --filter organization test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalJson,
  organizationIdOf,
  stableDigest,
} from "../identity.js";
import { organizationDefinition } from "./fixtures.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively (declaration order is irrelevant)", () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: [2, 1], c: true } }),
      canonicalJson({ a: { c: true, d: [2, 1] }, b: 1 }),
    );
  });

  it("keeps array order verbatim (callers canonicalize semantic order)", () => {
    assert.notEqual(canonicalJson(["a", "b"]), canonicalJson(["b", "a"]));
  });

  it("omits undefined-valued keys", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
  });
});

describe("stableDigest", () => {
  it("is deterministic for equal content", () => {
    assert.equal(stableDigest({ a: [1, 2] }), stableDigest({ a: [1, 2] }));
  });

  it("separates different content", () => {
    assert.notEqual(stableDigest({ a: 1 }), stableDigest({ a: 2 }));
  });
});

describe("organizationIdOf", () => {
  it("is org-<8 hex> (opaque, never parsed)", () => {
    assert.match(organizationIdOf(organizationDefinition()), /^org-[0-9a-f]{8}$/);
  });

  it("A9: same definition content, different declaration order ⇒ SAME id", () => {
    const forward = organizationDefinition();
    const shuffled = organizationDefinition({
      positions: [...forward.positions].reverse(),
      units: [...forward.units].reverse(),
      capabilities: [...forward.capabilities].reverse(),
      bindings: [...forward.bindings].reverse(),
    });
    assert.equal(organizationIdOf(forward), organizationIdOf(shuffled));
  });

  it("A9 twin: two independent builds of the same definition are identical", () => {
    const left = organizationIdOf(organizationDefinition());
    const right = organizationIdOf(organizationDefinition());
    assert.equal(left, right);
    assert.deepEqual(organizationDefinition(), organizationDefinition());
  });

  it("different content ⇒ different id", () => {
    const base = organizationDefinition();
    const renamed = organizationDefinition({
      displayName: "renamed organization",
    });
    assert.notEqual(organizationIdOf(base), organizationIdOf(renamed));
  });

  it("a binding's scope narrowing changes the identity (the whole definition is committed to)", () => {
    const base = organizationDefinition();
    const widened = organizationDefinition({
      bindings: base.bindings.map((binding) =>
        binding.scopeNarrowing === undefined ? binding : { ...binding, scopeNarrowing: undefined },
      ),
    });
    assert.notEqual(organizationIdOf(base), organizationIdOf(widened));
  });
});
