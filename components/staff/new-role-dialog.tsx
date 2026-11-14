"use client";

import { useState } from "react";
import { useAppRouter as useRouter } from "@/lib/use-app-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { applyFieldErrors } from "@/components/settings/run-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/lib/use-action";
import { roleCreateSchema, type RoleCreateInput } from "@/lib/validation/staff";
import { createRoleAction } from "@/app/app/(shell)/staff/actions";

export function NewRoleDialog({ roles }: { roles: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction();
  const form = useForm<RoleCreateInput>({ resolver: zodResolver(roleCreateSchema), defaultValues: { name: "", copy_from: "" } });
  const { errors } = form.formState;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>Name it, then choose exactly what it can do on the next screen.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) =>
            run(() => createRoleAction(values), {
              success: "Role created",
              onSuccess: (role) => {
                setOpen(false);
                router.push(`/app/staff/roles/${role.id}`);
              },
              onError: (_e, fieldErrors) => applyFieldErrors(form.setError, fieldErrors),
            }),
          )}
        >
          <Field label="Role name" htmlFor="role-name" required error={errors.name?.message} hint="e.g. Supervisor, Accountant, Stock keeper">
            <Input id="role-name" autoFocus maxLength={60} {...form.register("name")} />
          </Field>
          <Field
            label="Copy permissions from"
            htmlFor="role-copy"
            error={errors.copy_from?.message}
            hint="Start from an existing role, then adjust. You can also start empty."
          >
            <NativeSelect id="role-copy" {...form.register("copy_from")}>
              <option value="">Start with no permissions</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <SubmitButton pending={pending}>Create role</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
