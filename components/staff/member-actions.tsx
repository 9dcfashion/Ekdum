"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Field, NativeSelect } from "@/components/shared/field";
import { SubmitButton } from "@/components/shared/submit-button";
import { runConfirm } from "@/components/settings/run-confirm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAction } from "@/lib/use-action";
import { changeMemberRoleAction, setMemberActiveAction, setMemberOutletsAction } from "@/app/app/(shell)/staff/actions";
import type { RoleOption } from "./invite-dialog";
import { OutletAccessFields, type OutletOption } from "./outlet-access";

export interface MemberForActions {
  id: string;
  name: string;
  roleId: string;
  isOwner: boolean;
  isActive: boolean;
  isSelf: boolean;
  allOutlets: boolean;
  outletIds: string[];
}

function RoleDialog({ member, roles }: { member: MemberForActions; roles: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  const [roleId, setRoleId] = useState(member.roleId);
  const { run, pending } = useAction();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setRoleId(member.roleId);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Change role
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change role</DialogTitle>
          <DialogDescription>{member.name} gets the new permissions straight away.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => changeMemberRoleAction({ member_id: member.id, role_id: roleId }), {
              success: "Role changed",
              onSuccess: () => setOpen(false),
            });
          }}
        >
          <Field label="Role" htmlFor={`role-${member.id}`}>
            <NativeSelect id={`role-${member.id}`} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <SubmitButton pending={pending} disabled={pending || roleId === member.roleId}>
              Save role
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OutletsDialog({ member, outlets }: { member: MemberForActions; outlets: OutletOption[] }) {
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState({ allOutlets: member.allOutlets, outletIds: member.outletIds });
  const [error, setError] = useState<string | undefined>();
  const { run, pending } = useAction();
  // Outlets this member has that the current user cannot see are kept as they are.
  const visible = new Set(outlets.map((o) => o.id));
  const hidden = member.outletIds.filter((id) => !visible.has(id));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAccess({ allOutlets: member.allOutlets, outletIds: member.outletIds });
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Outlet access
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Outlet access</DialogTitle>
          <DialogDescription>Choose which outlets {member.name} can bill at and see.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const outletIds = [...new Set([...access.outletIds.filter((id) => visible.has(id)), ...hidden])];
            if (!access.allOutlets && outletIds.length === 0) {
              setError("Choose at least one outlet");
              return;
            }
            run(() => setMemberOutletsAction({ member_id: member.id, all_outlets: access.allOutlets, outlet_ids: outletIds }), {
              success: "Outlet access updated",
              onSuccess: () => setOpen(false),
            });
          }}
        >
          <OutletAccessFields
            idPrefix={`member-${member.id}`}
            outlets={outlets}
            allOutlets={access.allOutlets}
            outletIds={access.outletIds}
            onChange={(next) => {
              setAccess(next);
              setError(undefined);
            }}
            error={error}
          />
          {hidden.length > 0 && !access.allOutlets ? (
            <p className="text-xs text-muted-foreground">
              Access to {hidden.length} other {hidden.length === 1 ? "outlet" : "outlets"} that you cannot see is kept.
            </p>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending}>Save access</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemberActions({
  member,
  roles,
  outlets,
  viewerIsOwner,
}: {
  member: MemberForActions;
  /** Roles the viewer may assign (Owner is left out unless the viewer is an owner). */
  roles: RoleOption[];
  outlets: OutletOption[];
  viewerIsOwner: boolean;
}) {
  if (member.isSelf) return <span className="text-xs text-muted-foreground">This is you</span>;
  if (member.isOwner && !viewerIsOwner) return <span className="text-xs text-muted-foreground">Only an owner can change this</span>;

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {member.isActive ? (
        <>
          <RoleDialog member={member} roles={roles} />
          <OutletsDialog member={member} outlets={outlets} />
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                Deactivate
              </Button>
            }
            title={`Deactivate ${member.name}?`}
            description="This takes effect immediately: they are signed out of this business on their next click and cannot bill or see anything. Their past bills stay as they are. You can reactivate them at any time."
            confirmLabel="Deactivate"
            destructive
            onConfirm={() => runConfirm(() => setMemberActiveAction({ member_id: member.id, is_active: false }), `${member.name} was deactivated`)}
          />
        </>
      ) : (
        <ConfirmDialog
          trigger={
            <Button variant="outline" size="sm">
              Reactivate
            </Button>
          }
          title={`Reactivate ${member.name}?`}
          description="This takes effect immediately: they get back the same role and outlet access they had before."
          confirmLabel="Reactivate"
          onConfirm={() => runConfirm(() => setMemberActiveAction({ member_id: member.id, is_active: true }), `${member.name} was reactivated`)}
        />
      )}
    </div>
  );
}
