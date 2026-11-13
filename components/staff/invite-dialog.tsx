"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { applyFieldErrors } from "@/components/settings/run-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { staffInviteSchema, type StaffInviteInput } from "@/lib/validation/staff";
import { inviteStaffAction } from "@/app/app/(shell)/staff/actions";
import { InviteLinkPanel, type InviteLinkResult } from "./invite-link";
import { OutletAccessFields, type OutletOption } from "./outlet-access";

export interface RoleOption {
  id: string;
  name: string;
  system_key: string | null;
}

export function InviteDialog({ roles, outlets }: { roles: RoleOption[]; outlets: OutletOption[] }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<InviteLinkResult | null>(null);
  const { run, pending } = useAction();
  const defaultRole = roles.find((r) => r.system_key === "cashier") ?? roles[0];
  const defaults: StaffInviteInput = { full_name: "", email: "", role_id: defaultRole?.id ?? "", all_outlets: true, outlet_ids: [] };
  const form = useForm<StaffInviteInput>({ resolver: zodResolver(staffInviteSchema), defaultValues: defaults });
  const { errors } = form.formState;
  const allOutlets = useWatch({ control: form.control, name: "all_outlets" });
  const outletIds = useWatch({ control: form.control, name: "outlet_ids" });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setResult(null);
      form.reset(defaults);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Invite staff
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{result ? "Invite created" : "Invite a staff member"}</DialogTitle>
          <DialogDescription>
            {result
              ? "They set their own password when they open the link."
              : "They get a link to join your business and set their own password."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <InviteLinkPanel result={result} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setResult(null)}>
                Invite another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) =>
              run(() => inviteStaffAction(values), {
                onSuccess: (data) => {
                  setResult(data);
                  form.reset({ ...defaults, role_id: values.role_id });
                },
                onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
              }),
            )}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="invite-name" error={errors.full_name?.message}>
                <Input id="invite-name" autoComplete="off" {...form.register("full_name")} />
              </Field>
              <Field label="Email" htmlFor="invite-email" required error={errors.email?.message}>
                <Input id="invite-email" type="email" autoComplete="off" autoCapitalize="none" {...form.register("email")} />
              </Field>
            </div>
            <Field label="Role" htmlFor="invite-role" required error={errors.role_id?.message} hint="You can change the role later.">
              <NativeSelect id="invite-role" {...form.register("role_id")}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <OutletAccessFields
              idPrefix="invite"
              outlets={outlets}
              allOutlets={allOutlets}
              outletIds={outletIds}
              onChange={(next) => {
                form.setValue("all_outlets", next.allOutlets, { shouldDirty: true });
                form.setValue("outlet_ids", next.outletIds, { shouldDirty: true });
                form.clearErrors("outlet_ids");
              }}
              error={errors.outlet_ids?.message}
            />
            <DialogFooter>
              <SubmitButton pending={pending} size="lg">
                Send invite
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
