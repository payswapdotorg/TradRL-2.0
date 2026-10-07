/**
 * The composed pre-trade seam (W015 `risk` module): the single function the
 * world lifecycle calls between `authorize` and the W014 matching seam —
 * account acceptance first, then the risk gate (the documented order; both
 * are A13 runtime controls that no participant can route around).
 *
 * Rejections are typed `CommandRejection` values with the W003
 * OrderRejectionReason codes ("insufficient-buying-power", "risk-limit");
 * the risk message cites the failing gate, its limit and the requested
 * value (R024: the runtime authority's evidence). Nothing is journaled and
 * no state mutates — the command stream hash already covers rejected
 * commands deterministically.
 */

import type { CommandRejection } from "tradrl-world-contracts";
import type { BookState } from "../orderbook/index.js";
import type { PositionRecord } from "../portfolio/index.js";
import { checkOrderAcceptance } from "../account/index.js";
import type { AccountFinancials, AccountLedger } from "../account/index.js";
import { runPreTradeRiskGate, type RiskGateInput } from "./gate.js";
import type { RiskRuntimeState } from "./state.js";

/**
 * Run the account acceptance check then the risk gate for one submission.
 * Returns the typed rejection, or undefined when the submission may
 * proceed to the venue.
 */
export function runPreTradeChecks(input: {
  readonly ledger: AccountLedger;
  readonly financials: AccountFinancials;
  readonly positions: readonly PositionRecord[];
  readonly risk: RiskRuntimeState;
  readonly book: BookState;
  readonly order: RiskGateInput;
}): CommandRejection | undefined {
  const acceptance = checkOrderAcceptance({
    ledger: input.ledger,
    financials: input.financials,
    positions: input.positions,
    book: input.book,
    order: {
      accountId: input.order.accountId as never,
      instrumentId: input.order.instrumentId as never,
      kind: input.order.kind,
      side: input.order.side,
      quantity: input.order.quantity,
      ...(input.order.limitPrice === undefined ? {} : { limitPrice: input.order.limitPrice }),
      ...(input.order.stopPrice === undefined ? {} : { stopPrice: input.order.stopPrice }),
    },
  });
  if (!acceptance.accepted) {
    return {
      stage: "domain-rules",
      code: acceptance.code,
      message: acceptance.message,
    };
  }
  const gate = runPreTradeRiskGate({
    risk: input.risk,
    financials: input.financials,
    leverage: input.ledger.leverage,
    positions: input.positions,
    book: input.book,
    order: input.order,
  });
  if (!gate.passed && gate.failure !== undefined) {
    return {
      stage: "domain-rules",
      code: "risk-limit",
      message:
        `risk gate ${gate.failure.gate} refused the order: ${gate.failure.message} ` +
        `(limit ${gate.failure.limit}, requested ${gate.failure.requested})`,
    };
  }
  return undefined;
}
