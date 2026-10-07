/**
 * The decision-stream validation laws (W033): a substrate producing
 * commands outside the body's embodiment is invalid; rate-envelope
 * breaches are typed; the auditability spine (digest citations, rationale
 * as data, declared confidence, deterministic identity/time) is enforced.
 *
 * Run: ../../node_modules/.bin/tsx --test test/validate.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createMeanReversionSubstrate,
  decisionStreamDigestOf,
  validateDecisionStream,
} from "../index.js";
import type { DecisionStream } from "../index.js";
import { INSTRUMENT, observedView, position, quote, substrateBody, trade, WORLD, SEAT, ACCOUNT } from "./fixtures.js";

const SUBSTRATE = createMeanReversionSubstrate({
  substrateId: "substrate-mr" as never,
  seed: "seed-mr",
  instrumentId: INSTRUMENT,
  threshold: "2",
  quantity: "1",
});

const AT = 1_700_000_000_000;

/** A lawful stream: the flat mind at the tape's low edge proposes a buy. */
function lawfulStream(): DecisionStream {
  const outcome = SUBSTRATE.decide({
    view: observedView({
      quotes: [quote("4795.50", "4796.00", AT)],
      trades: [trade("4794", AT, 1), trade("4798", AT, 2), trade("4798.50", AT, 3)],
      ownPositions: [position("0", AT)],
      asOf: AT as never,
    }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("fixture stream failed");
  return outcome.stream;
}

function codes(outcome: ReturnType<typeof validateDecisionStream>): readonly string[] {
  assert.equal(outcome.ok, false);
  if (outcome.ok) return [];
  return outcome.errors.map((one) => one.code);
}

test("a lawful stream validates ok against the body it acts through", () => {
  assert.deepEqual(validateDecisionStream(lawfulStream(), substrateBody(), SUBSTRATE.descriptor), {
    ok: true,
  });
});

test("a stream from another substrate or seed is invalid", () => {
  const foreign = lawfulStream();
  const other = { ...foreign, substrateId: "substrate-someone-else" as never };
  assert.deepEqual(codes(validateDecisionStream(other, substrateBody(), SUBSTRATE.descriptor)), [
    "substrate-mismatch",
  ]);
  const reseeded = { ...foreign, seed: "seed-not-mr" };
  assert.deepEqual(codes(validateDecisionStream(reseeded, substrateBody(), SUBSTRATE.descriptor)), [
    "seed-mismatch",
  ]);
});

test("commands outside the body's embodiment are invalid (never silently clipped)", () => {
  const base = lawfulStream();

  // a command kind the body does not embody
  const annotation = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          kind: "add-annotation" as const,
          commandId: base.decisions[0]!.command.commandId,
          worldId: WORLD,
          issuedBy: SEAT,
          issuedAt: AT as never,
          at: AT as never,
          text: "substrate annotation",
        },
      },
    ],
  };
  const annotationOutcome = validateDecisionStream(annotation, substrateBody(), SUBSTRATE.descriptor);
  assert.deepEqual(codes(annotationOutcome), ["command-kind-not-declared", "command-kind-not-in-embodiment"]);

  // an order kind outside the embodiment (stop-limit vs market/limit)
  const stopLimit = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          ...base.decisions[0]!.command,
          submission: {
            ...(base.decisions[0]!.command as { submission: object }).submission,
            kind: "stop-limit",
          },
        } as never,
      },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(stopLimit, substrateBody(), SUBSTRATE.descriptor)), [
    "order-kind-not-in-embodiment",
  ]);

  // a time-in-force outside the embodiment
  const fok = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          ...base.decisions[0]!.command,
          submission: {
            ...(base.decisions[0]!.command as { submission: object }).submission,
            constraints: { timeInForce: "FOK" },
          },
        } as never,
      },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(fok, substrateBody(), SUBSTRATE.descriptor)), [
    "time-in-force-not-in-embodiment",
  ]);

  // an instrument outside the embodiment
  const foreignInstrument = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        command: {
          ...base.decisions[0]!.command,
          instrumentId: "instrument-elsewhere" as never,
          submission: { ...(base.decisions[0]!.command as { submission: object }).submission },
        } as never,
      },
    ],
  };
  assert.deepEqual(
    codes(validateDecisionStream(foreignInstrument, substrateBody(), SUBSTRATE.descriptor)),
    ["instrument-not-in-embodiment"],
  );
});

test("identity laws: the command is issued by the body's own seat, world and account", () => {
  const base = lawfulStream();
  const bySomeoneElse = {
    ...base,
    decisions: [
      { ...base.decisions[0]!, command: { ...base.decisions[0]!.command, issuedBy: "participant-ghost" as never } },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(bySomeoneElse, substrateBody(), SUBSTRATE.descriptor)), [
    "issued-by-mismatch",
  ]);

  const otherWorld = {
    ...base,
    decisions: [
      { ...base.decisions[0]!, command: { ...base.decisions[0]!.command, worldId: "world-elsewhere" as never } },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(otherWorld, substrateBody(), SUBSTRATE.descriptor)), [
    "world-mismatch",
  ]);

  const otherAccount = {
    ...base,
    decisions: [
      { ...base.decisions[0]!, command: { ...base.decisions[0]!.command, accountId: "account-elsewhere" as never } },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(otherAccount, substrateBody(), SUBSTRATE.descriptor)), [
    "account-mismatch",
  ]);
});

test("the substrate cannot invent time: issuedAt must be the stream's asOf", () => {
  const base = lawfulStream();
  const invented = {
    ...base,
    decisions: [
      { ...base.decisions[0]!, command: { ...base.decisions[0]!.command, issuedAt: (AT + 5_000) as never } },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(invented, substrateBody(), SUBSTRATE.descriptor)), [
    "issued-at-mismatch",
  ]);
});

test("a rate-envelope breach is typed, with the count and the cap (never truncated)", () => {
  const base = lawfulStream();
  const doubled: DecisionStream = {
    ...base,
    decisions: [base.decisions[0]!, { ...base.decisions[0]! }],
  };
  const outcome = validateDecisionStream(doubled, substrateBody(), SUBSTRATE.descriptor);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const breach = outcome.errors.find((one) => one.code === "rate-envelope-breach");
  assert.notEqual(breach, undefined);
  assert.deepEqual(breach?.rate, { count: 2, max: 1 });
  // the duplicate id is ALSO loud (never silently deduped)
  assert.deepEqual(
    outcome.errors.filter((one) => one.code === "duplicate-decision-id").length,
    1,
  );
});

test("the auditability spine: digest citations, rationale as data, declared confidence", () => {
  const base = lawfulStream();
  const wrongDigest = {
    ...base,
    decisions: [{ ...base.decisions[0]!, viewDigest: "deadbeef" as never }],
  };
  assert.deepEqual(codes(validateDecisionStream(wrongDigest, substrateBody(), SUBSTRATE.descriptor)), [
    "view-digest-mismatch",
  ]);

  const noRationale = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        rationale: { rule: "", signals: [], explanation: "" },
      },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(noRationale, substrateBody(), SUBSTRATE.descriptor)), [
    "malformed-rationale",
  ]);

  const objectSignal = {
    ...base,
    decisions: [
      {
        ...base.decisions[0]!,
        rationale: {
          ...base.decisions[0]!.rationale,
          signals: [{ name: "blob", value: { deep: "object" } as never }],
        },
      },
    ],
  };
  assert.deepEqual(codes(validateDecisionStream(objectSignal, substrateBody(), SUBSTRATE.descriptor)), [
    "malformed-rationale",
  ]);

  for (const confidence of [Number.NaN, 1.5, -0.1, "high" as never]) {
    const bad = {
      ...base,
      decisions: [{ ...base.decisions[0]!, confidence }],
    };
    assert.deepEqual(codes(validateDecisionStream(bad, substrateBody(), SUBSTRATE.descriptor)), [
      "invalid-confidence",
    ]);
  }

  const blankId = {
    ...base,
    decisions: [{ ...base.decisions[0]!, decisionId: "" as never }],
  };
  assert.deepEqual(codes(validateDecisionStream(blankId, substrateBody(), SUBSTRATE.descriptor)), [
    "malformed-decision-id",
  ]);
});

test("decisionStreamDigestOf: the stream's own content address (A9)", () => {
  const first = lawfulStream();
  const again = lawfulStream();
  assert.equal(decisionStreamDigestOf(first), decisionStreamDigestOf(again));
  const mutated = { ...first, decisions: [] };
  assert.notEqual(decisionStreamDigestOf(first), decisionStreamDigestOf(mutated));
});

test("an empty stream from a valid view validates ok (no decisions is a lawful answer)", () => {
  const outcome = SUBSTRATE.decide({
    view: observedView({
      quotes: [quote("4799.75", "4800.25", AT)],
      trades: [trade("4790", AT, 1), trade("4800", AT, 2), trade("4810", AT, 3)],
      ownPositions: [position("0", AT)],
      asOf: AT as never,
    }),
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.stream.decisions.length, 0);
  assert.deepEqual(
    validateDecisionStream(outcome.stream, substrateBody(), SUBSTRATE.descriptor),
    { ok: true },
  );
  void ACCOUNT;
});
