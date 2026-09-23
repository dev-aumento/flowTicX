import { z } from "zod";
import { PERMISSION_GROUPS } from "@contracts/permissions";
import { createRouter, adminQuery } from "./middleware";
import { ensureSchema } from "./lib/migrate";
import {
  getEmployeeDefaultPermissions,
  setEmployeeDefaultPermissions,
} from "./lib/employee-defaults";

export const permissionsRouter = createRouter({
  catalog: adminQuery.query(() => ({
    groups: PERMISSION_GROUPS,
  })),

  getEmployeeDefaults: adminQuery.query(async () => {
    await ensureSchema();
    return { permissions: await getEmployeeDefaultPermissions() };
  }),

  setEmployeeDefaults: adminQuery
    .input(z.object({ permissions: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      await ensureSchema();
      const permissions = await setEmployeeDefaultPermissions(input.permissions);
      return { permissions };
    }),
});
