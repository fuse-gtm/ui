"use client";

import { Check, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { SectionLabel, SectionLabelLabel } from "@/components/shell/section-label";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ENRICHMENT_CONFIG } from "@/lib/enrichment/config";
import {
  type EnrichmentField,
  type EnrichmentFieldType,
  generateVariableName,
} from "@/lib/enrichment/types";
import { cn } from "@/lib/utils";

/**
 * @fuse/field-mapper — Fuse-canon CSV column → enrichment field mapper.
 *
 * Source of truth: fuse-web `components/csv/field-mapper.tsx`.
 *
 * Phase 1 port of fire-enrich's `field-mapper.tsx`, extended with Fuse-canon
 * affordances:
 *
 *   - **Key column selector** at the top — the user picks which CSV column
 *     contains the partner's domain/website. Auto-selected via fuzzy match
 *     on headers like "domain", "website", "url", "company_url".
 *   - **Auto-mapped presets** — when `columns` is passed, presets whose
 *     displayName fuzzy-matches a CSV column are pre-selected on mount
 *     (e.g. a column called "Company" auto-enables the "Company name" field).
 *   - **Free-form field add** — an inline form opens from "+ Add field",
 *     accepting displayName, description, type. Falls back to presets if
 *     the user hits cancel.
 *
 * The component is a pure CRUD surface (no AI). Sentence case everywhere
 * per HR 4, 2px radius on chips (HR 23 step 5 grep gate), brand-tinted
 * selected state via `--ai-tint` CSS variable.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/components/shell/section-label` exporting `SectionLabel` +
 *     `SectionLabelLabel`.
 *   - Provides `@/components/ui/button`, `@/components/ui/chip`.
 *   - Provides `@/lib/enrichment/config` exporting `ENRICHMENT_CONFIG` with
 *     `MAX_FIELDS: number` field.
 *   - Provides `@/lib/enrichment/types` exporting `EnrichmentField`,
 *     `EnrichmentFieldType`, `generateVariableName`.
 *   - Provides `@/lib/utils` exporting `cn`.
 */

const MAX_FIELDS = ENRICHMENT_CONFIG.MAX_FIELDS;

/**
 * Preset enrichment fields for partner discovery. Different set from
 * fire-enrich (which targeted generic company enrichment) — these feed the
 * IPP scoring rubrics + partner dossier.
 */
export const PRESET_FIELDS: ReadonlyArray<Omit<EnrichmentField, "name">> = [
  {
    displayName: "Company name",
    description: "Official legal or trading name of the company.",
    type: "string",
  },
  {
    displayName: "Domain",
    description: "Primary website domain, without protocol or trailing slash.",
    type: "string",
  },
  {
    displayName: "Description",
    description: "One-sentence description of what the company does.",
    type: "string",
  },
  {
    displayName: "Industry",
    description: "Primary industry or sector the company operates in.",
    type: "string",
  },
  {
    displayName: "Headquarters",
    description: "City and country of the company's headquarters.",
    type: "string",
  },
  {
    displayName: "Headcount",
    description: "Approximate number of employees.",
    type: "number",
  },
  {
    displayName: "Ecosystems",
    description:
      "Technology or partner ecosystems the company operates in (e.g. AWS, Salesforce, HubSpot).",
    type: "array",
  },
  {
    displayName: "LinkedIn",
    description: "Company LinkedIn profile URL.",
    type: "string",
  },
];

/** Fast lookup — used to distinguish preset chips from custom-added chips. */
const PRESET_DISPLAY_NAMES = new Set(PRESET_FIELDS.map((p) => p.displayName));

/** Preset displayNames selected on first render when auto-map finds nothing. */
const DEFAULT_FALLBACK = new Set([
  "Company name",
  "Domain",
  "Description",
  "Industry",
]);

/** Canonical header aliases that identify the partner's domain column. */
const KEY_COLUMN_ALIASES = [
  "domain",
  "website",
  "url",
  "company url",
  "company_url",
  "company website",
  "company_website",
  "site",
  "homepage",
];

/* -------------------------------------------------------------------------- */
/* Auto-mapping                                                               */
/* -------------------------------------------------------------------------- */

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Pick the most likely key column from a list of CSV headers. Preference
 * order: exact alias match → starts-with alias → contains alias → first
 * column as fallback.
 */
function detectKeyColumn(columns: string[]): string | undefined {
  if (columns.length === 0) return undefined;
  const normalized = columns.map((c) => ({ raw: c, n: norm(c) }));

  for (const alias of KEY_COLUMN_ALIASES) {
    const exact = normalized.find((c) => c.n === alias);
    if (exact) return exact.raw;
  }
  for (const alias of KEY_COLUMN_ALIASES) {
    const startsWith = normalized.find((c) => c.n.startsWith(alias));
    if (startsWith) return startsWith.raw;
  }
  for (const alias of KEY_COLUMN_ALIASES) {
    const contains = normalized.find((c) => c.n.includes(alias));
    if (contains) return contains.raw;
  }
  return columns[0];
}

/**
 * Auto-select presets whose displayName fuzzy-matches any CSV column header.
 * Returns the set of displayNames to pre-enable. Falls back to
 * DEFAULT_FALLBACK if no matches are found.
 */
function autoMapPresets(columns: string[]): Set<string> {
  if (columns.length === 0) return new Set(DEFAULT_FALLBACK);
  const normalized = columns.map(norm);
  const matched = new Set<string>();

  for (const preset of PRESET_FIELDS) {
    const target = norm(preset.displayName);
    // Also match on individual significant words — "Company name" should
    // match a column called "Company".
    const tokens = target.split(" ").filter((t) => t.length > 2);
    const isMatch = normalized.some(
      (col) =>
        col === target ||
        col.includes(target) ||
        target.includes(col) ||
        tokens.some((t) => col === t || col.startsWith(`${t} `)),
    );
    if (isMatch) matched.add(preset.displayName);
  }

  return matched.size > 0 ? matched : new Set(DEFAULT_FALLBACK);
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

type FieldMapperProps = {
  /** CSV header row from CsvUploader, used for auto-mapping + key col. */
  columns?: string[];
  /**
   * AI-suggested fields (e.g. from the Discover prompt parser). Merged with
   * auto-mapped presets to seed the initial selection, deduped by
   * `displayName` (case-insensitive). Re-seeds the selection when the set
   * changes across renders — the caller is expected to hand a stable
   * reference per intent (not a new array on every render).
   */
  suggestedFields?: ReadonlyArray<Omit<EnrichmentField, "name">>;
  /** Button label. Sentence case. */
  submitLabel?: string;
  /** Fires when the user clicks the submit button. */
  onSubmit: (args: {
    fields: EnrichmentField[];
    keyColumn?: string;
  }) => void;
  /**
   * Fires on every keyColumn change (auto-detect on mount + explicit user
   * selection). Parent surfaces use this to run pre-flight checks against
   * the rows keyed on that column — e.g. the NewListFlow dedupe warning
   * at `new-list-flow.tsx` (D-08, 2026-04-24). Empty string is a valid
   * value (user cleared selection) and the parent is expected to handle it.
   */
  onKeyColumnChange?: (keyColumn: string) => void;
  /** When true, the submit button is disabled regardless of otherwise-valid
   *  inputs. Use for parent-driven gating — e.g. D-08 dedupe block. */
  submitDisabled?: boolean;
  /**
   * Button variant for the submit action. Defaults to `default` (primary).
   * Set to `outline` on Discover to demote the manual-path CTA below the
   * prompt's primary "Search" button, per DC-01 (2026-04-24). Single
   * primary CTA per surface keeps the canonical "go" action unambiguous.
   */
  submitVariant?: "default" | "outline" | "ghost";
};

/**
 * Stable default for `suggestedFields` — avoids identity thrash in the effect.
 * Reserved for if we later move off serialized keys to identity-based
 * memoization; today the seed effect keys on a content-derived string, so this
 * sentinel is partially superfluous but kept as documentation-by-code.
 */
const EMPTY_SUGGESTIONS: ReadonlyArray<Omit<EnrichmentField, "name">> = [];

function initialFields(
  columns: string[] | undefined,
  suggestedFields: ReadonlyArray<Omit<EnrichmentField, "name">>,
): EnrichmentField[] {
  const autoMapped = autoMapPresets(columns ?? []);
  const names: string[] = [];
  const fields: EnrichmentField[] = [];
  const seen = new Set<string>();

  const add = (preset: Omit<EnrichmentField, "name">) => {
    const key = preset.displayName.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const name = generateVariableName(preset.displayName, names);
    names.push(name);
    fields.push({ ...preset, name });
  };

  // Auto-mapped presets first (order matches PRESET_FIELDS for consistency).
  for (const preset of PRESET_FIELDS) {
    if (autoMapped.has(preset.displayName)) add(preset);
  }
  // AI suggestions layer on top, deduped.
  for (const suggestion of suggestedFields) add(suggestion);

  return fields;
}

export function FieldMapper({
  columns,
  suggestedFields = EMPTY_SUGGESTIONS,
  submitLabel = "Start enrichment",
  onSubmit,
  onKeyColumnChange,
  submitDisabled,
  submitVariant = "default",
}: FieldMapperProps) {
  const [selected, setSelected] = useState<EnrichmentField[]>(() =>
    initialFields(columns, suggestedFields),
  );
  const [keyColumn, setKeyColumn] = useState<string>(
    () => detectKeyColumn(columns ?? []) ?? "",
  );
  const [addOpen, setAddOpen] = useState(false);

  // Fire the change callback on every keyColumn change (including the
  // auto-detect mount + the column-change re-detect effect below). The
  // parent's `onKeyColumnChange` should be memoized so we don't thrash.
  useEffect(() => {
    onKeyColumnChange?.(keyColumn);
  }, [keyColumn, onKeyColumnChange]);

  // Re-seed the selection when either `columns` or `suggestedFields` changes.
  // The invariant: `selected` is a pure function of (columns, suggestions);
  // `keyColumn` auto-detect tracks columns only.
  //
  // Re-seeding clobbers any in-progress edits — the assumption is that a
  // column change (different CSV) or a re-prompt (Discover re-run) is the
  // user re-expressing intent, so the new input set is the new source of
  // truth.
  //
  // Build an explicit content key from the fields that matter instead of
  // `JSON.stringify(suggestedFields)` — the latter is not stable across
  // object property order, so a caller handing us suggestion items with
  // reordered keys (e.g. AI SDK `Output.object`, hand-constructed spreads)
  // would flip the key and re-fire spuriously.
  const suggestionsKey = suggestedFields
    .map((f) => `${f.displayName}|${f.type}|${f.description}`)
    .join("\n");

  useEffect(() => {
    if (columns && columns.length > 0) {
      setKeyColumn(detectKeyColumn(columns) ?? columns[0] ?? "");
    }
    setSelected(initialFields(columns, suggestedFields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, suggestionsKey]);

  const selectedByDisplay = useMemo(
    () => new Set(selected.map((f) => f.displayName)),
    [selected],
  );

  const addPreset = useCallback(
    (preset: Omit<EnrichmentField, "name">) => {
      setSelected((prev) => {
        if (
          prev.length >= MAX_FIELDS ||
          prev.some((f) => f.displayName === preset.displayName)
        ) {
          return prev;
        }
        const existing = prev.map((f) => f.name);
        const name = generateVariableName(preset.displayName, existing);
        return [...prev, { ...preset, name }];
      });
    },
    [],
  );

  const addCustomField = useCallback(
    (draft: Omit<EnrichmentField, "name">) => {
      setSelected((prev) => {
        if (prev.length >= MAX_FIELDS) return prev;
        const existing = prev.map((f) => f.name);
        const name = generateVariableName(draft.displayName, existing);
        return [...prev, { ...draft, name }];
      });
      setAddOpen(false);
    },
    [],
  );

  /**
   * Remove a field by displayName. Works for both preset and custom fields.
   * Preset chips call this on a second click (toggle-off); custom chips have
   * an explicit × button that calls it.
   */
  const removeField = useCallback((displayName: string) => {
    setSelected((prev) => prev.filter((f) => f.displayName !== displayName));
  }, []);

  const hasColumns = Boolean(columns && columns.length > 0);

  const handleSubmit = useCallback(() => {
    if (selected.length === 0) return;
    if (hasColumns) {
      if (keyColumn.length === 0) return;
      onSubmit({ fields: selected, keyColumn });
    } else {
      onSubmit({ fields: selected });
    }
  }, [onSubmit, selected, keyColumn, hasColumns]);

  const atCapacity = selected.length >= MAX_FIELDS;
  const canSubmit =
    selected.length > 0 &&
    (!hasColumns || keyColumn.length > 0) &&
    !submitDisabled;

  return (
    <div className="flex flex-col gap-6">
      {/* Key column selector — only shown when we have columns to pick from */}
      {columns && columns.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionLabelLabel htmlFor="fieldmap-key-col">
            Domain column
          </SectionLabelLabel>
          <select
            id="fieldmap-key-col"
            value={keyColumn}
            onChange={(e) => setKeyColumn(e.target.value)}
            className="w-full max-w-xs rounded-[2px] border border-border bg-background px-2 py-1.5 text-dense text-foreground focus:border-foreground/40 focus:outline-none"
          >
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="text-micro text-muted-foreground">
            The column containing each partner's website or domain. We use it
            to scrape their site for the fields below.
          </p>
        </section>
      )}

      {/* Preset row — quick-add chips */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          {/*
            06-wig-006 (V1.5-RD): use literal U+00B7 MIDDLE DOT `·` (not
            the `&middot;` HTML entity). Canonical Fuse rhythm per CLAUDE.md
            "Brand tokens" (grid-source-column-prefix invariant: "prefix
            the source header as `Source · {keyColumn}` — middle dot
            matches 'Fields to enrich · N of M' rhythm"). HTML entities
            in JSX are HTML-specific encoding cruft; literal Unicode is
            collision-free with text processors and matches the canonical
            invariant exactly (WIG Rule 55).
          */}
          <SectionLabel>
            Fields to enrich · {selected.length} of {MAX_FIELDS}
          </SectionLabel>
          {hasColumns && <EnrichmentHealthBadge />}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_FIELDS.map((preset) => {
            const isSelected = selectedByDisplay.has(preset.displayName);
            // Disable only when at capacity AND the chip is not already selected
            // (selected chips must remain clickable so they can be toggled off).
            const disabled = !isSelected && atCapacity;
            return (
              <Chip
                key={preset.displayName}
                variant={isSelected ? "active" : "default"}
                disabled={disabled}
                onClick={() =>
                  isSelected
                    ? removeField(preset.displayName)
                    : addPreset(preset)
                }
                title={
                  isSelected
                    ? `Remove ${preset.displayName}`
                    : preset.description
                }
                aria-pressed={isSelected}
                leadingIcon={
                  isSelected ? (
                    <Check className="size-3 text-primary" aria-hidden />
                  ) : undefined
                }
                trailingIcon={
                  isSelected ? (
                    <X className="size-3 text-muted-foreground" aria-hidden />
                  ) : !atCapacity ? (
                    <Plus className="size-3" aria-hidden />
                  ) : undefined
                }
                className={cn(
                  !isSelected && atCapacity && "cursor-not-allowed opacity-60",
                )}
              >
                {preset.displayName}
              </Chip>
            );
          })}
          {/*
            06-wig-009 (V1.5-RD): the dashed-border variant already signals
            "create action" visually; the verb "Add" carries the intent in
            copy; the trailing `+` icon was a third encoding of the same
            signal (WIG Rule 10 — avoid redundant affordance encoding).
            Dropping `trailingIcon` removes the redundancy without losing
            scannability — the dashed outline + "Add field" label is the
            canonical inline-create affordance Fuse uses elsewhere.
          */}
          <Chip
            variant="dashed"
            onClick={() => setAddOpen((o) => !o)}
            disabled={atCapacity}
            className={atCapacity ? "cursor-not-allowed opacity-60" : undefined}
          >
            Add field
          </Chip>
        </div>
      </section>

      {/* Inline free-form add form */}
      {addOpen && (
        <AddFieldForm
          onCancel={() => setAddOpen(false)}
          onAdd={addCustomField}
          existingDisplayNames={selectedByDisplay}
        />
      )}

      {/* Custom-added fields — non-preset fields added via "+ Add field".
          These don't appear in the preset chip row, so we surface them here
          with an explicit × remove button. Preset fields are toggled directly
          on the chip above (click selected chip → removeField). */}
      {selected.some((f) => !PRESET_DISPLAY_NAMES.has(f.displayName)) && (
        <section className="flex flex-col gap-2">
          <SectionLabel>Custom fields</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {selected
              .filter((f) => !PRESET_DISPLAY_NAMES.has(f.displayName))
              .map((field) => (
                <Chip
                  key={field.name}
                  variant="active"
                  title={field.description}
                  onClick={() => removeField(field.displayName)}
                  aria-label={`Remove ${field.displayName}`}
                  trailingIcon={
                    <X className="size-3 text-muted-foreground" aria-hidden />
                  }
                >
                  {field.displayName}
                </Chip>
              ))}
          </div>
        </section>
      )}

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          size="sm"
          variant={submitVariant}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Enrichment health badge                                                    */
/* -------------------------------------------------------------------------- */

type HealthResponse = { ok: boolean; reason: string | null };

/**
 * Probe `/api/enrich/health` once on mount. We intentionally DON'T use
 * `fetchWithErrorHandlers` or the shared `fetcher` — a 503 response is a
 * valid "service unavailable" signal, not an unexpected error. The endpoint
 * is auth-gated and returns a typed `{ ok, reason }` payload for both 200
 * and 503, so we parse both.
 *
 * One-shot on mount. No polling, no revalidation on focus. The badge is a
 * pre-flight readiness hint, not a live probe — if the operator adds the
 * env var mid-session they can refresh.
 */
async function healthFetcher(url: string): Promise<HealthResponse> {
  const response = await fetch(url);
  try {
    const body = (await response.json()) as HealthResponse;
    return body;
  } catch {
    return { ok: false, reason: "Unable to reach health endpoint" };
  }
}

function EnrichmentHealthBadge() {
  const { data, isLoading } = useSWR<HealthResponse>(
    "/api/enrich/health",
    healthFetcher,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
    },
  );

  const label = isLoading
    ? "Enrichment status…"
    : data?.ok
      ? "Enrichment ready"
      : "Enrichment unavailable";

  // Fuse is plum+sand only — no semantic green. Use a neutral foreground-on-muted
  // pill for the ready state (presence IS the signal). Destructive stays red.
  const tone = isLoading
    ? "text-muted-foreground bg-muted/30"
    : data?.ok
      ? "text-foreground bg-muted"
      : "text-destructive bg-destructive/10";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-micro",
        tone,
      )}
      title={data?.reason ?? undefined}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Add-field form                                                             */
/* -------------------------------------------------------------------------- */

type AddFieldFormProps = {
  onAdd: (field: Omit<EnrichmentField, "name">) => void;
  onCancel: () => void;
  existingDisplayNames: Set<string>;
};

const FIELD_TYPES: ReadonlyArray<{ value: EnrichmentFieldType; label: string }> =
  [
    { value: "string", label: "Text" },
    { value: "number", label: "Number" },
    { value: "boolean", label: "Yes / no" },
    { value: "array", label: "List" },
  ];

function AddFieldForm({
  onAdd,
  onCancel,
  existingDisplayNames,
}: AddFieldFormProps) {
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<EnrichmentFieldType>("string");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    const desc = description.trim();
    if (name.length === 0) {
      setError("Name is required");
      return;
    }
    if (existingDisplayNames.has(name)) {
      setError("Already added");
      return;
    }
    if (desc.length === 0) {
      setError("Description is required — it's the prompt sent to the model");
      return;
    }
    onAdd({ displayName: name, description: desc, type });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="addfield-name"
            className="text-micro text-muted-foreground"
          >
            Field name
          </label>
          <input
            id="addfield-name"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setError(null);
            }}
            placeholder="e.g. Funding stage"
            className="rounded-[2px] border border-border bg-background px-2 py-1.5 text-dense text-foreground focus:border-foreground/40 focus:outline-none"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="addfield-type"
            className="text-micro text-muted-foreground"
          >
            Type
          </label>
          <select
            id="addfield-type"
            value={type}
            onChange={(e) => setType(e.target.value as EnrichmentFieldType)}
            className="rounded-[2px] border border-border bg-background px-2 py-1.5 text-dense text-foreground focus:border-foreground/40 focus:outline-none"
          >
            {FIELD_TYPES.map((ft) => (
              <option key={ft.value} value={ft.value}>
                {ft.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor="addfield-desc"
          className="text-micro text-muted-foreground"
        >
          Description
        </label>
        <input
          id="addfield-desc"
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setError(null);
          }}
          placeholder="e.g. Most recent funding round the company has announced."
          className="rounded-[2px] border border-border bg-background px-2 py-1.5 text-dense text-foreground focus:border-foreground/40 focus:outline-none"
        />
        <p className="text-micro text-muted-foreground">
          This is the instruction sent to the model. Be specific.
        </p>
      </div>
      {error && (
        <p className="text-micro text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Add
        </Button>
      </div>
    </form>
  );
}
