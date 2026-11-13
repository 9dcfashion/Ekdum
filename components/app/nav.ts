import {
  BarChart3,
  Boxes,
  Building2,
  LayoutDashboard,
  Package,
  ReceiptText,
  ScanBarcode,
  Settings,
  ShoppingBag,
  Truck,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown when the user has ANY of these permissions. */
  perms: Permission[];
  group: "Sell" | "Stock" | "People" | "Business";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard, perms: ["dashboard.view"], group: "Sell" },
  { href: "/app/pos", label: "Billing (POS)", icon: ScanBarcode, perms: ["sales.create"], group: "Sell" },
  { href: "/app/sales", label: "Sales", icon: ReceiptText, perms: ["sales.view_all", "sales.view_own"], group: "Sell" },
  { href: "/app/shipments", label: "Shipments", icon: Truck, perms: ["shipments.view"], group: "Sell" },
  { href: "/app/products", label: "Products", icon: Package, perms: ["products.view"], group: "Stock" },
  { href: "/app/inventory", label: "Inventory", icon: Boxes, perms: ["inventory.view"], group: "Stock" },
  { href: "/app/purchases", label: "Purchases", icon: ShoppingBag, perms: ["purchases.view"], group: "Stock" },
  { href: "/app/customers", label: "Customers", icon: UsersRound, perms: ["customers.view"], group: "People" },
  { href: "/app/vendors", label: "Vendors", icon: Building2, perms: ["vendors.manage", "purchases.view"], group: "People" },
  { href: "/app/staff", label: "Staff", icon: Users, perms: ["staff.manage"], group: "People" },
  { href: "/app/reports", label: "Reports", icon: BarChart3, perms: ["reports.view"], group: "Business" },
  { href: "/app/settings", label: "Settings", icon: Settings, perms: ["settings.manage"], group: "Business" },
];

export const NAV_GROUPS: NavItem["group"][] = ["Sell", "Stock", "People", "Business"];
