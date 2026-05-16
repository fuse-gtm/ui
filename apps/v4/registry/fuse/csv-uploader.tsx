"use client";

import { Upload } from "lucide-react";
import Papa from "papaparse";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

import { ENRICHMENT_CONFIG } from "@/lib/enrichment/config";
import type { CSVRow } from "@/lib/enrichment/types";
import { cn } from "@/lib/utils";

/**
 * @fuse/csv-uploader — Fuse-canon drag-drop CSV uploader.
 *
 * Source of truth: fuse-web `components/csv/csv-uploader.tsx`.
 *
 * What this wrapper adds vs raw react-dropzone:
 *
 *   - Parses via papaparse with `header: true` so each row comes back as a
 *     `{ column -> value }` map, not a positional array. Empty trailing rows
 *     and empty cells are pruned — fire-enrich didn't do this and it bit us
 *     with real-world CSVs that had blank lines at the bottom.
 *
 *   - `transformHeader: (h) => h.trim()` prevents trailing-space columns
 *     from failing exact-match field mapping downstream.
 *
 *   - Fuse-canon brand tokens: drag-active state uses `border-primary` +
 *     `bg-[var(--ai-tint)]/40` (HR 2 "no semantic green"); idle state uses
 *     `border-border` + `bg-muted/30`; error displays in `text-destructive`.
 *
 *   - Bounded by `ENRICHMENT_CONFIG.MAX_ROWS` (Fuse-internal config —
 *     consumer-set ceiling; defaults to 100,000 per V-close 2.0.11 founder
 *     DM bundle PR #705).
 *
 *   - Sentence-case copy per HR 4 (no patronizing labels, no ALL CAPS).
 *
 * Streaming note: papaparse's `worker: true` mode moves parsing off the
 * main thread for >10k-row files. Fuse stays on-thread (simpler, no Worker
 * bundler friction).
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/lib/enrichment/config` exporting `ENRICHMENT_CONFIG` with
 *     `MAX_ROWS: number` field.
 *   - Provides `@/lib/enrichment/types` exporting `CSVRow` type (canonical
 *     shape: `Record<string, string>`).
 *   - Provides `@/lib/utils` exporting `cn` helper.
 */

export type ParsedCsv = {
  rows: CSVRow[];
  columns: string[];
  /** Filename for display in the UI. */
  fileName: string;
};

type CsvUploaderProps = {
  onParsed: (parsed: ParsedCsv) => void;
  className?: string;
};

const ACCEPT = { "text/csv": [".csv"] };

export function CsvUploader({ onParsed, className }: CsvUploaderProps) {
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      Papa.parse<CSVRow>(file, {
        header: true,
        skipEmptyLines: "greedy",
        // `transformHeader` trims whitespace from column names — prevents
        // a trailing-space column from failing exact-match field mapping.
        transformHeader: (h) => h.trim(),
        complete: (results) => {
          if (results.errors.length > 0) {
            setError(`Parse error: ${results.errors[0]?.message ?? "unknown"}`);
            return;
          }

          const columns =
            results.meta.fields?.map((f) => f.trim()).filter(Boolean) ?? [];

          // Drop fully-empty rows (every cell is empty string) — a common
          // artifact of Excel exports with stray newlines at EOF.
          const rows = (results.data as CSVRow[]).filter((row) =>
            Object.values(row).some((v) => (v ?? "").trim() !== ""),
          );

          if (rows.length === 0) {
            setError("No rows found in file.");
            return;
          }
          if (rows.length > ENRICHMENT_CONFIG.MAX_ROWS) {
            setError(
              `File has ${rows.length} rows. Maximum is ${ENRICHMENT_CONFIG.MAX_ROWS}.`,
            );
            return;
          }
          if (columns.length === 0) {
            setError("CSV has no header row.");
            return;
          }

          onParsed({ rows, columns, fileName: file.name });
        },
        error: (err) => {
          setError(`Parse error: ${err.message}`);
        },
      });
    },
    [onParsed],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    multiple: false,
    onDrop: (files) => {
      const file = files[0];
      if (file) handleFile(file);
    },
  });

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-8 py-16 text-center transition-colors",
          isDragActive
            ? "border-primary bg-[var(--ai-tint)]/40"
            : "border-border bg-muted/30 hover:border-foreground/40 hover:bg-muted/50",
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className="mb-3 size-6 text-muted-foreground"
          aria-hidden
          strokeWidth={1.5}
        />
        <p className="text-sm text-foreground">
          {isDragActive ? "Drop to upload" : "Drop a CSV or click to browse"}
        </p>
        <p className="mt-1 text-micro text-muted-foreground">
          First row should be column headers. Row count is bounded only by
          your plan&apos;s credit allowance.
        </p>
      </div>
      {error && (
        <p className="text-micro text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
