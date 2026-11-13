"use client";

export interface OutletOption {
  id: string;
  name: string;
}

/** "All outlets" or a pick-list. Controlled; used by the invite form and the member editor. */
export function OutletAccessFields({
  idPrefix,
  outlets,
  allOutlets,
  outletIds,
  onChange,
  error,
}: {
  idPrefix: string;
  outlets: OutletOption[];
  allOutlets: boolean;
  outletIds: string[];
  onChange: (next: { allOutlets: boolean; outletIds: string[] }) => void;
  error?: string;
}) {
  function toggle(id: string, checked: boolean) {
    const next = checked ? [...new Set([...outletIds, id])] : outletIds.filter((o) => o !== id);
    onChange({ allOutlets: false, outletIds: next });
  }

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-medium">Outlet access</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          className="mt-0.5 accent-[var(--primary)]"
          checked={allOutlets}
          onChange={() => onChange({ allOutlets: true, outletIds })}
        />
        <span>
          All outlets
          <span className="block text-xs text-muted-foreground">Includes outlets you add later.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          className="mt-0.5 accent-[var(--primary)]"
          checked={!allOutlets}
          onChange={() => onChange({ allOutlets: false, outletIds })}
        />
        <span>Only selected outlets</span>
      </label>
      {!allOutlets ? (
        <div className="ml-6 grid max-h-44 gap-1.5 overflow-y-auto rounded-lg border p-2.5">
          {outlets.length === 0 ? <p className="text-xs text-muted-foreground">No outlets to choose from.</p> : null}
          {outlets.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={outletIds.includes(o.id)}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              {o.name}
            </label>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
