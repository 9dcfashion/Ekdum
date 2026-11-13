/**
 * Held ("parked") bills. The POS only knows the async `ParkedStore` interface;
 * this is the online implementation on top of localStorage. The offline module
 * can provide the same interface backed by Dexie.
 */
import type { CartState, ParkedBill, ParkedStore } from "./types";

export const MAX_PARKED_BILLS = 30;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isParkedBill(value: unknown): value is ParkedBill {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ParkedBill>;
  const cart = v.cart as Partial<CartState> | undefined;
  return (
    typeof v.id === "string" &&
    typeof v.parkedAt === "string" &&
    typeof v.totalPaise === "number" &&
    !!cart &&
    typeof cart.clientUuid === "string" &&
    Array.isArray(cart.lines)
  );
}

/** Build the summary row stored next to a held cart. */
export function toParkedBill(cart: CartState, totalPaise: number, parkedAt: Date = new Date()): ParkedBill {
  const c = cart.customer;
  return {
    id: cart.clientUuid,
    parkedAt: parkedAt.toISOString(),
    customerLabel: c ? c.name.trim() || c.phone.trim() || "Customer" : "Walk-in",
    itemCount: cart.lines.length,
    totalPaise,
    cart,
  };
}

/**
 * `scope` keeps bills of different businesses/outlets apart on a shared device,
 * e.g. `${businessId}.${outletId}`. Pass a storage for tests; defaults to window.localStorage.
 */
export function createLocalParkedStore(scope: string, storage?: StorageLike): ParkedStore {
  const key = `ekdum.pos.parked.${scope}`;
  const store = (): StorageLike | null => {
    if (storage) return storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null; // storage blocked (private mode, policy)
    }
  };

  const read = (): ParkedBill[] => {
    try {
      const raw = store()?.getItem(key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isParkedBill) : [];
    } catch {
      return [];
    }
  };

  const write = (bills: ParkedBill[]) => {
    const s = store();
    if (!s) throw new Error("This browser does not allow saving held bills");
    s.setItem(key, JSON.stringify(bills));
  };

  return {
    async list() {
      return read().sort((a, b) => b.parkedAt.localeCompare(a.parkedAt));
    },
    async save(bill) {
      const others = read().filter((b) => b.id !== bill.id);
      if (others.length >= MAX_PARKED_BILLS) {
        throw new Error(`You can hold at most ${MAX_PARKED_BILLS} bills. Finish or delete one first.`);
      }
      write([bill, ...others]);
    },
    async remove(id) {
      write(read().filter((b) => b.id !== id));
    },
  };
}
