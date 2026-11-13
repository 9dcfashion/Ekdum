"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toCsv } from "@/lib/list";
import { formatINR } from "@/lib/money";
import {
  IMPORT_CHUNK_SIZE,
  IMPORT_COLUMNS,
  IMPORT_COLUMN_LABELS,
  IMPORT_MAX_ROWS,
  IMPORT_TEMPLATE_EXAMPLE,
  chunkRows,
  countNewAndUpdates,
  mapHeaders,
  toRawRows,
  validateImportRows,
  type ImportRefs,
  type ImportRowError,
  type ImportRowResult,
  type ParsedImportRow,
  type RawImportRow,
} from "@/lib/products/import";
import { getExistingSkusAction, importProductsChunkAction } from "@/app/app/(shell)/products/actions";

const PREVIEW_ROWS = 10;
const ERROR_ROWS_SHOWN = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadTemplate() {
  downloadCsv(
    "ekdum-products-template.csv",
    toCsv([...IMPORT_COLUMNS], [IMPORT_COLUMNS.map((c) => IMPORT_TEMPLATE_EXAMPLE[c])]),
  );
}

function parseFile(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (results) => resolve(results.data),
      error: (error) => reject(error),
    });
  });
}

interface Review {
  fileName: string;
  totalRows: number;
  valid: ParsedImportRow[];
  /** Raw cells of the valid rows, sent to the server (which validates them again). */
  rawValid: RawImportRow[];
  errors: ImportRowError[];
  invalidRowCount: number;
  unknownHeaders: string[];
  existingSkus: Set<string>;
  toCreate: number;
  toUpdate: number;
  hasOpeningStock: boolean;
  hasPurchasePrice: boolean;
}

type Stage =
  | { name: "choose"; error: string | null; reading: boolean }
  | { name: "review"; review: Review }
  | { name: "importing"; review: Review; done: number }
  | { name: "done"; review: Review; results: ImportRowResult[] };

export function ImportWizard({
  refs,
  canViewCost,
  outletName,
  chargesTax,
}: {
  refs: ImportRefs;
  canViewCost: boolean;
  outletName: string | null;
  chargesTax: boolean;
}) {
  const [stage, setStage] = useState<Stage>({ name: "choose", error: null, reading: false });
  const fileInput = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    const failWith = (error: string) => setStage({ name: "choose", error, reading: false });
    setStage({ name: "choose", error: null, reading: true });

    if (file.size > MAX_FILE_BYTES) return failWith("This file is too large. Keep it under 5 MB.");
    let lines: string[][];
    try {
      lines = await parseFile(file);
    } catch {
      return failWith("Could not read this file. Save your spreadsheet as CSV and try again.");
    }
    if (lines.length === 0) return failWith("This file is empty.");

    const mapping = mapHeaders(lines[0].map((h) => String(h ?? "")));
    if (mapping.missing.length > 0) {
      return failWith(
        `The first row must have column headings, and these are missing: ${mapping.missing.join(", ")}. Download the template to see the format.`,
      );
    }
    const rows = toRawRows(mapping, lines.slice(1));
    if (rows.length === 0) return failWith("There are no product rows under the headings.");
    if (rows.length > IMPORT_MAX_ROWS) {
      return failWith(
        `This file has ${rows.length.toLocaleString("en-IN")} rows. Import at most ${IMPORT_MAX_ROWS.toLocaleString("en-IN")} at a time: split it into smaller files.`,
      );
    }

    const validation = validateImportRows(rows, refs);

    let existingSkus = new Set<string>();
    try {
      const existing = await getExistingSkusAction();
      if (!existing.ok) return failWith(existing.error);
      existingSkus = new Set(existing.data);
    } catch {
      return failWith("Could not reach the server. Check your connection and try again.");
    }

    const validRowNumbers = new Set(validation.valid.map((r) => r.row));
    const counts = countNewAndUpdates(validation.valid, existingSkus);
    setStage({
      name: "review",
      review: {
        fileName: file.name,
        totalRows: rows.length,
        valid: validation.valid,
        rawValid: rows.filter((r) => validRowNumbers.has(r.row)),
        errors: validation.errors,
        invalidRowCount: validation.invalidRowCount,
        unknownHeaders: [...mapping.unknown, ...mapping.duplicates.map((c) => `${c} (repeated)`)],
        existingSkus,
        toCreate: counts.toCreate,
        toUpdate: counts.toUpdate,
        hasOpeningStock: validation.valid.some((r) => r.opening_stock !== null && Number(r.opening_stock) > 0),
        hasPurchasePrice: validation.valid.some((r) => r.purchase_price_paise !== null),
      },
    });
  }

  async function commit(review: Review) {
    const chunks = chunkRows(review.rawValid, IMPORT_CHUNK_SIZE);
    const results: ImportRowResult[] = [];
    setStage({ name: "importing", review, done: 0 });

    let stopReason: string | null = null;
    for (const chunk of chunks) {
      if (stopReason) {
        for (const r of chunk) results.push({ row: r.row, status: "failed", message: `Not imported. ${stopReason}` });
        continue;
      }
      try {
        const response = await importProductsChunkAction({ rows: chunk, total: review.rawValid.length });
        if (response.ok) results.push(...response.data.results);
        else {
          stopReason = response.error;
          for (const r of chunk) results.push({ row: r.row, status: "failed", message: response.error });
        }
      } catch {
        stopReason = "Could not reach the server. Check your connection and try again.";
        for (const r of chunk) results.push({ row: r.row, status: "failed", message: stopReason });
      }
      setStage({ name: "importing", review, done: results.length });
    }
    results.sort((a, b) => a.row - b.row);
    setStage({ name: "done", review, results });
  }

  function reset() {
    if (fileInput.current) fileInput.current.value = "";
    setStage({ name: "choose", error: null, reading: false });
  }

  if (stage.name === "choose") {
    return (
      <div className="grid gap-4">
        <section className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold">1. Get the template</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Fill one product per row. Only name and sale_price are required. Keep the first row of headings as it is.
          </p>
          <Button variant="outline" className="mt-3" onClick={downloadTemplate}>
            <Download aria-hidden /> Download template
          </Button>
          <ul className="mt-4 grid gap-1 text-xs text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">sku</span>: a row whose SKU already exists updates that
              product. Other rows add a new product.
            </li>
            <li>
              <span className="font-medium text-foreground">gst_rate</span>: one of{" "}
              {[...refs.gstRates].sort((a, b) => a - b).join(", ")}.{" "}
              {chargesTax ? "" : "Tax is not charged on your bills right now, but the rate is saved for later."}
            </li>
            <li>
              <span className="font-medium text-foreground">unit_code</span>: a unit code such as{" "}
              {refs.units
                .slice(0, 6)
                .map((u) => u.code)
                .join(", ")}
              . Blank means pieces.
            </li>
            <li>
              <span className="font-medium text-foreground">price_includes_tax, track_inventory</span>: yes or no.
            </li>
            <li>
              <span className="font-medium text-foreground">category</span>: categories that do not exist yet are
              created for you.
            </li>
            <li>
              <span className="font-medium text-foreground">opening_stock</span>: used only for new products
              {outletName ? `, and added to ${outletName}` : ""}.
            </li>
            <li>
              <span className="font-medium text-foreground">barcode</span>: format the column as Text in your
              spreadsheet so long numbers are not changed.
            </li>
            <li>When updating a product, a blank cell keeps the value it already has.</li>
            {canViewCost ? null : (
              <li>
                <span className="font-medium text-foreground">purchase_price</span>: ignored, because your role cannot
                see cost prices.
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold">2. Choose your file</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            CSV, up to {IMPORT_MAX_ROWS.toLocaleString("en-IN")} products. Nothing is saved until you confirm on the
            next step.
          </p>
          <input
            ref={fileInput}
            id="import_file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label="CSV file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          <Button className="mt-3" disabled={stage.reading} onClick={() => fileInput.current?.click()}>
            <Upload aria-hidden /> {stage.reading ? "Reading file…" : "Choose CSV file"}
          </Button>
          {stage.error ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {stage.error}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  const { review } = stage;

  if (stage.name === "importing") {
    const total = review.rawValid.length;
    const percent = total === 0 ? 0 : Math.round((stage.done / total) * 100);
    return (
      <section className="rounded-xl border p-4" aria-busy="true">
        <h2 className="text-sm font-semibold">Importing products</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Keep this page open until it finishes.</p>
        <Progress value={percent} className="mt-4" aria-label="Import progress" />
        <p className="tabular mt-2 text-sm" aria-live="polite">
          {stage.done.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")} rows ({percent}%)
        </p>
      </section>
    );
  }

  if (stage.name === "done") {
    const created = stage.results.filter((r) => r.status === "created").length;
    const updated = stage.results.filter((r) => r.status === "updated").length;
    const failed = stage.results.filter((r) => r.status === "failed");
    const notes = stage.results.filter((r) => r.status !== "failed" && r.message);
    const attention = [...failed, ...notes].sort((a, b) => a.row - b.row);
    return (
      <div className="grid gap-4">
        <section className="rounded-xl border p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {failed.length === 0 ? (
              <CheckCircle2 className="size-4 text-primary" aria-hidden />
            ) : (
              <AlertTriangle className="size-4 text-destructive" aria-hidden />
            )}
            {failed.length === 0 ? "Import finished" : "Import finished with problems"}
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Added" value={created} />
            <Stat label="Updated" value={updated} />
            <Stat label="Not imported" value={failed.length + review.invalidRowCount} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/app/products">View products</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              Import another file
            </Button>
          </div>
        </section>

        {attention.length > 0 ? (
          <section className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Rows that need a look ({attention.length})</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv(
                    "ekdum-import-results.csv",
                    toCsv(
                      ["Row", "Result", "Message"],
                      attention.map((r) => [r.row, r.status, r.message ?? ""]),
                    ),
                  )
                }
              >
                <Download aria-hidden /> Download as CSV
              </Button>
            </div>
            <div className="mt-3 overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead className="w-28">Result</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attention.slice(0, ERROR_ROWS_SHOWN).map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="tabular">{r.row}</TableCell>
                      <TableCell>
                        <StatusBadge
                          tone={r.status === "failed" ? "red" : "amber"}
                          label={r.status === "failed" ? "Not imported" : r.status === "created" ? "Added" : "Updated"}
                        />
                      </TableCell>
                      <TableCell className="whitespace-normal">{r.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {attention.length > ERROR_ROWS_SHOWN ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the first {ERROR_ROWS_SHOWN}. Download the CSV for the full list.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    );
  }

  // Review: error report + preview, nothing saved yet.
  const validCount = review.valid.length;
  return (
    <div className="grid gap-4">
      <section className="rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate">{review.fileName}</span>
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Rows in file" value={review.totalRows} />
          <Stat label="New products" value={review.toCreate} />
          <Stat label="Will be updated" value={review.toUpdate} />
          <Stat label="Rows with problems" value={review.invalidRowCount} danger={review.invalidRowCount > 0} />
        </dl>
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
          {review.unknownHeaders.length > 0 ? (
            <li>These columns are not used and will be ignored: {review.unknownHeaders.join(", ")}.</li>
          ) : null}
          {review.toUpdate > 0 ? (
            <li>
              Rows whose SKU already exists update that product. Blank cells keep the current value
              {review.hasOpeningStock ? ", and opening stock is not changed for them" : ""}.
            </li>
          ) : null}
          {review.hasOpeningStock ? (
            <li>
              {outletName
                ? `Opening stock of new products is added to ${outletName}.`
                : "Opening stock will not be set because no outlet is selected."}
            </li>
          ) : null}
          {review.hasPurchasePrice && !canViewCost ? (
            <li>Purchase prices in the file are ignored, because your role cannot see cost prices.</li>
          ) : null}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="lg" disabled={validCount === 0} onClick={() => void commit(review)}>
            <Upload aria-hidden />
            {review.invalidRowCount > 0
              ? `Import the ${validCount.toLocaleString("en-IN")} good rows`
              : `Import ${validCount.toLocaleString("en-IN")} ${validCount === 1 ? "product" : "products"}`}
          </Button>
          <Button variant="outline" size="lg" onClick={reset}>
            Choose another file
          </Button>
        </div>
        {review.invalidRowCount > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Rows with problems are skipped. You can fix them in your spreadsheet and import the file again: rows with a
            SKU are updated, not added twice.
          </p>
        ) : null}
      </section>

      {review.errors.length > 0 ? (
        <section className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Problems found ({review.errors.length.toLocaleString("en-IN")})
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  "ekdum-import-errors.csv",
                  toCsv(
                    ["Row", "Column", "Problem"],
                    review.errors.map((e) => [e.row, e.column, e.message]),
                  ),
                )
              }
            >
              <Download aria-hidden /> Download error report
            </Button>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Row</TableHead>
                  <TableHead className="w-40">Column</TableHead>
                  <TableHead>Problem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.errors.slice(0, ERROR_ROWS_SHOWN).map((e, i) => (
                  <TableRow key={`${e.row}-${e.column}-${i}`}>
                    <TableCell className="tabular">{e.row}</TableCell>
                    <TableCell>{e.column ? IMPORT_COLUMN_LABELS[e.column] : "-"}</TableCell>
                    <TableCell className="whitespace-normal">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {review.errors.length > ERROR_ROWS_SHOWN ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {ERROR_ROWS_SHOWN}. Download the error report for the full list.
            </p>
          ) : null}
        </section>
      ) : null}

      {validCount > 0 ? (
        <section className="rounded-xl border p-4">
          <h2 className="text-sm font-semibold">
            Preview{validCount > PREVIEW_ROWS ? ` (first ${PREVIEW_ROWS} of ${validCount.toLocaleString("en-IN")})` : ""}
          </h2>
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Row</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Opening stock</TableHead>
                  <TableHead>What happens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {review.valid.slice(0, PREVIEW_ROWS).map((r) => {
                  const isUpdate = r.sku !== null && review.existingSkus.has(r.sku);
                  return (
                    <TableRow key={r.row}>
                      <TableCell className="tabular">{r.row}</TableCell>
                      <TableCell className="max-w-56 truncate font-medium">{r.name}</TableCell>
                      <TableCell className="tabular">{r.sku ?? "-"}</TableCell>
                      <TableCell>{r.category ?? "-"}</TableCell>
                      <TableCell>{r.unit_code ?? "-"}</TableCell>
                      <TableCell className="tabular text-right">{r.gst_rate === null ? "-" : `${r.gst_rate}%`}</TableCell>
                      <TableCell className="text-right">
                        <span className="tabular">{formatINR(r.sale_price_paise)}</span>
                        {r.price_includes_tax === null ? null : (
                          <span className="block text-xs text-muted-foreground">
                            {r.price_includes_tax ? "incl. tax" : "excl. tax"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {isUpdate || r.opening_stock === null ? "-" : r.opening_stock}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={isUpdate ? "blue" : "green"} label={isUpdate ? "Update" : "New"} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`tabular text-lg font-semibold ${danger ? "text-destructive" : ""}`}>
        {value.toLocaleString("en-IN")}
      </dd>
    </div>
  );
}
