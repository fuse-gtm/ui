import { Skeleton } from "@/components/ui/skeleton";

/**
 * @fuse/billing-tabs-skeleton — cold-load skeleton for the Settings → Billing
 * surface in fuse-web (`/settings/billing` route).
 *
 * Renders during the RSC fetch (lazy Free-tier grant, active-subscription
 * read, parallel internal-flag read). Without this, cold-load shows a blank
 * page during the await chain and then jump-cuts to the populated
 * BillingTabs once the promise resolves. Per the fuse-web settings-tabs
 * /critique pass 2026-05-14 finding #4: "something there during load" is
 * preferable to blank-then-content.
 *
 * Karpathy minimum-scope: mimics the structure (Tabs row + 3-card plan grid)
 * without trying to match every pixel. The skeleton is a placeholder, not
 * a sub-pixel-accurate preview.
 *
 * Visual primitives:
 *   - Reuses the canonical `<Skeleton>` primitive from `components/ui/
 *     skeleton.tsx` (animate-pulse + rounded-md + bg-muted). Brief-token
 *     aligned: `rounded-md` resolves to 4px per fuse-web `app/globals.css`
 *     --radius=0.25rem; bg-muted is the sand-3 muted token; no shadow.
 *   - Spacing scale per Sleek-pass brief §Spacing scale: `gap-4` (16px),
 *     `gap-8` (32px), `p-4` (16px). Avoids forbidden `gap-(3|5|6|14|20)` per
 *     HR 23 step 5.
 *   - No off-palette colors (no green/teal/blue/etc.); only sand-tokened
 *     muted.
 *
 * Server component — no client-side state, no event handlers. Renders inside
 * `<Suspense fallback={<BillingTabsSkeleton />}>` in the billing page.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/components/ui/skeleton` (canonical shadcn Skeleton primitive).
 */
export function BillingTabsSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      {/* Tabs row — 2 placeholder triggers (Plans + Usage) */}
      <div className="flex gap-2 border-b border-border">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-16" />
      </div>

      {/* Plan-card grid — 3 placeholder rows mimicking the flat plan list */}
      <div className="flex flex-col gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-4 rounded-md border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
