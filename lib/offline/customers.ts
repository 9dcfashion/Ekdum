/** Customer lookup against the local cache, matching the online search: name, phone digits or GSTIN. */
import type { PosCustomer } from "@/lib/pos/types";

export const CUSTOMER_CACHE_MAX = 5000;

export function matchCustomers(customers: PosCustomer[], query: string, limit = 8): PosCustomer[] {
  const term = query.trim().toLowerCase();
  if (term.length < 2) return [];
  const digits = term.replace(/\D/g, "");
  const phone = digits.length >= 3 ? digits.slice(-10) : null;
  const found: PosCustomer[] = [];
  for (const c of customers) {
    const hit =
      c.name.toLowerCase().includes(term) ||
      (!!c.gstin && c.gstin.toLowerCase().startsWith(term)) ||
      (!!phone && !!c.phone && c.phone.replace(/\D/g, "").includes(phone));
    if (hit) found.push(c);
  }
  return found.sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}
