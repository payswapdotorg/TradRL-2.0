/**
 * Inline replace-order editor — W010 (extracted from WorkingOrdersSurface
 * for the repo's 400-line law; zero behavior change).
 *
 * Renders the cancel/replace affordance for one working order: quantity +
 * the price(s) the order's kind actually carries (unset fields keep their
 * current values at the venue — the W003 ReplaceOrderCommand semantics).
 * The submit action issues the REAL command from the parent surface; this
 * component is presentation only.
 */

import { Button } from "@/components/ui/button.js";
import type { OrderRowModel } from "./orderLifecycle.js";

/** Editable replace state for one order (raw input text). */
export interface ReplaceEditorState {
  readonly orderId: string;
  readonly quantity: string;
  readonly limitPrice: string;
  readonly stopPrice: string;
}

/** Seed the editor from the engine's own order record. */
export function editorFor(row: OrderRowModel): ReplaceEditorState {
  return {
    orderId: row.order.orderId,
    quantity: row.order.quantity,
    limitPrice: row.order.limitPrice ?? "",
    stopPrice: row.order.stopPrice ?? "",
  };
}

function EditorField({
  label,
  value,
  disabled,
  title,
  dataField,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly title: string;
  readonly dataField: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
      <span className="w-10 shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        disabled={disabled}
        data-trading-world-replace-field={dataField}
        title={title}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 min-w-0 flex-1 rounded-sm border border-input-border bg-input px-2 font-mono text-ui-xs text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
        inputMode="decimal"
      />
    </label>
  );
}

/** The inline replace editor for one working order row. */
export function ReplaceOrderEditor({
  row,
  state,
  acting,
  onStateChange,
  onSubmit,
  onDismiss,
}: {
  readonly row: OrderRowModel;
  readonly state: ReplaceEditorState;
  readonly acting: boolean;
  readonly onStateChange: (next: ReplaceEditorState) => void;
  readonly onSubmit: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      data-trading-world-order-replace-editor=""
      className="flex flex-col gap-1 rounded-sm border border-border/50 bg-surface px-2 py-1.5"
    >
      <p className="text-ui-xs text-foreground-subtle">
        Replace {row.shortId} — unset fields keep their current values at the venue.
      </p>
      <EditorField
        label="Qty"
        value={state.quantity}
        disabled={false}
        title="new quantity (lot grid)"
        dataField="quantity"
        onChange={(quantity) => onStateChange({ ...state, quantity })}
      />
      <EditorField
        label="Limit"
        value={state.limitPrice}
        disabled={row.order.limitPrice === undefined}
        title={
          row.order.limitPrice === undefined
            ? "this order carries no limit price"
            : "new limit price (tick grid)"
        }
        dataField="limitPrice"
        onChange={(limitPrice) => onStateChange({ ...state, limitPrice })}
      />
      <EditorField
        label="Stop"
        value={state.stopPrice}
        disabled={row.order.stopPrice === undefined}
        title={
          row.order.stopPrice === undefined
            ? "this order carries no stop price"
            : "new stop price (tick grid)"
        }
        dataField="stopPrice"
        onChange={(stopPrice) => onStateChange({ ...state, stopPrice })}
      />
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          disabled={acting}
          data-trading-world-replace-submit=""
          onClick={onSubmit}
        >
          Submit replace
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-trading-world-replace-dismiss=""
          onClick={onDismiss}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
