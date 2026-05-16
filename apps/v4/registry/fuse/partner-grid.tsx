"use client";

/**
 * @fuse/partner-grid — Fuse-canon partner data grid composing DiceUI's
 * Data Grid (`@diceui/data-grid` / `@/components/data-grid/data-grid`)
 * with Fuse's streaming-cell state machine + IPP score column + 3 modes
 * (results / list-detail / streaming-enrichment).
 *
 * Source of truth: fuse-web `components/grid/partner-grid.tsx`.
 *
 * What this wrapper adds vs raw DiceUI Data Grid:
 *
 *   - Mode-switch surface: one component renders 3 surfaces (Discover
 *     results, list-detail browse/edit, streaming enrichment). Each mode
 *     has its own column set + row-action semantics; the cell render path
 *     is unified.
 *
 *   - Cell render-branch order load-bearing: `empty/pending/processing →
 *     error → inconclusive → confirmed_null → confirmed_value` per fuse-web
 *     CLAUDE.md "Streaming cells" invariant. Trailing `state satisfies
 *     "confirmed_value"` is the exhaustiveness guard.
 *
 *   - Memo wall: per-row streaming snapshot stored on `row.original[
 *     STREAMING_KEY]` so React.memo'd row invalidates on each SSE tick.
 *     Refs + out-of-band state do not cut it.
 *
 *   - HR 12 modal=false preserved on all Radix DropdownMenu surfaces
 *     (column header sort/pin/hide popper, row action menu).
 *
 *   - HR 2 sparkle (`auto_awesome`) reserved for AI-generated columns;
 *     user-managed CRUD surfaces (key column, persisted fields) never
 *     stack sparkle on top of ai-tint backgrounds.
 *
 *   - HR 19 source attribution per cell: confirmed-value cells display
 *     value only — no inline confidence %, no src-dot. Evidence lives in
 *     the panel Evidence tab (consumer ships separately).
 *
 *   - IPP score column shipped via `@fuse/ipp-score-cell` registry item.
 *
 *   - Cell humanizers (partner-type / size / segment / region / industry
 *     enums → sentence-case display labels) preserved for grid consistency.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/components/data-grid/data-grid` (Fuse-Dice canonical DataGrid).
 *   - Provides `@/components/ui/checkbox`, `@/components/ui/tooltip`.
 *   - Provides `@/hooks/use-data-grid` (TanStack `useReactTable` wrapper).
 *   - Provides `@/hooks/use-streaming-cells` (cell state machine + helpers).
 *   - Provides `@/lib/db/schema` exporting `Partner` type.
 *   - Provides `@/lib/discover/criterion-color` + `@/lib/discover/types`.
 *   - Provides `@/lib/enrichment/types` (CSVRow + EnrichmentCell + Field).
 *   - Provides `@/types/data-grid` exporting `HeaderAction`.
 *   - Provides `@/lib/scoring/compute-score` + `@/lib/scoring/rubrics`.
 *   - Provides `@/lib/utils` exporting `cn`.
 *   - Provides `@fuse/ipp-score-cell` (canonical IPP score cell).
 */

import type { ColumnDef } from "@tanstack/react-table";
import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DataGrid } from "@/components/data-grid/data-grid";
import { IppScoreCell } from "@/components/grid/ipp-score-cell";
import { useDataGrid } from "@/hooks/use-data-grid";
import type { UseStreamingCellsReturn } from "@/hooks/use-streaming-cells";
import type { CellStreamState } from "@/hooks/use-streaming-cells";
import type { Partner } from "@/lib/db/schema";
import { getCriterionColorClass } from "@/lib/discover/criterion-color";
import type {
  Criterion,
  Enrichment,
  PartnerResult,
  V15SearchEntity,
} from "@/lib/discover/types";
import type { CSVRow, EnrichmentCell, EnrichmentField } from "@/lib/enrichment/types";
import type { HeaderAction } from "@/types/data-grid";
import { PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { computeScore } from "@/lib/scoring/compute-score";
import { getRubric } from "@/lib/scoring/rubrics";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Cell humanizers — Discover Results (W1.E grid-humanization)        */
/* ------------------------------------------------------------------ */

/**
 * Map the 8 canonical partner-type enum values to sentence-case display
 * labels. Non-canonical / null values pass through unchanged so the grid
 * never silently swallows unexpected data. (audit A2-DISC-RES-02)
 */
const PARTNER_TYPE_LABELS: Record<string, string> = {
  agency: "Agency",
  consulting: "Consulting",
  isv: "ISV",
  msp: "MSP",
  professional_services: "Professional services",
  reseller: "Reseller",
  systems_integrator: "Systems integrator",
  vc_pe: "VC / PE",
};

function humanizePartnerType(value: string | null | undefined): string {
  if (!value) return "";
  return PARTNER_TYPE_LABELS[value] ?? value;
}

/**
 * Compact size buckets — `10000+` → `10K+`, `1001-5000` → `1K–5K`.
 * Pass-through on unknown shapes. (audit A2-DISC-RES-04)
 */
function humanizeSize(value: string | null | undefined): string {
  if (!value) return "";
  const compact = (n: number): string => {
    if (n >= 1000) {
      const k = n / 1000;
      return Number.isInteger(k) ? `${k}K` : `${k.toFixed(1)}K`;
    }
    return String(n);
  };
  // `10000+` → `10K+`
  const openMatch = value.match(/^(\d+)\+$/);
  if (openMatch) return `${compact(Number.parseInt(openMatch[1], 10))}+`;
  // `1001-5000` → `1K–5K` (en-dash for ranges per typography rules)
  const rangeMatch = value.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = compact(Number.parseInt(rangeMatch[1], 10));
    const hi = compact(Number.parseInt(rangeMatch[2], 10));
    return `${lo}–${hi}`;
  }
  return value;
}

/**
 * snake_case → Title Case for region buckets.
 * `north_america` → `North America`, `global` → `Global`. (audit A2-DISC-RES-05)
 */
function humanizeRegion(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * Per-row streaming snapshot keyed by field name. Lives on the row object at
 * `__fuseStreaming` so TanStack Table's identity checks (and `DataGridRow`'s
 * `row.original !== next.row.original` memo comparator) invalidate when a
 * cell's state changes. Without this plumbing, `DataGridRow` is memo'd on
 * row identity and the grid never re-renders on SSE updates — see DA-lists-2.
 */
const STREAMING_KEY = "__fuseStreaming" as const;

/**
 * 2026-05-10 audit-fix PR 1 — per-row selection projection key for
 * `mode="results"`. Mirrors the STREAMING_KEY pattern: stamping a fresh
 * `__fuseSelected: boolean` onto each row's `row.original` when external
 * selection state changes is what makes `DataGridRow`'s
 * `prev.row.original !== next.row.original` memo invalidate (Codex P2 #2
 * on PR #541 first review). Without this, header "select all" toggles
 * external state but visible-row checkboxes stay stale until something
 * else (row data, column visibility, focus) re-runs the row memo.
 */
const SELECTED_KEY = "__fuseSelected" as const;

type StreamingSnapshot = Record<
  string,
  { state: CellStreamState; cell: EnrichmentCell | null }
>;

type EnrichedCSVRow = Record<string, string | StreamingSnapshot | undefined> & {
  [STREAMING_KEY]?: StreamingSnapshot;
};

/* ------------------------------------------------------------------ */
/* Mode types                                                         */
/* ------------------------------------------------------------------ */

type DiscoverMode = {
  mode: "discover";
  data: Partner[];
  /**
   * Fired on row click with `row.original` (DR-L revert 2026-05-15 — the
   * Slice DR-A `rowY` 2nd-arg is removed; panel anchors at fixed top).
   */
  onRowClick?: (partner: Partner) => void;
  /**
   * When true, row 0 gets a "crown" treatment: 3px plum-9 left rail + subtle
   * muted tint. Only meaningful when the grid is sorted IPP desc (the default).
   * List-detail and list-create opt out — curated rows have no "best match".
   */
  anchorFirst?: boolean;
  /**
   * T-26 selection-bar scaffold. When both are provided the grid renders a
   * leading checkbox column and invokes `onToggleRow` on tick. No consumer
   * wires these yet; they are declared so the PartnerGrid selection branch
   * in the caller compiles against the discriminated union.
   */
  selectedIds?: Set<string>;
  onToggleRow?: (partner: Partner) => void;
};

type ListDetailMode = {
  mode: "list-detail";
  data: Partner[];
  /**
   * Fired on row click with `row.original` (DR-L revert 2026-05-15 — the
   * Slice DR-A `rowY` 2nd-arg is removed; panel anchors at fixed top).
   */
  onRowClick?: (partner: Partner) => void;
};

type ListCreateMode = {
  mode: "list-create";
  data: CSVRow[];
  fields: EnrichmentField[];
  keyColumn: string;
  streaming?: UseStreamingCellsReturn;
};

/**
 * V1.0 New Search Results mode.
 *
 * Source: spec §"Phase 2 — Results table" + audit IDs NS-RS-03 (criteria
 * + enrichments are columns), NS-RS-04 (click partner name → opens panel
 * right side), NS-DC-10 (mental model: Criteria + Enrichments = Columns).
 *
 * Column generator: `[partner_name, partner_domain, ...criteria.map(toCol), ...enrichments.map(toCol)]`.
 * DR-I (2026-05-15): split prior composite `partner_name` (which rendered
 * `{name}{domain}` concatenated) into `partner_name` (name + IPP rail +
 * hover-tooltip) + `partner_domain` (plain-text URL). Each is independently
 * sortable + resizable per founder verbatim 2026-05-15.
 * No IPP Score column (V1.0 spec — IPP scoring is the legacy flow per
 * handoff tricky-decision #8). Cell has no provenance decoration
 * (CLAUDE.md "Data grid architecture" rule).
 */
type ResultsMode = {
  mode: "results";
  data: PartnerResult[];
  criteria: Criterion[];
  enrichments: Enrichment[];
  /**
   * PRD-6 (entity selector; 2026-05-15) — entity discriminator. Drives the
   * column builder branch (person-default columns Name / Title / Company
   * affiliation / Location / LinkedIn vs company-default Name / URL /
   * Industry / Location / Size). Default `'company'` for legacy callers
   * that pre-dated the prop. `V15SearchEntity` narrowed union; widens to
   * V1.6 entity types via a new branch in `buildResultsColumns` per HR 24
   * exhaustiveness contract.
   */
  entity?: V15SearchEntity;
  /**
   * NS-RS-04 — click partner name opens the existing partner detail panel.
   * DR-L revert (2026-05-15) — the Slice DR-A `rowY` 2nd-arg is removed;
   * panel anchors at fixed top per DR-L founder revision.
   */
  onRowClick?: (result: PartnerResult) => void;
  /**
   * Phase 3B Exa parity Tier 2 #8 — per-column overflow menu actions on
   * enrichment columns only (criteria + partner_name columns do not get
   * these recovery affordances). All callbacks are optional; if any are
   * omitted the corresponding menu item is suppressed (Karpathy: don't
   * render dead actions). Each callback receives the enrichment id so the
   * parent can resolve the underlying enrichment + close over Exa job
   * context.
   */
  onRerunEnrichment?: (enrichmentId: string) => void | Promise<void>;
  onEditEnrichment?: (enrichmentId: string) => void;
  onDeleteEnrichment?: (enrichmentId: string) => void;
  /**
   * 2026-05-10 audit-fix PR 1 — multi-select on Discover Results
   * (`I-DISCOVER/launch/multi-select-curate-shortlist`). When provided,
   * prepends a leading checkbox column (id `"select"`) — header checkbox
   * drives select-all/none, per-row checkbox toggles individual rows.
   *
   * Selection state lives in the parent (`results-flow.tsx`) as a Map
   * keyed on `PartnerResult.id` (Exa `witem_*`) so the SaveDialog + the
   * save mutation payload can dump `Array.from(values())` for an
   * off-page-aware payload. The Map (vs Set) addresses Codex P2 #1 on
   * PR #541 first review: SWR is page-scoped so a Set + filter against
   * `data.partners` would silently drop selections from previous pages.
   *
   * Header checkbox state:
   *   - "all"  → solid check, label "Deselect all"
   *   - "some" → indeterminate, label "Select all"
   *   - "none" → unchecked, label "Select all"
   */
  selectedById?: Map<string, { domain: string; name: string }>;
  onToggleRow?: (result: PartnerResult) => void;
  onToggleAll?: () => void;
  selectAllState?: "all" | "some" | "none";
  /**
   * Audit cycle 2 — D.1 — gates the "mid-stream `unclear`" visual treatment.
   * When `true`, a `satisfied === "unclear"` criterion cell renders a subtle
   * pulse (still being evaluated by Exa). When `false` (terminal), the same
   * cell renders the static em-dash + `cursor-help` + tooltip "Unclear —
   * partner may match, evidence incomplete".
   *
   * Without this discriminator three states render at near-identical contrast
   * (audit cycle 2 D.1 / P1): mid-stream-unclear / terminal-unclear /
   * terminal-no. Cell state machine reference: CLAUDE.md "Architecture
   * essentials → Cell state machine" + "Four terminal resolution branches,
   * three transient".
   */
  isStreaming?: boolean;
};

type PartnerGridProps = (
  | DiscoverMode
  | ListDetailMode
  | ListCreateMode
  | ResultsMode
) & {
  className?: string;
  height?: number | "stretch";
};

/* ------------------------------------------------------------------ */
/* Column builders                                                    */
/* ------------------------------------------------------------------ */

function buildPartnerColumns(
  readOnly: boolean,
  // T-26 scaffold: a leading checkbox column will be prepended when
  // `selection` is provided. Not yet wired; parameter accepted so the
  // PartnerDataGrid call site compiles.
  _selection?: {
    selectedIds: Set<string>;
    onToggleRow: (partner: Partner) => void;
  },
): ColumnDef<Partner>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      size: 220,
      minSize: 140,
      meta: { cell: { variant: "short-text" as const } },
      enableSorting: true,
    },
    {
      id: "ipp_score",
      // String header is correct: `DataGridRow` gates the custom-cell
      // branch on `cell:` form (function), not `header:` form. String
      // header here flows through `DataGridColumnHeader` so users get
      // the sort/pin/hide dropdown + resize handle.
      header: "IPP Score",
      enableSorting: true,
      sortingFn: (a, b) => {
        const scoreA = a.original.partnerType
          ? computeScore(getRubric(a.original.partnerType), a.original).score
          : -1;
        const scoreB = b.original.partnerType
          ? computeScore(getRubric(b.original.partnerType), b.original).score
          : -1;
        return scoreA - scoreB;
      },
      cell: ({ row }) => {
        const partner = row.original;
        if (!partner.partnerType) {
          return <IppScoreCell score={null} />;
        }
        const rubric = getRubric(partner.partnerType);
        const result = computeScore(rubric, partner);
        return <IppScoreCell score={result.score} />;
      },
      size: 110,
    },
    {
      accessorKey: "domain",
      header: "Domain",
      size: 180,
      minSize: 100,
      meta: { cell: { variant: "url" as const } },
    },
    {
      accessorKey: "partnerType",
      header: "Type",
      size: 160,
      minSize: 100,
      meta: { cell: { variant: "short-text" as const } },
      enableSorting: true,
      cell: ({ getValue }) => humanizePartnerType(getValue<string | null>()),
    },
    {
      accessorKey: "ecosystems",
      header: "Ecosystems",
      size: 200,
      minSize: 120,
      meta: { cell: { variant: "short-text" as const } },
      cell: ({ getValue }) => {
        const ecosystems = getValue<string[]>();
        if (!ecosystems?.length) return null;
        return ecosystems.slice(0, 3).join(", ");
      },
    },
    {
      accessorKey: "size",
      header: "Size",
      size: 100,
      minSize: 60,
      meta: { cell: { variant: "short-text" as const } },
      cell: ({ getValue }) => humanizeSize(getValue<string | null>()),
    },
    {
      accessorKey: "region",
      header: "Region",
      size: 120,
      minSize: 80,
      meta: { cell: { variant: "short-text" as const } },
      cell: ({ getValue }) => humanizeRegion(getValue<string | null>()),
    },
    {
      accessorKey: "description",
      header: "Description",
      size: 300,
      minSize: 150,
      meta: { cell: { variant: "long-text" as const } },
    },
  ];
}

function buildEnrichmentColumns(
  fields: EnrichmentField[],
  keyColumn: string,
): ColumnDef<EnrichedCSVRow>[] {
  return [
    {
      id: "__key",
      accessorFn: (row) => {
        const value = row[keyColumn];
        if (typeof value === "string" && value.length > 0) return value;
        // Fall back to the first CSV column. Skip the synthetic streaming key
        // which is not a user-facing cell value (DA-lists-2).
        for (const [k, v] of Object.entries(row)) {
          if (k === STREAMING_KEY) continue;
          if (typeof v === "string") return v;
        }
        return "";
      },
      // Prefix the source-CSV column so it never collides visually with an
      // enriched target column of the same name (e.g. CSV "domain" alongside
      // enriched "Domain"). Middle-dot matches the rhythm used in the
      // field-mapper header ("Fields to enrich · N of M") — DA-lists-5.
      header: `Source · ${keyColumn}`,
      size: 220,
      minSize: 140,
      meta: { cell: { variant: "short-text" as const } },
    },
    ...fields.map(
      (field): ColumnDef<EnrichedCSVRow> => ({
        id: field.name,
        // Expose the current state as the accessor so TanStack's column-level
        // equality (and the cell memo's row.original[columnId] probe) sees a
        // different value on every state transition. Keeping this stable as
        // `null` was the original DA-lists-2 bug — the grid never re-rendered.
        accessorFn: (row) =>
          row[STREAMING_KEY]?.[field.name]?.state ?? "empty",
        header: field.displayName,
        size: 200,
        minSize: 120,
        // Short-text variant kept for `DataGridColumnHeader`'s label resolution
        // (column.columnDef.meta?.label). Custom cell branch fires off the
        // `cell:` function below — gate is on cell form, not header form.
        meta: { cell: { variant: "short-text" as const } },
        cell: ({ row }) => {
          const snapshot = row.original[STREAMING_KEY]?.[field.name];
          return (
            <StreamingCell
              state={snapshot?.state ?? "empty"}
              cell={snapshot?.cell ?? null}
              field={field}
            />
          );
        },
      }),
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Results column builder (V1.0 New Search results mode)              */
/* ------------------------------------------------------------------ */

/**
 * NS-RS-03 / NS-DC-10 — column shape:
 *   [partner_name, partner_domain, ...criteria.map(toCol), ...enrichments.map(toCol)]
 *
 * DR-I (2026-05-15): split composite `partner_name` into `partner_name`
 * + `partner_domain` per founder verbatim 2026-05-15. Both pinned-left.
 *
 * No IPP Score column in V1.0 results (handoff tricky-decision #8 —
 * IPP scoring is the legacy flow). No source-attribution / freshness /
 * confidence in any cell (CLAUDE.md "Cell has no provenance decoration").
 *
 * String `header:` form is correct: the custom-cell branch in `DataGridRow`
 * gates on `cell:` form (function), not `header:` form. String headers here
 * flow through `DataGridColumnHeader` so users keep the sort/pin/hide
 * dropdown + resize handle.
 */
/**
 * Build the per-enrichment-column overflow menu actions. Returns `undefined`
 * when no callbacks are wired so the meta key is absent (the column header
 * doesn't render a stray separator). Phase 3B Exa parity Tier 2 #8.
 */
function buildEnrichmentColumnActions(
  enrichmentId: string,
  callbacks: {
    onRerun?: (id: string) => void | Promise<void>;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  },
): HeaderAction[] | undefined {
  const items: HeaderAction[] = [];
  if (callbacks.onRerun) {
    items.push({
      label: "Rerun incomplete enrichments",
      icon: RefreshCwIcon,
      onSelect: () => callbacks.onRerun!(enrichmentId),
    });
  }
  if (callbacks.onEdit) {
    items.push({
      label: "Edit column",
      icon: PencilIcon,
      onSelect: () => callbacks.onEdit!(enrichmentId),
    });
  }
  if (callbacks.onDelete) {
    items.push({
      label: "Delete column",
      icon: Trash2Icon,
      destructive: true,
      onSelect: () => callbacks.onDelete!(enrichmentId),
    });
  }
  return items.length > 0 ? items : undefined;
}

function buildResultsColumns(
  criteria: Criterion[],
  enrichments: Enrichment[],
  enrichmentCallbacks?: {
    onRerun?: (id: string) => void | Promise<void>;
    onEdit?: (id: string) => void;
    onDelete?: (id: string) => void;
  },
  // 2026-05-10 audit-fix PR 1 — multi-select on Discover Results.
  // Selection is opt-in: when omitted, no checkbox column renders + the
  // grid behaves identically to pre-PR (preserves list-detail / list-create
  // surfaces' single-grid contract per CLAUDE.md "Data grid architecture").
  selection?: {
    onToggleRow: (result: PartnerResult) => void;
    onToggleAll: () => void;
    selectAllState: "all" | "some" | "none";
  },
  // Audit cycle 2 — D.1 — disambiguates the three near-identical em-dash
  // states (mid-stream-unclear / terminal-unclear / terminal-no) in
  // criterion cells. Threaded all the way down so `buildResultsColumns`
  // closes over the current value and rebuilds when streaming flips.
  isStreaming = false,
  // PRD-6 (entity selector; 2026-05-15) — drives the column-default branch.
  // 'company' → Name + URL + (criteria) + (enrichments). 'person' → Name +
  // Title + Company + Location + LinkedIn + (criteria) + (enrichments).
  // Per PRD User Story 4: person-default columns are Name / Title / Company
  // affiliation / Location / LinkedIn. Defaults to 'company' for legacy
  // callers; HR 24 exhaustiveness check below.
  entity: V15SearchEntity = "company",
): ColumnDef<PartnerResult>[] {
  // Prepend the checkbox column when selection is wired. `id: "select"`
  // is the canonical id DiceUI's `DataGrid` recognizes (skips grow + outer
  // borders per `components/data-grid/data-grid.tsx:189-203`). Function
  // `header:` form bypasses `DataGridColumnHeader` chrome (sort/pin/hide
  // dropdown is meaningless for a checkbox column). Per
  // `components/data-grid/data-grid-row.tsx:215-223`, row-click skips
  // when the click landed on an interactive descendant — so checkbox
  // clicks won't double-fire `onRowClick`.
  //
  // The cell reads `row.original[SELECTED_KEY]` (projected by
  // `ResultsDataGrid` below) instead of closing over a parent-scoped
  // `selectedIds` Set. Per Codex P2 #2 on PR #541 first review:
  // `DataGridRow` is `React.memo`'d on `row.original` identity; without
  // a row-level signal, header select-all toggles parent state but
  // visible-row checkboxes stay stale (memo skips re-render). Mirrors
  // the STREAMING_KEY pattern in `mode="list-create"`.
  const selectionColumn: ColumnDef<PartnerResult> | null = selection
    ? {
        id: "select",
        header: () => {
          const allSelected = selection.selectAllState === "all";
          const someSelected = selection.selectAllState === "some";
          return (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={
                  allSelected ? true : someSelected ? "indeterminate" : false
                }
                onCheckedChange={() => selection.onToggleAll()}
                aria-label={allSelected ? "Deselect all" : "Select all"}
              />
            </div>
          );
        },
        cell: ({ row }) => {
          const isSelected =
            (row.original as PartnerResult & { [SELECTED_KEY]?: boolean })[
              SELECTED_KEY
            ] ?? false;
          return (
            <div className="flex items-center justify-center">
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => selection.onToggleRow(row.original)}
                aria-label={
                  isSelected
                    ? `Deselect ${row.original.name}`
                    : `Select ${row.original.name}`
                }
              />
            </div>
          );
        },
        size: 40,
        minSize: 40,
        enableSorting: false,
      }
    : null;

  const dataColumns: ColumnDef<PartnerResult>[] = [
    {
      id: "partner_name",
      accessorFn: (row) => row.name,
      header: "Name",
      size: 220,
      minSize: 140,
      meta: { cell: { variant: "short-text" as const } },
      enableSorting: true,
      // DR-I (2026-05-15): split prior "Partner" composite column into
      // Name + URL per founder verbatim 2026-05-15 "the partner column
      // shouldn't return as is. it should be 'name' and 'URL' in separate
      // column." Mirrors the existing discover/list-detail `buildPartner
      // Columns` shape (lines 256-298) which has separate Name + Domain.
      //
      // PRD `pre-launch-feedback/results-table-chrome-cleanup` Issue 5a
      // (2026-05-15) — IPP typographic rail spine REMOVED at rest. Founder
      // verbatim feedback.zip Issue 5: "thick vertical line `|` before
      // every Name row ... adds visual noise without communicating
      // anything actionable." Reverses C14 slice 5 (2026-05-08) + the
      // V1.5+ surgical-cut Sub-issue 3 deferred-tier-color closure
      // (2026-05-09). The fit-score tier signal moves entirely to the
      // partner detail panel's IPP fit tab — CLAUDE.md "Panel owns
      // reasoning, freshness, and quality." Inline hover preview of top
      // satisfied criteria preserved on the bare Name span (still
      // communicates "this row matches" without painting a heavy rail
      // down the left edge of the table).
      cell: ({ row }) => {
        const r = row.original;

        // PRD Issue 5a (2026-05-15) — hover preview survives the rail
        // removal. Top 2 satisfied criteria surfaced; the panel's IPP
        // fit + Evidence tabs remain canonical for full breakdown.
        const topMatches = criteria
          .filter((c) => r.criteriaMatches[c.id]?.satisfied === "yes")
          .slice(0, 2);

        const trigger = (
          <span className="block truncate text-foreground">{r.name}</span>
        );

        if (topMatches.length === 0) return trigger;

        return (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-xs">
              <ul className="flex flex-col gap-1">
                {topMatches.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start gap-1.5 text-left"
                  >
                    <span aria-hidden>✓</span>
                    <span className="block">{c.description}</span>
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        );
      },
    },
    // PRD-6 (entity selector; 2026-05-15) — entity-default columns. Company
    // keeps the DR-I URL column (founder verbatim 2026-05-15: "the partner
    // column shouldn't return as is. it should be 'name' and 'URL' in
    // separate column."). Person replaces URL with the four canonical
    // person-default columns per PRD User Story 4: Title / Company
    // affiliation / Location / LinkedIn. All read from `personOverview`
    // (or fallthrough to `partner.title` / `linkedin_url` / `company_
    // affiliation` once V1 person DB rows materialize).
    //
    // HR 24 exhaustiveness: `entity satisfies "company" | "person"` keyword
    // pattern at the bottom of the switch (compile error when V1.6 widens).
    // HR 11 plum + sand only; HR 4 sentence case; HR 19 every column cites
    // PRD source.
    ...((): ColumnDef<PartnerResult>[] => {
      switch (entity) {
        case "company":
          return [
            {
              // DR-I (2026-05-15): plain-text URL column. Per founder
              // verbatim 2026-05-15 "the partner column shouldn't return as
              // is. it should be 'name' and 'URL' in separate column."
              // Plain text (NOT an `<a>`) since row-click already opens
              // the partner detail panel; an in-cell link would conflict
              // (URL click would either navigate OR open panel).
              // Muted-foreground preserves the prior visual hierarchy
              // where domain was secondary metadata in the composite cell.
              // CLAUDE.md "Cell has no provenance decoration" — no
              // favicon, no source dot.
              //
              // PRD `discover/results/grid-url-column-header-chrome-
              // investigate-and-fix` (toolbar `bUjBYclivI3j` 2026-05-16;
              // founder verbatim *"why is this here?"* on the URL column
              // header dropdown popper) — chrome dropdown REMOVED. After
              // the 2026-05-15 chrome cleanup PR (Issue 7) stripped
              // Pin/Hide grid-wide, URL's dropdown carried only Sort
              // asc/desc — and alphabetical URL sort is a near-no-op
              // signal (domains typically start with the company name →
              // sort by URL ≈ sort by Name, which already sorts).
              // `enableSorting: false` + function-`header:` form bypasses
              // `DataGridColumnHeader` chrome entirely (CLAUDE.md "DiceUI
              // custom-cell branch gates on `cell:` form, not `header:`
              // form" — the header-side gate at `components/data-grid/
              // data-grid.tsx:243-253` routes function-headers to a
              // chromeless `<div>`). Mirrors the `select` column
              // precedent (line ~539: *"Function `header:` form bypasses
              // `DataGridColumnHeader` chrome (sort/pin/hide dropdown is
              // meaningless for a checkbox column)."*). Resize handle
              // also disappears with the chrome — acceptable for a
              // display column at fixed `size: 160`.
              id: "partner_domain",
              accessorFn: (row) => row.domain ?? "",
              header: () => (
                // Wrapping `<div className="size-full px-3 py-1.5">` is
                // applied by `components/data-grid/data-grid.tsx:245`
                // around every function-header — no extra padding here.
                // `text-sm` matches `DataGridColumnHeader`'s
                // `DropdownMenuTrigger` (line 116 of data-grid-column-
                // header.tsx) so URL's label visually aligns with the
                // sibling Name column's chrome label.
                <div className="flex size-full items-center text-sm">
                  <span className="truncate">URL</span>
                </div>
              ),
              size: 160,
              minSize: 100,
              meta: { cell: { variant: "short-text" as const } },
              enableSorting: false,
              cell: ({ row }) => {
                const domain = row.original.domain;
                if (!domain) return null;
                return (
                  <span className="block truncate text-muted-foreground">
                    {domain}
                  </span>
                );
              },
            },
          ];
        case "person":
          return [
            {
              // PRD-6 User Story 4 — Title column. Reads from
              // `personOverview.position` (Exa
              // `properties.person.position`) per skill
              // `.claude/skills/exa-websets-api-contract/SKILL.md` §
              // "WebsetItem properties — Person".
              id: "person_title",
              accessorFn: (row) => row.personOverview?.position ?? "",
              header: "Title",
              size: 180,
              minSize: 100,
              meta: { cell: { variant: "short-text" as const } },
              enableSorting: true,
              cell: ({ row }) => {
                const position = row.original.personOverview?.position;
                if (!position) return null;
                return (
                  <span className="block truncate text-foreground">
                    {position}
                  </span>
                );
              },
            },
            {
              // PRD-6 User Story 4 — Company affiliation column. V1.5
              // typically NULL on Exa-derived rows (Exa doesn't surface a
              // structured company-affiliation field; V1.6 parses out of
              // `position` per `personOverview.companyAffiliation` JSDoc).
              // Column still renders so the user sees the empty state +
              // can sort by populated affiliation when V1.6 lands.
              id: "person_company",
              accessorFn: (row) =>
                row.personOverview?.companyAffiliation ?? "",
              header: "Company",
              size: 160,
              minSize: 100,
              meta: { cell: { variant: "short-text" as const } },
              enableSorting: true,
              cell: ({ row }) => {
                const affiliation =
                  row.original.personOverview?.companyAffiliation;
                if (!affiliation) return null;
                return (
                  <span className="block truncate text-muted-foreground">
                    {affiliation}
                  </span>
                );
              },
            },
            {
              // PRD-6 User Story 4 — Location column. Reads from
              // `personOverview.location` (Exa
              // `properties.person.location`).
              id: "person_location",
              accessorFn: (row) => row.personOverview?.location ?? "",
              header: "Location",
              size: 140,
              minSize: 80,
              meta: { cell: { variant: "short-text" as const } },
              enableSorting: true,
              cell: ({ row }) => {
                const location = row.original.personOverview?.location;
                if (!location) return null;
                return (
                  <span className="block truncate text-muted-foreground">
                    {location}
                  </span>
                );
              },
            },
            {
              // PRD-6 User Story 4 — LinkedIn column. Resolves from
              // `personOverview.linkedinUrl` (Exa `properties.person.linkedinUrl`
              // OR url-detection fallback in `execution-hydrate.ts:buildPersonOverview`).
              // Rendered as plain-text URL (not `<a>` per CLAUDE.md "Cell
              // has no provenance decoration" + row-click conflict; the
              // panel's Overview tab carries the clickable link).
              id: "person_linkedin",
              accessorFn: (row) => row.personOverview?.linkedinUrl ?? "",
              header: "LinkedIn",
              size: 200,
              minSize: 100,
              meta: { cell: { variant: "short-text" as const } },
              enableSorting: true,
              cell: ({ row }) => {
                const url = row.original.personOverview?.linkedinUrl;
                if (!url) return null;
                // Strip `https://www.linkedin.com/` prefix for display.
                const displayed = url
                  .replace(/^https?:\/\/(www\.)?linkedin\.com\//i, "")
                  .replace(/^\/+/, "");
                return (
                  <span className="block truncate text-muted-foreground">
                    {displayed || url}
                  </span>
                );
              },
            },
          ];
        default: {
          // HR 24 exhaustiveness — compile error when V1.6 widens the
          // V15SearchEntity narrow.
          const _exhaustive: never = entity;
          void _exhaustive;
          return [];
        }
      }
    })(),
    ...criteria.map(
      (c): ColumnDef<PartnerResult> => ({
        id: `criterion:${c.id}`,
        accessorFn: (row) => row.criteriaMatches[c.id]?.satisfied ?? "unclear",
        // DR-E (Discover Results PRD §6, 2026-05-15) — drop the "Criterion · "
        // prefix from criterion column headers per founder verbatim *"we
        // dont need the word 'criterion' before each criterion"*. The
        // criterion description carries enough signal on its own; the
        // prefix added redundant scaffolding. The colorClass dot prefix
        // (line below, `meta.colorClass`) still differentiates criterion
        // columns from enrichment columns visually. Reverses the 2026-
        // 05-10 audit-fix PR 4 framing.
        header: c.description,
        size: 180,
        minSize: 120,
        meta: {
          cell: { variant: "short-text" as const },
          // Exa Tier 2 #6 — color dot prefix paired with `<StopCriteria>`
          // row colors. Same helper consumed on both surfaces.
          colorClass: getCriterionColorClass(c.id),
        },
        cell: ({ row }) => {
          const match = row.original.criteriaMatches[c.id];
          if (!match || match.satisfied === "unclear") {
            // Audit cycle 2 — D.1 — three states render bare em-dash at
            // near-identical contrast without disambiguation: mid-stream
            // unclear (Exa still evaluating), terminal unclear (we checked,
            // evidence incomplete), terminal `no` (we checked, partner
            // fails). Cell state machine reference: CLAUDE.md "Architecture
            // essentials → Cell state machine" + "Four terminal resolution
            // branches, three transient".
            //
            // Mid-stream unclear → subtle pulse keyframe (same animation
            // contract as `<StreamingCell>`'s `processing` state at line
            // ~833). Signals "still working" without stealing the focal
            // streaming banner per brief §Composition rule #3.
            if (isStreaming) {
              return (
                <span
                  className="inline-block h-4 w-8 rounded-md bg-muted/40 animate-pulse"
                  role="status"
                  aria-label="Evaluating criterion"
                />
              );
            }
            // Terminal unclear → em-dash + `cursor-help` + tooltip. Provides
            // sighted users a cursor change + keyboard/AT users the
            // distinction via tooltip body. WCAG 1.4.11 non-text contrast
            // bump from `/40` (~1.7:1) to `/60` (~2.7:1) preserved.
            return (
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <span
                    className="text-muted-foreground/60 cursor-help select-none"
                    aria-label="Unclear — partner may match, evidence incomplete"
                  >
                    —
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  Unclear — partner may match, evidence incomplete
                </TooltipContent>
              </Tooltip>
            );
          }
          if (match.satisfied === "yes") {
            // Affirmative → muted neutral pill (no semantic green per
            // CLAUDE.md HR "Affirmative pills use text-foreground bg-muted").
            // Slice 2 C7+C8 (plum-9 dot prefix) NOT applied — would steal
            // "one loud element" from the streaming banner per brief
            // §Composition rule #3. Documented scope-cut in PR body.
            return (
              <span
                className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-foreground"
                aria-label="Satisfied"
              >
                ✓
              </span>
            );
          }
          // Audit cycle 2 — D.1 — terminal `no` (`confirmed_null` analogue
          // on criteria cells). Em-dash + `cursor-help` + tooltip "Does
          // not match" so sighted users get a cursor cue + keyboard/AT
          // users get the distinction via tooltip body. Distinct from
          // unclear: tooltip body differs + contrast at `/70` (vs `/60`).
          // Slice 2 (C12) WCAG bump from `/60` to `/70` (~3.3:1) preserved.
          return (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <span
                  className="text-muted-foreground/70 cursor-help"
                  aria-label="Does not match"
                >
                  —
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Does not match
              </TooltipContent>
            </Tooltip>
          );
        },
      }),
    ),
    ...enrichments.map(
      (e): ColumnDef<PartnerResult> => ({
        id: `enrichment:${e.id}`,
        // Expose `ev.kind` (or "empty") in the accessor so TanStack column-
        // level equality + the cell memo's `row.original[columnId]` probe
        // sees a different value on every state transition (e.g. processing
        // → value on Exa completion). Otherwise the memo wall holds and the
        // shimmer-to-value transition never paints. Mirrors the CSV-mode
        // pattern at the streaming-cell columns above (`row[STREAMING_KEY]
        // ?.[field.name]?.state ?? "empty"`).
        accessorFn: (row) => {
          const ev = row.enrichmentValues[e.id];
          if (!ev) return "empty";
          if (ev.kind === "value") return String(ev.value ?? "");
          return ev.kind;
        },
        // DR-E (Discover Results PRD §6, 2026-05-15) — drop the "Evidence · "
        // prefix from enrichment column headers per founder verbatim
        // *"apart from not needing the word 'criterion' before every
        // criterion, we also don't need the word 'evidence' before every
        // enrichment. just the enrichment is needed."* The enrichment
        // description carries enough signal on its own. Reverses the
        // 2026-05-10 audit-fix PR 4 framing.
        header: e.description,
        size: 200,
        minSize: 120,
        // Phase 3B Exa parity Tier 2 #8 — per-column overflow menu actions
        // (Rerun / Edit / Delete) opt-in only on enrichment columns.
        // Criteria + partner_name columns intentionally do NOT get these
        // recovery affordances; they target user-defined enrichments only.
        meta: {
          cell: { variant: "short-text" as const },
          actions: enrichmentCallbacks
            ? buildEnrichmentColumnActions(e.id, enrichmentCallbacks)
            : undefined,
        },
        cell: ({ row }) => {
          const ev = row.original.enrichmentValues[e.id];
          // Render-branch order (CLAUDE.md "Architecture essentials → Cell
          // state machine"): empty → processing → error → inconclusive →
          // confirmed_null → confirmed_value. The `ev.kind satisfies "value"`
          // guard at the bottom is the exhaustiveness check — adding a new
          // EnrichmentValue variant breaks compile here until handled.
          if (!ev) {
            // Slice 2 (C12) — WCAG bump `/40` → `/60` for empty/idle state.
            return (
              <span className="text-muted-foreground/60 select-none">—</span>
            );
          }
          if (ev.kind === "processing") {
            // V1.0 streaming partial-fidelity (Wave 2 — `I-DISCOVER/launch/
            // v1-streaming-partial-fidelity`). Plum shimmer per
            // `.streaming-cell-shimmer` keyframe in `app/globals.css`
            // (existing canon — reused from CSV-mode `<StreamingCell>` at
            // line ~614). `aria-hidden` on the shimmer + an `aria-label`-d
            // wrapper communicates the in-flight state to assistive tech
            // without spamming the live region on every 3s SWR refresh.
            // `prefers-reduced-motion` automatically falls back to a
            // static `--plum-3` swatch (defined in the keyframe block).
            return (
              <span
                className="block"
                role="status"
                aria-label="Loading enrichment"
              >
                <span
                  aria-hidden
                  className="streaming-cell-shimmer block h-4 w-3/4 rounded-md"
                />
              </span>
            );
          }
          if (ev.kind === "error") {
            return (
              <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-micro text-destructive">
                Error
              </span>
            );
          }
          if (ev.kind === "inconclusive") {
            // Slice 2 (C12) — WCAG bump `/40` → `/60` for inconclusive state.
            return (
              <span
                className="text-muted-foreground/60 select-none"
                title="Not yet checked"
              >
                —
              </span>
            );
          }
          // ev.kind === "value" — exhaustiveness guard.
          ev.kind satisfies "value";
          if (ev.value === null || ev.value === undefined) {
            // Slice 2 (C12) — WCAG bump `/60` → `/70` for confirmed-null.
            // Mirrors the criterion-no treatment so confirmed-null reads as
            // a deliberate "we checked + nothing" vs unclear/idle.
            return (
              <span className="text-muted-foreground/70" aria-label="Not found">
                —
              </span>
            );
          }
          const str = String(ev.value);
          const isNumeric = !Number.isNaN(Number(str)) && str.trim() !== "";
          return (
            <span
              className={cn(
                "block truncate text-foreground",
                isNumeric && "font-mono tabular-nums",
              )}
            >
              {str}
            </span>
          );
        },
      }),
    ),
  ];

  return selectionColumn ? [selectionColumn, ...dataColumns] : dataColumns;
}

/* ------------------------------------------------------------------ */
/* Streaming cell renderer                                            */
/* ------------------------------------------------------------------ */

function StreamingCell({
  state,
  cell,
  field,
}: {
  state: CellStreamState;
  cell: EnrichmentCell | null;
  field: EnrichmentField;
}) {
  // Three pre-resolution states, visually distinct per product truth
  // (2026-04-19 decision): empty = idle, render nothing animated — the
  // row exists but no request has been dispatched. pending = queued with
  // Exa, neutral grey shimmer. processing = Exa is streaming data back,
  // plum shimmer. See docs/brand/preview/streaming-cells.html.
  if (state === "empty") {
    return <div className="h-4 w-3/4 rounded-md bg-muted/40" aria-hidden />;
  }
  if (state === "pending") {
    return (
      <div
        className="shimmer-cell-pending h-4 w-3/4 rounded-md"
        aria-hidden
      />
    );
  }
  if (state === "processing") {
    return (
      <div
        className="streaming-cell-shimmer h-4 w-3/4 rounded-md"
        aria-hidden
      />
    );
  }

  if (state === "error") {
    return (
      <span className="inline-flex items-center rounded-md bg-destructive/10 px-1.5 py-0.5 text-micro text-destructive">
        Error
      </span>
    );
  }

  if (state === "inconclusive") {
    return (
      <span
        className="text-muted-foreground/40 select-none"
        title="Not yet checked"
      >
        —
      </span>
    );
  }

  if (!cell || state === "confirmed_null") {
    return (
      <span className="text-muted-foreground/60" aria-label="Not found">
        —
      </span>
    );
  }

  state satisfies "confirmed_value";

  // V1 decision (2026-04-19): do not surface source / confidence / timestamp
  // on the cell itself. All evidence + provenance lives in the partner
  // detail panel (right sidebar) under the Evidence / IPP fit tab, revealed
  // on row click. No hover tooltip, no inline "·" source indicator, no
  // confidence score in V1 (defer confidence UI to post-V1).
  const { value } = cell;

  const inner: React.ReactNode = (() => {
    if (field.type === "boolean") {
      const normalized =
        typeof value === "string" ? value.trim().toLowerCase() : value;
      const truthy =
        normalized === true ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "1";
      return (
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-md",
            truthy
              ? "bg-muted text-foreground"
              : "bg-muted text-muted-foreground",
          )}
          aria-label={truthy ? "Yes" : "No"}
        >
          {truthy ? "✓" : "✗"}
        </span>
      );
    }

    if (field.type === "array" && Array.isArray(value)) {
      const shown = value.slice(0, 2);
      const extra = value.length - shown.length;
      return (
        <div className="flex flex-wrap gap-1">
          {shown.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-micro text-foreground"
            >
              {item}
            </span>
          ))}
          {extra > 0 && (
            <span className="text-micro text-muted-foreground">
              +{extra} more
            </span>
          )}
        </div>
      );
    }

    const str = String(value ?? "");
    const isNumeric = !Number.isNaN(Number(str)) && str.trim() !== "";
    return (
      <span className={cn("block truncate text-foreground", isNumeric && "font-mono tabular-nums")}>
        {str}
      </span>
    );
  })();

  return <span className="block">{inner}</span>;
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export function PartnerGrid(props: PartnerGridProps) {
  const { className, height = 600 } = props;

  if (props.mode === "list-create") {
    return (
      <EnrichmentDataGrid
        data={props.data}
        fields={props.fields}
        keyColumn={props.keyColumn}
        streaming={props.streaming}
        className={className}
        height={height}
      />
    );
  }

  if (props.mode === "results") {
    // 2026-05-10 audit-fix PR 1 — assemble the selection bundle when all
    // four pieces are wired (selectedById + onToggleRow + onToggleAll +
    // selectAllState). Partial wiring is deliberately ignored so
    // consumers without selection (e.g. legacy embeds, future read-only
    // shares) keep working unchanged.
    const resultsSelection =
      props.selectedById &&
      props.onToggleRow &&
      props.onToggleAll &&
      props.selectAllState
        ? {
            selectedById: props.selectedById,
            onToggleRow: props.onToggleRow,
            onToggleAll: props.onToggleAll,
            selectAllState: props.selectAllState,
          }
        : undefined;

    return (
      <ResultsDataGrid
        data={props.data}
        criteria={props.criteria}
        enrichments={props.enrichments}
        // PRD-6 (entity selector; 2026-05-15) — pipe entity through to the
        // grid's column builder. Default 'company' if the parent didn't
        // wire entity through (legacy callers / pre-PRD-6 sites).
        entity={props.entity ?? "company"}
        onRowClick={props.onRowClick}
        onRerunEnrichment={props.onRerunEnrichment}
        onEditEnrichment={props.onEditEnrichment}
        onDeleteEnrichment={props.onDeleteEnrichment}
        selection={resultsSelection}
        isStreaming={props.isStreaming ?? false}
        className={className}
        height={height}
      />
    );
  }

  const isDiscover = props.mode === "discover";
  const selection =
    isDiscover && props.selectedIds && props.onToggleRow
      ? { selectedIds: props.selectedIds, onToggleRow: props.onToggleRow }
      : undefined;

  return (
    <PartnerDataGrid
      data={props.data}
      readOnly={isDiscover}
      onRowClick={props.onRowClick}
      selection={selection}
      anchorFirst={isDiscover ? props.anchorFirst ?? false : false}
      className={className}
      height={height}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Partner grid (discover + list-detail)                              */
/* ------------------------------------------------------------------ */

function PartnerDataGrid({
  data,
  readOnly,
  onRowClick,
  selection,
  anchorFirst,
  className,
  height,
}: {
  data: Partner[];
  readOnly: boolean;
  onRowClick?: (partner: Partner) => void;
  selection?: {
    selectedIds: Set<string>;
    onToggleRow: (partner: Partner) => void;
  };
  anchorFirst: boolean;
  className?: string;
  height: number | "stretch";
}) {
  const columns = React.useMemo(
    () => buildPartnerColumns(readOnly, selection),
    [readOnly, selection],
  );

  const pinning = React.useMemo(
    () => ({ left: selection ? ["select", "name"] : ["name"] }),
    [selection],
  );

  const gridProps = useDataGrid<Partner>({
    data,
    columns,
    readOnly,
    enableSearch: true,
    enableSingleCellSelection: !readOnly,
    enablePaste: !readOnly,
    initialState: {
      columnPinning: pinning,
    },
  });

  return (
    <div
      className={cn(
        "flex flex-1 min-h-0 flex-col",
        // Anchor row crown (T-25): 3px plum-9 left rail + muted tint on row 0.
        // Scoped to this wrapper so list-detail + enrichment grids are unaffected.
        anchorFirst && "fuse-anchor-first",
        className,
      )}
    >
      <DataGrid<Partner>
        {...gridProps}
        height={height}
        stretchColumns
        onRowClick={onRowClick}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Enrichment grid (list-create / streaming mode)                     */
/* ------------------------------------------------------------------ */

function EnrichmentDataGrid({
  data,
  fields,
  keyColumn,
  streaming,
  className,
  height,
}: {
  data: CSVRow[];
  fields: EnrichmentField[];
  keyColumn: string;
  streaming?: UseStreamingCellsReturn;
  className?: string;
  height: number | "stretch";
}) {
  // Project streaming state onto each row so TanStack's row identity flips on
  // every SSE tick. `DataGridRow`'s memo comparator checks
  // `prev.row.original !== next.row.original`; without a new object per row,
  // the grid skips re-rendering and the pulse never appears (DA-lists-2).
  //
  // We intentionally rebuild every row on every `streaming` change because the
  // hook returns a fresh `streaming` object whenever `results` updates. For
  // the typical CSV size (5–500 rows, under the MAX_ROWS ceiling) this is
  // trivially cheap; React's reconciliation handles the rest.
  const rows: EnrichedCSVRow[] = React.useMemo(() => {
    return data.map((row, rowIndex) => {
      const snapshot: StreamingSnapshot = {};
      if (streaming) {
        for (const field of fields) {
          snapshot[field.name] = {
            state: streaming.getCellState(rowIndex, field.name),
            cell: streaming.getCellValue(rowIndex, field.name),
          };
        }
      }
      const enriched: EnrichedCSVRow = { ...row, [STREAMING_KEY]: snapshot };
      return enriched;
    });
  }, [data, fields, streaming]);

  const columns = React.useMemo(
    () => buildEnrichmentColumns(fields, keyColumn),
    [fields, keyColumn],
  );

  const gridProps = useDataGrid<EnrichedCSVRow>({
    data: rows,
    columns,
    readOnly: true,
    enableSearch: false,
    initialState: {
      columnPinning: { left: ["__key"] },
    },
  });

  return (
    <div className={cn("flex flex-1 min-h-0 flex-col", className)}>
      <DataGrid<EnrichedCSVRow>
        {...gridProps}
        height={height}
        stretchColumns
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Results grid (V1.0 New Search results mode)                        */
/* ------------------------------------------------------------------ */

/**
 * I-DISCOVER/launch/results-grid-perf-and-streaming-overlay (slice 1, Wave A
 * 2026-05-08): NO `STREAMING_KEY` snapshot pattern here.
 *
 * Why not. The CSV / `EnrichmentDataGrid` path stamps `__fuseStreaming` onto
 * each row (`partner-grid.tsx:830-844`) because its streaming state lives
 * OUTSIDE the row — `useStreamingCells` returns a `streaming` object whose
 * `getCellState` lookups must be projected onto rows so TanStack's row-identity
 * memo invalidates per tick. That's the mode-A bridge.
 *
 * The Results path is structurally different. SWR (`refreshInterval=3000` in
 * `results-flow.tsx`) returns a fresh `ExecutionPayload` every tick whose
 * `partners: PartnerResult[]` carries `criteriaMatches` + `enrichmentValues`
 * INLINE on each row. New SWR payload → new `data` reference → new row objects
 * → `DataGridRow`'s `row.original !== next.row.original` memo correctly
 * invalidates. There is no externalized streaming state to project; adding
 * `__fuseStreaming` here would be ceremony without a consumer.
 *
 * Karpathy 3rd-instance threshold: STREAMING_KEY has 1 consumer
 * (`EnrichmentDataGrid`) today. ResultsDataGrid would be the 2nd, not the 3rd
 * — and even at 3rd, the abstraction wouldn't fit because the projection step
 * is exactly what makes it useful for `EnrichmentDataGrid`. Don't extract a
 * primitive whose contract only one consumer needs.
 *
 * The actual cell-flicker root cause was column-derivation thrashing in the
 * parent (`results-flow.tsx`'s `visibleCriteria` / `visibleEnrichments`
 * rebuilding fresh arrays per render → `buildResultsColumns` memo invalidating
 * → columns rebuilding per tick). That's fixed at the source via `useMemo`.
 * Combined with `getRowId: (row) => row.id` below — which gives TanStack a
 * stable identity to track rows across SWR refetches when Exa re-orders —
 * cells stay in correct columns and re-orderings animate as transform shifts.
 */

function ResultsDataGrid({
  data,
  criteria,
  enrichments,
  entity,
  onRowClick,
  onRerunEnrichment,
  onEditEnrichment,
  onDeleteEnrichment,
  selection,
  isStreaming,
  className,
  height,
}: {
  data: PartnerResult[];
  criteria: Criterion[];
  enrichments: Enrichment[];
  // PRD-6 (entity selector; 2026-05-15) — drives the column-builder branch.
  // Default 'company' at the call site below.
  entity: V15SearchEntity;
  onRowClick?: (result: PartnerResult) => void;
  onRerunEnrichment?: (enrichmentId: string) => void | Promise<void>;
  onEditEnrichment?: (enrichmentId: string) => void;
  onDeleteEnrichment?: (enrichmentId: string) => void;
  // 2026-05-10 audit-fix PR 1 — see `ResultsMode.selectedById` jsdoc above.
  selection?: {
    selectedById: Map<string, { domain: string; name: string }>;
    onToggleRow: (result: PartnerResult) => void;
    onToggleAll: () => void;
    selectAllState: "all" | "some" | "none";
  };
  // Audit cycle 2 — D.1 — see `ResultsMode.isStreaming` jsdoc above.
  isStreaming: boolean;
  className?: string;
  height: number | "stretch";
}) {
  // Bundle the callbacks so the columns memo's dep list stays small. Any
  // callback transition flips the bundle identity → columns rebuild → header
  // dropdown re-binds. Parents should pass stable (useCallback'd) handlers.
  const enrichmentCallbacks = React.useMemo(() => {
    if (!onRerunEnrichment && !onEditEnrichment && !onDeleteEnrichment) {
      return undefined;
    }
    return {
      onRerun: onRerunEnrichment,
      onEdit: onEditEnrichment,
      onDelete: onDeleteEnrichment,
    };
  }, [onRerunEnrichment, onEditEnrichment, onDeleteEnrichment]);

  // 2026-05-10 audit-fix PR 1 — pass only the handler triplet to
  // `buildResultsColumns`. The cell reads `row.original[SELECTED_KEY]`
  // (projected below) instead of closing over `selectedById`, so the
  // memo's dep list excludes the Map identity (which flips on every
  // toggle). Stable column references → no per-toggle column rebuild.
  const columnHandlers = React.useMemo(
    () =>
      selection
        ? {
            onToggleRow: selection.onToggleRow,
            onToggleAll: selection.onToggleAll,
            selectAllState: selection.selectAllState,
          }
        : undefined,
    [selection],
  );
  const columns = React.useMemo(
    () =>
      buildResultsColumns(
        criteria,
        enrichments,
        enrichmentCallbacks,
        columnHandlers,
        isStreaming,
        entity,
      ),
    [criteria, enrichments, enrichmentCallbacks, columnHandlers, isStreaming, entity],
  );

  // 2026-05-10 audit-fix PR 1 — project per-row selected state onto each
  // row so `DataGridRow`'s `prev.row.original !== next.row.original` memo
  // invalidates on selection change (Codex P2 #2 on PR #541 first review).
  // Mirrors the STREAMING_KEY pattern in `EnrichmentDataGrid` below.
  // Cost: one fresh object spread per row per selection toggle. V1.0 page
  // size caps at 100 (`PAGE_SIZE_OPTIONS` in `results-flow.tsx`); cheap.
  // No-op when selection is absent — return `data` directly so consumers
  // without selection (read-only embeds) keep referential stability.
  const projectedData = React.useMemo(() => {
    if (!selection) return data;
    return data.map((row) => ({
      ...row,
      [SELECTED_KEY]: selection.selectedById.has(row.id),
    }));
  }, [data, selection]);

  // 2026-05-10 audit-fix PR 1 — pin the select column to the left of
  // partner_name so it stays visible when the user scrolls criteria /
  // enrichment columns horizontally. Memoize so the columns memo's dep
  // identity stays stable when selection toggles between provided/absent
  // (rare; prevents needless TanStack column-pin re-bindings).
  //
  // DR-I (2026-05-15): partner_domain (URL) also pinned-left alongside
  // partner_name — both columns are paired identifiers; scrolling criteria
  // / enrichments horizontally should not detach the URL from its name.
  //
  // PRD-6 (2026-05-15): person entity pins Name + Title (the canonical
  // identity pair for individuals) instead of Name + URL. Mirrors the
  // company-mode pairing rationale — the panel-opening name + its most-
  // identity-bearing sibling stay glued together when scrolling
  // horizontally through criteria + enrichments.
  const columnPinning = React.useMemo(() => {
    const identityPair: string[] =
      entity === "person"
        ? ["partner_name", "person_title"]
        : ["partner_name", "partner_domain"];
    return {
      left: selection ? ["select", ...identityPair] : identityPair,
    };
  }, [selection, entity]);

  const gridProps = useDataGrid<PartnerResult>({
    data: projectedData,
    columns,
    readOnly: true,
    enableSearch: true,
    // I-DISCOVER/launch/results-grid-perf-and-streaming-overlay (slice 1,
    // Wave A 2026-05-08): stable row identity across SWR ticks.
    //
    // `useDataGrid` extends `Omit<TableOptions<TData>, ...>` (line 114) and
    // spreads `...propsRef.current` into `tableOptions` at line 2151, so
    // `getRowId` flows through to TanStack `useReactTable` directly — no
    // wrapper-side modification needed.
    //
    // Without it, TanStack defaults to row index, which makes row identity
    // POSITIONAL: when Exa re-orders rows mid-stream (e.g., a higher-relevance
    // item promotes), the user sees content shift between rows in place
    // instead of rows transforming to new positions. With `(row) => row.id`,
    // TanStack tracks rows by Exa's stable `WebsetItem.id` (the `witem_*`
    // string); re-orderings animate as smooth transform shifts.
    //
    // Source for `row.id` stability: `.claude/skills/exa-websets-api-contract/SKILL.md`
    // §"WebsetItem" (id is canonical + stable across webset GET requests).
    getRowId: (row) => row.id,
    initialState: {
      // NS-RS-04 — partner_name is pinned-left so the click-to-open-panel
      // affordance stays visible when the user scrolls criteria/enrichment
      // columns horizontally. 2026-05-10 audit-fix PR 1 prepends the
      // select column when multi-select is wired.
      columnPinning,
    },
  });

  return (
    <div className={cn("flex flex-1 min-h-0 flex-col", className)}>
      <DataGrid<PartnerResult>
        {...gridProps}
        height={height}
        stretchColumns
        onRowClick={onRowClick}
      />
    </div>
  );
}
