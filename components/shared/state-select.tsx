import * as React from "react";
import { PLACE_OF_SUPPLY_STATES, SELECTABLE_STATES } from "@/lib/gst/states";
import { NativeSelect } from "./field";

/** State / UT picker. `variant="supply"` also offers "Other Territory (97)". */
export function StateSelect({
  variant = "address",
  placeholder = "Select state",
  ...props
}: React.ComponentProps<"select"> & { variant?: "address" | "supply"; placeholder?: string }) {
  const states = variant === "supply" ? PLACE_OF_SUPPLY_STATES : SELECTABLE_STATES;
  return (
    <NativeSelect {...props}>
      <option value="">{placeholder}</option>
      {[...states]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => (
          <option key={s.code} value={s.code}>
            {s.name} ({s.code})
          </option>
        ))}
    </NativeSelect>
  );
}
