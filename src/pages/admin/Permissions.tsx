import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { trpc } from "@/providers/trpc";
import { PERMISSION_GROUPS } from "@contracts/permissions";
import { Loader2, Save, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export default function AdminPermissions() {
  const [selected, setSelected] = useState<string[]>([]);

  const { data, isLoading } = trpc.permissions.getEmployeeDefaults.useQuery();
  const utils = trpc.useUtils();

  const saveMutation = trpc.permissions.setEmployeeDefaults.useMutation({
    onSuccess: () => {
      utils.permissions.getEmployeeDefaults.invalidate();
    },
  });

  useEffect(() => {
    if (data?.permissions) {
      setSelected(data.permissions);
    }
  }, [data?.permissions]);

  function togglePermission(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F2937]">Permissions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Default access for new employees who join via invite link. These cover every area of the employee and project manager portal.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate({ permissions: selected })}
          disabled={saveMutation.isPending || isLoading}
          className="bg-[#2563EB] hover:bg-[#1D4ED8] gap-2"
        >
          {saveMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Save
        </Button>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <Info size={18} className="text-blue-500 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-blue-700 space-y-1">
          <p>
            These permissions apply automatically when a new employee registers through an invite link.
            Grant only what they should see: client tasks, clients, invoices, departments, leave, and so on.
          </p>
          <p>
            To change access for an existing employee or project manager, go to{" "}
            <strong>Employees</strong> and click the key icon on their row.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((group) => (
            <div
              key={group.id}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden"
            >
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h2 className="font-semibold text-[#1F2937]">{group.label}</h2>
              </div>
              <div className="p-4 space-y-3">
                {group.permissions.map((perm) => (
                  <label
                    key={perm.key}
                    className="flex items-start gap-3 cursor-pointer group"
                  >
                    <Checkbox
                      checked={selected.includes(perm.key)}
                      onCheckedChange={() => togglePermission(perm.key)}
                      className="mt-0.5"
                    />
                    <span className="text-sm text-gray-700 group-hover:text-gray-900">
                      {perm.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
