import QRCode from "qrcode";

/** PNG data URL of a QR code (used for UPI payment links on screen and on thermal slips). Null on failure. */
export async function qrDataUrl(text: string, width = 240): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width });
  } catch {
    return null;
  }
}
