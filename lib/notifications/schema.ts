import { z } from "zod";
import { uuid } from "@/lib/validation/common";

/** "Send by email" form on the bill page. */
export const sendReceiptEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address")
    .max(254, "This email address is too long")
    .pipe(z.email("Enter a valid email address")),
});
export type SendReceiptEmailInput = z.input<typeof sendReceiptEmailSchema>;

export const sendReceiptSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("email"), invoiceId: uuid, email: sendReceiptEmailSchema.shape.email }),
  z.object({ channel: z.literal("whatsapp"), invoiceId: uuid }),
]);

export const retryReceiptSchema = z.object({ jobId: uuid, invoiceId: uuid });
