/** "+919812343210" → "98••••3210". Never shows the middle digits. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length < 7) return local.length > 0 ? "•".repeat(local.length) : "";
  return `${local.slice(0, 2)}${"•".repeat(local.length - 6)}${local.slice(-4)}`;
}

/** "ravi.kumar@gmail.com" → "r•••@gmail.com". */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  const at = value.lastIndexOf("@");
  if (at < 1) return value.length > 0 ? "•••" : "";
  return `${value.slice(0, 1)}•••${value.slice(at)}`;
}

export function maskRecipient(channel: "email" | "whatsapp", recipient: string | null | undefined): string {
  return channel === "email" ? maskEmail(recipient) : maskPhone(recipient);
}

/** A job claimed more than 10 minutes ago whose worker never reported back (same rule as the database). */
export function isStuckJob(job: { status: string; locked_at: string | null }, now: number): boolean {
  if (job.status !== "sending") return false;
  if (!job.locked_at) return true;
  return now - new Date(job.locked_at).getTime() > 10 * 60 * 1000;
}
