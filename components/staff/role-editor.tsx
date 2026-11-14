"use client";

import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, ShieldAlert, Trash2 } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { applyFieldErrors, runConfirm } from "@/components/settings/run-confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/lib/use-action";
import { ADMIN_PERMISSIONS, roleSaveSchema } from "@/lib/validation/staff";
import { deleteRoleAction, saveRoleAction } from "@/app/app/(shell)/staff/actions";

export interface PermissionOption {
  key: string;
  group_name: string;
  label: string;
}

type Values = z.input<typeof roleSaveSchema>;

export function RoleEditor({
  role,
  permissions,
  granted,
  memberCount,
}: {
  role: { id: string; name: string; is_system: boolean; system_key: string | null; max_discount_percent: number };
  /** From the permissions table, already in display order. */
  permissions: PermissionOption[];
  granted: string[];
  memberCount: number;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const isOwnerRole = role.system_key === "owner";
  const lockedPermissions = role.is_system;
  const form = useForm<Values>({
    resolver: zodResolver(roleSaveSchema),
    defaultValues: {
      role_id: role.id,
      name: role.name,
      max_discount_percent: String(role.max_discount_percent),
      permissions: granted,
    },
  });
  const { errors, isDirty } = form.formState;
  const selected = useWatch({ control: form.control, name: "permissions" });
  const selectedSet = new Set(selected);
  const initial = new Set(granted);
  const newlyGrantedAdmin = permissions.filter((p) => ADMIN_PERMISSIONS.includes(p.key) && selectedSet.has(p.key) && !initial.has(p.key));
  const canDiscount = selectedSet.has("sales.discount");

  // Groups in the order their first permission appears (the table's sort order).
  const groups: Array<{ name: string; items: PermissionOption[] }> = [];
  for (const p of permissions) {
    const group = groups.find((g) => g.name === p.group_name);
    if (group) group.items.push(p);
    else groups.push({ name: p.group_name, items: [p] });
  }

  function toggle(key: string, on: boolean) {
    const next = on ? [...new Set([...selected, key])] : selected.filter((k) => k !== key);
    form.setValue("permissions", next, { shouldDirty: true });
  }

  function setGroup(items: PermissionOption[], on: boolean) {
    const keys = items.map((i) => i.key);
    const next = on ? [...new Set([...selected, ...keys])] : selected.filter((k) => !keys.includes(k));
    form.setValue("permissions", next, { shouldDirty: true });
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) =>
        run(() => saveRoleAction(values), {
          success: "Role saved",
          onSuccess: () => form.reset(values),
          onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
        }),
      )}
    >
      {role.is_system ? (
        <div className="mb-5 flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p>
            {isOwnerRole
              ? "Owner is a built-in role with every permission. It cannot be changed."
              : "This is a built-in role. Its name and permissions are fixed; you can only change its discount limit. To change permissions, create a custom role and copy from this one."}
          </p>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Role name" htmlFor="name" required={!role.is_system} error={errors.name?.message}>
          <Input id="name" maxLength={60} disabled={role.is_system} {...form.register("name")} />
        </Field>
        <Field
          label="Maximum discount %"
          htmlFor="max_discount_percent"
          error={errors.max_discount_percent?.message}
          hint={
            canDiscount
              ? "The biggest discount this role can give on a bill. 0 means no discounts."
              : "Only used when “Give discounts” is switched on below."
          }
        >
          <Input
            id="max_discount_percent"
            inputMode="decimal"
            className="max-w-28 tabular"
            disabled={isOwnerRole}
            {...form.register("max_discount_percent")}
          />
        </Field>
      </div>

      <h2 className="mt-7 mb-1 text-base font-semibold">Permissions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {selected.length} of {permissions.length} switched on.
        {memberCount > 0 ? ` Changes apply at once to the ${memberCount} staff ${memberCount === 1 ? "member" : "members"} with this role.` : ""}
      </p>

      {newlyGrantedAdmin.length > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">You are giving this role admin powers</p>
            <ul className="mt-1 list-disc pl-4">
              {newlyGrantedAdmin.map((p) => (
                <li key={p.key}>
                  {p.label}
                  {p.key === "staff.manage"
                    ? ": they can invite people, change roles and deactivate staff."
                    : ": they can change GST details, bank details, invoice numbering and export all your data."}
                </li>
              ))}
            </ul>
            <p className="mt-1">Give these only to people you fully trust.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const allOn = group.items.every((i) => selectedSet.has(i.key));
          return (
            <div key={group.name} role="group" aria-label={`${group.name} permissions`} className="rounded-xl border p-3">
              <div className="mb-2 flex min-h-6 items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{group.name}</h3>
                {!lockedPermissions && group.items.length > 1 ? (
                  <Button type="button" variant="ghost" size="xs" onClick={() => setGroup(group.items, !allOn)}>
                    {allOn ? "Clear all" : "Select all"}
                  </Button>
                ) : null}
              </div>
              <ul className="grid gap-2.5">
                {group.items.map((p) => {
                  const id = `perm-${p.key}`;
                  return (
                    <li key={p.key} className="flex items-center justify-between gap-3">
                      <label htmlFor={id} className="text-sm">
                        {p.label}
                        {ADMIN_PERMISSIONS.includes(p.key) ? <span className="ml-1.5 text-xs text-amber-700">Admin</span> : null}
                      </label>
                      <Switch
                        id={id}
                        checked={selectedSet.has(p.key)}
                        disabled={lockedPermissions}
                        onCheckedChange={(on) => toggle(p.key, on)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        {!role.is_system ? (
          <ConfirmDialog
            trigger={
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive">
                <Trash2 aria-hidden /> Delete role
              </Button>
            }
            title={`Delete the role “${role.name}”?`}
            description={
              memberCount > 0
                ? `${memberCount} staff ${memberCount === 1 ? "member has" : "members have"} this role, so it cannot be deleted yet. Give them another role first.`
                : "This cannot be undone. Pending invites for this role are cancelled too."
            }
            confirmLabel="Delete role"
            destructive
            onConfirm={async () => {
              const done = await runConfirm(() => deleteRoleAction({ role_id: role.id }), "Role deleted");
              if (done) router.push("/app/staff/roles");
              return done;
            }}
          />
        ) : (
          <span />
        )}
        {isOwnerRole ? null : (
          <SubmitButton pending={pending} size="lg" disabled={pending || !isDirty}>
            Save role
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
