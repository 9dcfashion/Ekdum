import { z } from "zod";
import { MAX_RECEIPT_PHOTOS, SHIPMENT_STATUSES } from "@/lib/shipments";
import {
  isoDate,
  mobileOptional,
  optionalText,
  pincodeOptional,
  requiredText,
  rupeesOptional,
  stateCodeOptional,
  uuid,
  uuidOptional,
} from "./common";

/** Whole number typed into a text field with a numeric keypad. */
const wholeNumber = (label: string, max: number) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const s = String(v).trim();
    if (!/^\d{1,9}$/.test(s) || Number(s) < 1) {
      ctx.addIssue({ code: "custom", message: `${label} must be a whole number, 1 or more` });
      return z.NEVER;
    }
    if (Number(s) > max) {
      ctx.addIssue({ code: "custom", message: `${label} is too large` });
      return z.NEVER;
    }
    return Number(s);
  });

const wholeNumberOptional = (label: string, max: number) =>
  z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v, ctx) => {
      if (v === null || v === undefined || String(v).trim() === "") return null;
      const s = String(v).trim();
      if (!/^\d{1,9}$/.test(s) || Number(s) < 1) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number, 1 or more` });
        return z.NEVER;
      }
      if (Number(s) > max) {
        ctx.addIssue({ code: "custom", message: `${label} is too large` });
        return z.NEVER;
      }
      return Number(s);
    });

const photoPaths = z
  .array(z.string().min(1).max(300))
  .max(MAX_RECEIPT_PHOTOS, `You can attach up to ${MAX_RECEIPT_PHOTOS} photos`);

export const shipmentCreateSchema = z.object({
  invoice_id: uuidOptional,
  courier_partner_id: uuidOptional,
  tracking_number: optionalText(100),
  recipient_name: requiredText("Recipient name", 200),
  recipient_phone: mobileOptional,
  address_line1: optionalText(200),
  address_line2: optionalText(200),
  city: optionalText(100),
  pincode: pincodeOptional,
  state_code: stateCodeOptional,
  shipped_on: isoDate,
  package_count: wholeNumber("Number of packages", 9999),
  weight_grams: wholeNumberOptional("Weight", 10_000_000),
  declared_value: rupeesOptional("Declared value"),
  notes: optionalText(1000),
  receipt_photo_paths: photoPaths,
});
export type ShipmentCreateInput = z.input<typeof shipmentCreateSchema>;

export const shipmentStatusSchema = z.object({
  id: uuid,
  status: z.enum(SHIPMENT_STATUSES, "Pick a status"),
  note: optionalText(500),
});

export const shipmentDetailsSchema = z.object({
  id: uuid,
  courier_partner_id: uuidOptional,
  tracking_number: optionalText(100),
  notes: optionalText(1000),
});
export type ShipmentDetailsInput = z.input<typeof shipmentDetailsSchema>;

export const shipmentAddPhotosSchema = z.object({
  id: uuid,
  paths: photoPaths.min(1, "Add at least one photo"),
});

export const shipmentRemovePhotoSchema = z.object({
  id: uuid,
  path: z.string().min(1).max(300),
});

export const invoiceSearchSchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(32),
});
