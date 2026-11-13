/**
 * Held bills in the offline database, behind the same async interface the POS
 * already uses. Bills held earlier in localStorage are moved over once.
 */
import { createLocalParkedStore, MAX_PARKED_BILLS } from "@/lib/pos/parked";
import type { ParkedStore } from "@/lib/pos/types";
import type { OfflineRepo } from "./types";

const parkedImportKey = (outletId: string) => `parked.imported.${outletId}`;

/**
 * `scope` is the old localStorage scope (`${businessId}.${outletId}`).
 * If the database cannot be used at all, the POS falls back to localStorage.
 */
export function createOfflineParkedStore(repo: OfflineRepo, outletId: string, scope: string): ParkedStore {
  const legacy = createLocalParkedStore(scope);
  let imported: Promise<void> | null = null;

  const importOnce = () =>
    (imported ??= (async () => {
      if (await repo.getMeta<boolean>(parkedImportKey(outletId))) return;
      const old = await legacy.list();
      for (const bill of old) await repo.saveParked(outletId, bill);
      await repo.setMeta(parkedImportKey(outletId), true);
      // Only after every bill is safely in the database.
      try {
        window.localStorage.removeItem(`ekdum.pos.parked.${scope}`);
      } catch {
        // Storage blocked: the flag above already stops a second import.
      }
    })());

  let broken = false;
  const run = async <T>(viaDb: () => Promise<T>, viaLegacy: () => Promise<T>): Promise<T> => {
    if (broken) return viaLegacy();
    try {
      await importOnce();
    } catch {
      // The database is unusable (private window, quota): keep working from localStorage.
      broken = true;
      return viaLegacy();
    }
    return viaDb();
  };

  return {
    list: () => run(() => repo.listParked(outletId), legacy.list),
    save: (bill) =>
      run(async () => {
        const others = (await repo.listParked(outletId)).filter((b) => b.id !== bill.id);
        if (others.length >= MAX_PARKED_BILLS) {
          throw new Error(`You can hold at most ${MAX_PARKED_BILLS} bills. Finish or delete one first.`);
        }
        await repo.saveParked(outletId, bill);
      }, () => legacy.save(bill)),
    remove: (id) => run(() => repo.removeParked(outletId, id), () => legacy.remove(id)),
  };
}
