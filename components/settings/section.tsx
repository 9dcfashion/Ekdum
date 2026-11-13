import { cn } from "@/lib/utils";

/** Title + description + optional actions for one settings page. */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A quiet box for explanations and help text. */
export function InfoBox({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-muted/30 p-3.5 text-sm", className)}>
      {title ? <p className="mb-1 font-medium">{title}</p> : null}
      <div className="text-muted-foreground [&_li]:mt-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_ul]:list-disc [&_ul]:pl-4">{children}</div>
    </div>
  );
}

/** A checkbox row with a title and a line of explanation. Works with react-hook-form's register(). */
export function CheckRow({
  title,
  hint,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "title"> & { title: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 accent-[var(--primary)]" {...props} />
      <span>
        {title}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function FormFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-7 flex flex-wrap items-center justify-end gap-3 border-t pt-5">{children}</div>;
}
