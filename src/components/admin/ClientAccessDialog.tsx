import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserSearchSelect } from "@/components/tasks/UserSearchSelect";
import { isTaskAssignableUser } from "@/lib/leave-policy";

type ClientAccessUser = {
  id: number;
  name: string | null;
  email: string | null;
  clientCanViewTimeTracking?: boolean | null;
  clientCanViewDueDate?: boolean | null;
  assignedEmployeeIds?: number[] | null;
};

export function ClientAccessDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientAccessUser | null;
}) {
  const utils = trpc.useUtils();
  const [canViewTimeTracking, setCanViewTimeTracking] = useState(false);
  const [canViewDueDate, setCanViewDueDate] = useState(false);
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<number[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: employeesData } = trpc.user.listForPicker.useQuery(
    { limit: 500 },
    { enabled: open },
  );
  const employees = (employeesData?.users ?? []).filter(isTaskAssignableUser);

  useEffect(() => {
    if (!open || !client) return;
    setCanViewTimeTracking(client.clientCanViewTimeTracking === true);
    setCanViewDueDate(client.clientCanViewDueDate === true);
    setAssignedEmployeeIds(
      [...new Set((client.assignedEmployeeIds ?? []).map(Number).filter((id) => id > 0))],
    );
    setSaveError(null);
  }, [open, client]);

  const saveMutation = trpc.user.updateClientAccess.useMutation({
    onSuccess: async () => {
      await utils.user.listClients.invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      setSaveError(err.message || "Failed to save client access");
    },
  });

  function toggleEmployee(id: number) {
    setAssignedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((employeeId) => employeeId !== id) : [...prev, id],
    );
  }

  function handleSave() {
    if (!client) return;
    setSaveError(null);
    saveMutation.mutate({
      id: client.id,
      clientCanViewTimeTracking: canViewTimeTracking,
      clientCanViewDueDate: canViewDueDate,
      assignedEmployeeIds,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Client portal access</DialogTitle>
          <DialogDescription className="normal-case">
            {client?.name || client?.email || "This client"} will only see time tracking and due
            dates when those permissions are on. The assignee list in their portal is limited to
            the employees you assign here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <div className="space-y-3 rounded-xl border border-gray-200 p-4">
            <p className="text-sm font-semibold text-[#1F2937]">Visibility</p>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="client-time-tracking" className="text-sm font-normal text-gray-700">
                Time tracking visibility
              </Label>
              <Switch
                id="client-time-tracking"
                checked={canViewTimeTracking}
                onCheckedChange={setCanViewTimeTracking}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="client-due-date" className="text-sm font-normal text-gray-700">
                Due date visibility
              </Label>
              <Switch
                id="client-due-date"
                checked={canViewDueDate}
                onCheckedChange={setCanViewDueDate}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Assigned employees</Label>
            <p className="text-xs text-gray-500">
              Only these people appear in this client’s assignee list.
            </p>
            <UserSearchSelect
              mode="multi"
              users={employees}
              selected={assignedEmployeeIds}
              onToggle={toggleEmployee}
              placeholder="Select employees…"
              searchPlaceholder="Search employees…"
            />
          </div>

          {saveError ? <p className="text-sm text-red-500">{saveError}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!client || saveMutation.isPending}
              className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2"
            >
              {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
