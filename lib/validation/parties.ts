import { z } from "zod";
import {
  addressFields,
  emailOptional,
  gstinOptional,
  mobileOptional,
  optionalText,
  phoneLooseOptional,
  requiredText,
  stateCodeOptional,
} from "./common";

/**
 * Customers and vendors ("parties"). Shared by the back-office forms and their
 * Server Actions; other modules (POS quick-add, purchases) can reuse them.
 */

interface GstinAndState {
  gstin: string | null;
  state_code: string | null;
}

/** A GSTIN is registered in one state: its first two digits must agree with the chosen state. */
function checkGstinState(value: GstinAndState, ctx: z.RefinementCtx) {
  if (value.gstin && value.state_code && value.gstin.slice(0, 2) !== value.state_code) {
    ctx.addIssue({
      code: "custom",
      path: ["state_code"],
      message: "State does not match the GSTIN (its first two digits are the state code)",
    });
  }
}

/** When a GSTIN is given without a state, take the state from the GSTIN. */
function fillStateFromGstin<T extends GstinAndState>(value: T): T {
  return value.gstin && !value.state_code ? { ...value, state_code: value.gstin.slice(0, 2) } : value;
}

export const customerSchema = z
  .object({
    name: requiredText("Customer name", 200),
    phone: mobileOptional,
    email: emailOptional,
    gstin: gstinOptional,
    ...addressFields,
    state_code: stateCodeOptional,
    notes: optionalText(1000),
    whatsapp_opt_in: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    checkGstinState(value, ctx);
    if (value.whatsapp_opt_in && !value.phone) {
      ctx.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Add a mobile number to send bills on WhatsApp",
      });
    }
  })
  .transform(fillStateFromGstin);

export type CustomerInput = z.input<typeof customerSchema>;
export type CustomerData = z.output<typeof customerSchema>;

export const vendorSchema = z
  .object({
    name: requiredText("Vendor name", 200),
    gstin: gstinOptional,
    phone: phoneLooseOptional,
    email: emailOptional,
    ...addressFields,
    state_code: stateCodeOptional,
    notes: optionalText(1000),
    is_active: z.boolean().default(true),
  })
  .superRefine(checkGstinState)
  .transform(fillStateFromGstin);

export type VendorInput = z.input<typeof vendorSchema>;
export type VendorData = z.output<typeof vendorSchema>;
