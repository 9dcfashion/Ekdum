import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsAppInvoiceMessage } from "./types";
import { EvolutionWhatsAppProvider, evolutionCaption, isPublicUrl } from "./whatsapp";

const KEY = "3F125318-8303-49DA-B4B5-D68F7FCC1808";

function message(overrides: Partial<WhatsAppInvoiceMessage> = {}): WhatsAppInvoiceMessage {
  return {
    to: "+91 98123 45678",
    customerName: "Anita Deshmukh",
    businessName: "Sharma Kirana",
    invoiceNumber: "A/2627/00042",
    amount: "₹2,360.00",
    pdfUrl: "https://shop.example/api/invoices/x/pdf?token=t",
    pdfFilename: "Invoice-A-2627-00042.pdf",
    publicToken: "t",
    publicUrl: "https://shop.example/i/t",
    pdf: Buffer.from("%PDF-fake"),
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const provider = () => new EvolutionWhatsAppProvider("https://evo.example", "Shop Main", KEY);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EvolutionWhatsAppProvider", () => {
  it("uploads the PDF as a document with the receipt caption", async () => {
    const fetchMock = mockFetch(201, { key: { id: "3EB0ABC", remoteJid: "919812345678@s.whatsapp.net" } });
    const result = await provider().sendInvoice(message());

    expect(result).toEqual({ ok: true, messageId: "3EB0ABC" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evo.example/message/sendMedia/Shop%20Main");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: KEY, "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      number: "919812345678",
      mediatype: "document",
      mimetype: "application/pdf",
      fileName: "Invoice-A-2627-00042.pdf",
      caption:
        "Hi Anita Deshmukh, thank you for shopping at Sharma Kirana.\n" +
        "Your bill A/2627/00042 for ₹2,360.00 is attached.\n\n" +
        "View bill: https://shop.example/i/t",
      media: Buffer.from("%PDF-fake").toString("base64"),
    });
  });

  it("treats a number without WhatsApp as permanent", async () => {
    mockFetch(400, {
      status: 400,
      error: "Bad Request",
      response: { message: [{ exists: false, jid: "919812345678@s.whatsapp.net", number: "919812345678" }] },
    });
    expect(await provider().sendInvoice(message())).toEqual({
      ok: false,
      error: "This number is not on WhatsApp",
      permanent: true,
    });
  });

  it("keeps configuration errors retryable and never echoes the key", async () => {
    mockFetch(401, { status: 401, error: "Unauthorized", response: { message: "Unauthorized" } });
    const unauthorised = await provider().sendInvoice(message());
    expect(unauthorised).toMatchObject({ ok: false, permanent: false });
    expect(unauthorised.error).toContain("EVOLUTION_API_KEY");
    expect(unauthorised.error).not.toContain(KEY);

    mockFetch(404, { status: 404, error: "Not Found", response: { message: ['The "Shop Main" instance does not exist'] } });
    expect(await provider().sendInvoice(message())).toMatchObject({ ok: false, permanent: false });
  });

  it("passes other server errors through as retryable", async () => {
    mockFetch(500, { status: 500, error: "Internal Server Error", response: { message: "Connection Closed" } });
    expect(await provider().sendInvoice(message())).toEqual({
      ok: false,
      error: "Evolution API returned 500: Connection Closed",
      permanent: false,
    });
  });

  it("turns a network failure into a retryable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    );
    expect(await provider().sendInvoice(message())).toEqual({ ok: false, error: "fetch failed" });
  });

  it("refuses obviously invalid numbers and a missing PDF without calling the API", async () => {
    const fetchMock = mockFetch(201, {});
    expect(await provider().sendInvoice(message({ to: "12345" }))).toMatchObject({ ok: false, permanent: true });
    expect(await provider().sendInvoice(message({ pdf: undefined }))).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("evolutionCaption", () => {
  it("leaves out the bill link when the app runs on a private address", () => {
    const caption = evolutionCaption(message({ publicUrl: "http://localhost:3000/i/t" }));
    expect(caption).toBe(
      "Hi Anita Deshmukh, thank you for shopping at Sharma Kirana.\nYour bill A/2627/00042 for ₹2,360.00 is attached.",
    );
  });
});

describe("isPublicUrl", () => {
  it.each([
    ["https://ekdum.nineagents.in/i/t", true],
    ["http://203.0.113.7:3000/i/t", true],
    ["http://localhost:3000/i/t", false],
    ["http://127.0.0.1:3000/i/t", false],
    ["http://192.168.1.20:3000/i/t", false],
    ["http://10.0.0.5/i/t", false],
    ["http://172.20.1.1/i/t", false],
    ["http://shop.local/i/t", false],
    ["not a url", false],
  ])("%s → %s", (url, expected) => {
    expect(isPublicUrl(url)).toBe(expected);
  });
});

describe("getWhatsAppProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("selects Evolution when its variables are set", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
    vi.stubEnv("EVOLUTION_API_URL", "https://evo.example/");
    vi.stubEnv("EVOLUTION_INSTANCE", "Shop");
    vi.stubEnv("EVOLUTION_API_KEY", KEY);
    const { getWhatsAppProvider } = await import("./whatsapp");
    const p = getWhatsAppProvider();
    expect(p.name).toBe("evolution");
    expect(p.attachesPdf).toBe(true);
  });

  it("falls back to the mock provider when a variable is missing", async () => {
    vi.stubEnv("WHATSAPP_PROVIDER", "evolution");
    vi.stubEnv("EVOLUTION_API_URL", "https://evo.example");
    vi.stubEnv("EVOLUTION_INSTANCE", "Shop");
    vi.stubEnv("EVOLUTION_API_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getWhatsAppProvider } = await import("./whatsapp");
    expect(getWhatsAppProvider().name).toBe("mock");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
