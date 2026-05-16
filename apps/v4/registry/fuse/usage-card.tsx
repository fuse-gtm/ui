/**
 * @fuse/usage-card — Fuse-canon usage meter for tenant-scoped credit balance.
 *
 * Composes BillUI's static `UsageCard*` subcomponents (Path B per fuse-web
 * decision-log 2026-05-15 EVENING "BillUI usage-card adoption: Path B").
 *
 * What this wrapper adds vs raw `@billui/usage-card`:
 *
 *   - 3-stop threshold palette (audit-locked + Hard Rule 2 "no semantic green"
 *     in fuse-web CLAUDE.md):
 *
 *       | Remaining %  | Indicator token                |
 *       |--------------|--------------------------------|
 *       | > 20%        | `bg-primary` (plum-9)          |
 *       | ≤ 20%        | `bg-muted-foreground` (sand)   |
 *       | ≤ 5%         | `bg-destructive` (red)         |
 *
 *     Override via `*:data-[slot=progress-indicator]:bg-{...}` Tailwind
 *     attribute selector — never reaches for BillUI's binary `showOverage`
 *     red-only treatment.
 *
 *   - 2px (`rounded-sm`) inset-rail shape on the Progress bar — overrides
 *     shadcn Progress primitive's `rounded-full` default to preserve the
 *     audit-locked track shape. HR 23 step 5 grep gate covers `rounded-(lg|
 *     xl|2xl|3xl|4xl)` only; `rounded-full` is allowed by the gate but
 *     visually regresses the canonical track.
 *
 *   - 3 render states:
 *     1. `internal: true` org (founder/employee/demo): "Internal account"
 *        message; no meter.
 *     2. No active grant (brand-new org pre-cron): zero-state with
 *        forward-looking copy.
 *     3. Normal: meter + period dates + per-`operation_type` breakdown via
 *        `<UsageCardList collapsible visibleItems={3.5}>`.
 *
 *   - Live SWR refresh via `<UsageCardSWR>` — polls `/api/billing/balance`
 *     every 30s; first paint uses server-rendered `fallbackData` (no
 *     skeleton). Failures fall back to the most recent successful value.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/lib/billing/ledger` module exporting `UsageByTypeRow`
 *     interface (canonical shape: `{ operationType: string; count: number;
 *     consumed: number }`).
 *   - Provides `@/lib/utils` module exporting `cn` helper (canonical shadcn
 *     utility).
 *   - Provides `@/components/ui/usage-card` (the underlying BillUI primitive,
 *     installed via `@billui/usage-card`).
 *
 * HR 19 source citations: fuse-web canonical fitscore lives at
 * `components/billing/usage-card.tsx`; decision-log entry 2026-05-15 EVENING
 * + V-close 2.0.9 + ledger UNIQUE-violation behavior at `lib/billing/ledger.ts:
 * 194-204`; threshold palette at `docs/superpowers/audits/2026-04-22-audit-
 * stripe-billing-credits.md:253`.
 */
"use client";

import useSWR from "swr";

import {
  UsageCard as UsageCardRoot,
  UsageCardHeader,
  UsageCardSummary,
  UsageCardProgress,
  UsageCardList,
  UsageCardItem,
  UsageCardItemLabel,
  UsageCardItemValue,
} from "@/components/ui/usage-card";
import type { UsageByTypeRow } from "@/lib/billing/ledger";
import { cn } from "@/lib/utils";

export type { UsageByTypeRow };

export interface UsageCardProps {
  internal: boolean;
  granted: number | null;
  consumed: number | null;
  remaining: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  byType: ReadonlyArray<UsageByTypeRow>;
}

export function UsageCard({
  internal,
  granted,
  consumed,
  remaining,
  periodStart,
  periodEnd,
  byType,
}: UsageCardProps) {
  if (internal) {
    return <InternalAccountState />;
  }
  if (granted === null || granted === 0 || remaining === null) {
    return <ZeroState />;
  }
  return (
    <NormalState
      granted={granted}
      consumed={consumed ?? 0}
      remaining={remaining}
      periodStart={periodStart}
      periodEnd={periodEnd}
      byType={byType}
    />
  );
}

// -----------------------------------------------------------------------------
// Normal state — composes BillUI primitives + 3-stop threshold palette
// -----------------------------------------------------------------------------

function NormalState({
  granted,
  consumed,
  remaining,
  periodStart,
  periodEnd,
  byType,
}: {
  granted: number;
  consumed: number;
  remaining: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  byType: ReadonlyArray<UsageByTypeRow>;
}) {
  const percentRemaining = Math.max(
    0,
    Math.min(100, (remaining / granted) * 100),
  );
  // 3-stop threshold palette (audit-locked + HR 2). The
  // `*:data-[slot=progress-indicator]:bg-*` selector targets the indicator
  // child rendered by `components/ui/progress.tsx` — overrides BillUI's
  // default `bg-primary` indicator without touching the primitive.
  const indicatorClass =
    percentRemaining <= 5
      ? "*:data-[slot=progress-indicator]:bg-destructive"
      : percentRemaining <= 20
        ? "*:data-[slot=progress-indicator]:bg-muted-foreground"
        : "*:data-[slot=progress-indicator]:bg-primary";

  return (
    // BillUI `<UsageCard>` chrome at canonical Fuse radius + border + bg-card
    // per the primitive's on-install patch (see `components/ui/usage-card.tsx`
    // docstring for the radius / shadow / off-palette adjustments).
    <UsageCardRoot>
      <UsageCardHeader>
        <h2 className="text-h2 font-medium text-foreground">
          Credits this period
        </h2>
        <span className="text-dense text-muted-foreground tabular-nums">
          {formatPeriodRange(periodStart, periodEnd)}
        </span>
      </UsageCardHeader>

      <UsageCardSummary>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-body text-foreground">
            <span className="font-medium tabular-nums">
              {remaining.toLocaleString()}
            </span>
            <span className="text-muted-foreground">
              {" "}
              of{" "}
              <span className="tabular-nums">{granted.toLocaleString()}</span>{" "}
              credits remaining
            </span>
          </p>
          <p className="text-dense text-muted-foreground tabular-nums">
            {consumed.toLocaleString()} used
          </p>
        </div>

        <UsageCardProgress
          value={granted - remaining}
          max={granted}
          // `rounded-sm` (2px) overrides shadcn Progress primitive's
          // `rounded-full` default to preserve the audit-locked inset-rail
          // shape from pre-Path-B (see `git show origin/main:components/
          // billing/usage-card.tsx:115`). HR 23 step 5 grep gate covers
          // `rounded-(lg|xl|2xl|3xl|4xl)` only — `rounded-full` is allowed
          // by the gate but visually regresses the canonical track.
          className={cn(
            "h-2 rounded-sm bg-input *:data-[slot=progress-indicator]:rounded-sm",
            indicatorClass,
          )}
          aria-label={`${remaining} of ${granted} credits remaining`}
        />
      </UsageCardSummary>

      {byType.length > 0 && (
        <UsageCardList collapsible visibleItems={3.5} dividers>
          {byType.map((row) => (
            <UsageCardItem key={row.operationType}>
              <div className="flex min-w-0 flex-col items-start gap-0.5">
                <UsageCardItemLabel className="text-body">
                  {labelForOperationType(row.operationType)}
                </UsageCardItemLabel>
                <span className="text-micro text-muted-foreground tabular-nums">
                  {row.count.toLocaleString()}{" "}
                  {row.count === 1 ? "operation" : "operations"}
                </span>
              </div>
              <UsageCardItemValue className="text-body text-foreground">
                <span className="tabular-nums">
                  {row.consumed.toLocaleString()}
                </span>{" "}
                <span className="text-muted-foreground">credits</span>
              </UsageCardItemValue>
            </UsageCardItem>
          ))}
        </UsageCardList>
      )}
    </UsageCardRoot>
  );
}

// -----------------------------------------------------------------------------
// Internal account state — founder/employee/demo bypass
// -----------------------------------------------------------------------------

function InternalAccountState() {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-h2 font-medium text-foreground">Internal account</h2>
      <p className="text-body text-muted-foreground">
        Billing is not applied to internal accounts. Discover usage doesn&apos;t
        deduct credits, and no plan is required.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Zero state — brand-new org before first cron tick
// -----------------------------------------------------------------------------

function ZeroState() {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-h2 font-medium text-foreground">No credits yet</h2>
      <p className="text-body text-muted-foreground">
        Your Free-tier credits arrive on the 1st of the next calendar month, or
        as soon as you upgrade to a paid plan.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SWR wrapper — live refresh
// -----------------------------------------------------------------------------

/**
 * GET /api/billing/balance response shape — mirrors
 * `app/api/billing/balance/route.ts` in fuse-web. ISO-string dates because
 * JSON can't carry Date — wrapper deserializes on the client side.
 */
interface BalanceApiResponse {
  internal: boolean;
  granted: number | null;
  consumed: number | null;
  remaining: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  byType: ReadonlyArray<UsageByTypeRow>;
}

async function fetchBalance(url: string): Promise<BalanceApiResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return (await res.json()) as BalanceApiResponse;
}

/**
 * Live-refreshing wrapper around `<UsageCard>`. Polls
 * `/api/billing/balance` every 30s; first paint uses server-rendered
 * `fallbackData` (no skeleton). Failures fall back to the most recent
 * successful value (SWR default).
 *
 * The `fallbackData` prop accepts the SAME shape `<UsageCard>` itself
 * takes (Date objects) so the server page can pass the same object it
 * already constructed for the initial render.
 */
export function UsageCardSWR({ fallbackData }: { fallbackData: UsageCardProps }) {
  // Serialize Date → ISO string for the SWR fallback shape (matches API
  // response) so SWR doesn't trip over Date|null vs string|null on the
  // first hydrate tick.
  const initialApiShape: BalanceApiResponse = {
    internal: fallbackData.internal,
    granted: fallbackData.granted,
    consumed: fallbackData.consumed,
    remaining: fallbackData.remaining,
    periodStart: fallbackData.periodStart?.toISOString() ?? null,
    periodEnd: fallbackData.periodEnd?.toISOString() ?? null,
    byType: fallbackData.byType,
  };

  const { data } = useSWR<BalanceApiResponse>(
    "/api/billing/balance",
    fetchBalance,
    {
      refreshInterval: 30_000,
      fallbackData: initialApiShape,
      revalidateOnFocus: true,
    },
  );

  const props: UsageCardProps = data
    ? {
        internal: data.internal,
        granted: data.granted,
        consumed: data.consumed,
        remaining: data.remaining,
        periodStart: data.periodStart ? new Date(data.periodStart) : null,
        periodEnd: data.periodEnd ? new Date(data.periodEnd) : null,
        byType: data.byType,
      }
    : fallbackData;

  return <UsageCard {...props} />;
}

// -----------------------------------------------------------------------------
// Operation type → human-readable label
// -----------------------------------------------------------------------------

/**
 * Known `credit_consumption.operation_type` values per fuse-web
 * `lib/billing/pricing.ts` Operation union. Unknown values render via
 * `prettifyOperationType()` fallback so admin-grant / cron / future ops
 * don't render as raw snake_case in the UI.
 */
const OPERATION_TYPE_LABELS: Readonly<Record<string, string>> = {
  discover_search: "Discover searches",
  enrichment_row: "Enrichments",
  csv_import_resolve: "CSV imports",
};

function labelForOperationType(opType: string): string {
  return OPERATION_TYPE_LABELS[opType] ?? prettifyOperationType(opType);
}

function prettifyOperationType(opType: string): string {
  const words = opType.split("_");
  if (words.length === 0) return opType;
  const [first, ...rest] = words;
  return [
    (first?.charAt(0).toUpperCase() ?? "") + (first?.slice(1) ?? ""),
    ...rest,
  ].join(" ");
}

// -----------------------------------------------------------------------------
// Period range formatter — "May 1 – May 31" or "May 1, 2026 – May 31, 2026"
// -----------------------------------------------------------------------------

function formatPeriodRange(start: Date | null, end: Date | null): string {
  if (!start || !end) return "";
  const startStr = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  // `end` is exclusive (first of next month); display the last day of the
  // active period instead — `end - 1ms` is the last instant of the period.
  const displayEnd = new Date(end.getTime() - 1);
  const endStr = displayEnd.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${startStr} – ${endStr}`;
}
