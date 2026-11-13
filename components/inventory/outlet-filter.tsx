"use client";

import { NativeSelect } from "@/components/shared/field";
import { useListParams } from "@/components/shared/list-controls";

/** Outlet picker bound to the `outlet` URL param. Always shows the outlet in use, even when it is the default. */
export function OutletFilter({ outlets, value }: { outlets: Array<{ id: string; name: string }>; value: string }) {
  const { setParams } = useListParams();
  if (outlets.length < 2) return null;
  return (
    <NativeSelect aria-label="Outlet" value={value} onChange={(e) => setParams({ outlet: e.target.value })} className="w-auto min-w-36">
      {outlets.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </NativeSelect>
  );
}
