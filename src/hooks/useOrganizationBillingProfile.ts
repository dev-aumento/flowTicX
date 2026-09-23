import { trpc } from "@/providers/trpc";
import {
  resolveOrganizationProfileForInvoice,
  type OrganizationProfileForm,
} from "@/lib/organization-profile";

/** Server-backed org billing profile shared by admin and finance for invoices. */
export function useOrganizationBillingProfile(options?: { enabled?: boolean }) {
  const query = trpc.organization.getBillingProfile.useQuery(undefined, {
    enabled: options?.enabled !== false,
    staleTime: 60_000,
  });

  // Merge server + local cache so logos still show if only one side has them.
  const profile: OrganizationProfileForm | null = query.data
    ? resolveOrganizationProfileForInvoice(query.data)
    : query.isLoading
      ? null
      : resolveOrganizationProfileForInvoice(null);

  return {
    ...query,
    profile,
  };
}
