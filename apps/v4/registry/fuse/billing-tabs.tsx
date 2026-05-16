"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
// Type-only import: `lib/billing/subscription` has a top-level
// `import { headers } from "next/headers"` (server-only API). A value-side
// import — even of small pure helpers — drags `next/headers` into the
// client bundle and crashes the build:
//   "You're importing a module that depends on 'next/headers'..."
// `import type` strips runtime side effects. `isInDunning` is inlined
// below so we don't need to import its value.
import type {
  ActiveSubscriptionInfo,
  SubscriptionStatus,
} from "@/lib/billing/subscription";
// Type-only import: `lib/billing/plans` reads `process.env.STRIPE_*_MONTHLY_PRICE_ID`
// at module init. Non-NEXT_PUBLIC env vars get inlined as `undefined` in the
// client bundle, so importing `PLANS` value-side here would silently strip
// every `priceId` to `null` and force every paid-tier CTA to "Contact us".
// The server page (`app/(app)/settings/billing/page.tsx`) resolves env vars
// at request time and passes the array down via the `plans` prop.
import type { FusePlan, PlanName } from "@/lib/billing/plans";
import {
  UsageCardSWR,
  type UsageCardProps,
} from "@/components/billing/usage-card";
import { EmbeddedCheckoutDialog } from "@/components/billing/embedded-checkout-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * @fuse/billing-tabs — Fuse-canon settings → billing surface composing
 * BA-Stripe + BillUI primitives.
 *
 * Source of truth: fuse-web `components/billing/billing-tabs.tsx`.
 *
 * Renders the Settings → Billing UX with 3 surface areas:
 *   1. Plans tab (default) — flat plan grid (Free / Starter / Pro / Enterprise)
 *      with current plan highlighted; "Upgrade" / "Manage billing" CTAs wired
 *      to `authClient.subscription.{upgrade, billingPortal}` per BA-Stripe.
 *   2. Usage tab — mounts `@fuse/usage-card` with the locked 3-stop palette
 *      (plum-9 >20% / sand-11 ≤20% / destructive ≤5%; HR 2 "no semantic green").
 *   3. Dunning banner — rendered ABOVE the Tabs when `subscription.status ∈
 *      {past_due, unpaid}` (Stripe Smart Retries window). CTA → billingPortal()
 *      so the user can update their payment method.
 *
 * Org-as-billing-entity discipline (HR 18 wrapper consumer):
 *   Every BA-Stripe call passes `referenceId: orgId` + `customerType:
 *   "organization"`. BA-Stripe's default is user-level billing; Fuse's
 *   `authorizeReference` (server-side authz check) only accepts org-level
 *   mutations. Without these explicit fields every upgrade is rejected 403.
 *
 * UC-B canonical Edit/secondary-action button: `variant="outline" size="sm"`
 *   per fuse-web founder lock 2026-05-15 Option β. Manage billing IS the
 *   Settings → Billing secondary affordance.
 *
 * Member-role gate: defense-in-depth UX — `role === "member"` renders an
 *   explanatory line instead of the button. BA's organization plugin enforces
 *   the permission server-side regardless; this avoids the click → portal
 *   call → permission-error-toast roundtrip.
 *
 * Embedded Checkout opt-in (`useEmbeddedCheckout`): when true, Upgrade CTA
 *   opens an embedded Stripe Checkout dialog (@fuse/embedded-checkout-dialog)
 *   instead of redirecting via `authClient.subscription.upgrade()`. Resolved
 *   server-side from `process.env.FUSE_USE_EMBEDDED_CHECKOUT === "true"` to
 *   avoid the client-bundle env-stripping footgun (CLAUDE.md known-quirk
 *   1.13.10: non-NEXT_PUBLIC_ env vars read value-side in "use client"
 *   components are silently inlined as `undefined`).
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/lib/auth/client` exporting `authClient` from
 *     `@better-auth/stripe/client`.
 *   - Provides `@/lib/billing/subscription` (type-only — top-level
 *     `import { headers } from "next/headers"` requires server-only;
 *     consumer imports types here).
 *   - Provides `@/lib/billing/plans` (type-only — reads non-NEXT_PUBLIC env
 *     vars at module init).
 *   - Provides `@/components/ui/button`, `@/components/ui/tabs`.
 *   - Provides `@/lib/utils` exporting `cn`.
 *   - Provides `@fuse/usage-card` (canonical UsageCardSWR wrapper).
 *   - Provides `@fuse/embedded-checkout-dialog` (canonical Stripe dialog).
 */
/**
 * Pure helper inlined from `lib/billing/subscription.isInDunning` to avoid
 * pulling that module's value side into the client bundle (see import note
 * above). Stays in sync with the server-side version trivially — two lines.
 */
function isInDunningStatus(status: SubscriptionStatus | null | undefined): boolean {
  return status === "past_due" || status === "unpaid";
}

export function BillingTabs({
  orgId,
  plans,
  activeSubscription,
  usage,
  useEmbeddedCheckout = false,
  role,
}: {
  /**
   * Active org id. Required for BA-Stripe upgrade + billingPortal calls
   * because Fuse uses org-as-billing-entity per CLAUDE.md "Pattern: BA-Stripe
   * + BillingSDK" §1 + decision-log entry B (2026-05-11). Without explicitly
   * passing `referenceId: orgId` + `customerType: "organization"`, BA-Stripe
   * defaults to user-level billing, which `authorizeReference` (Slice 7)
   * rejects — silent fail on every upgrade click.
   */
  orgId: string;
  /**
   * Plan registry resolved server-side. Server reads
   * `process.env.STRIPE_*_MONTHLY_PRICE_ID` (non-public env vars), which
   * cannot be inlined into the client bundle. Passing this prop is how
   * Starter / Pro get real Stripe price IDs in the browser.
   */
  plans: ReadonlyArray<FusePlan>;
  activeSubscription: ActiveSubscriptionInfo | null;
  usage: UsageCardProps;
  /**
   * When true, Upgrade CTA opens a Stripe Embedded Checkout dialog instead
   * of redirecting via `authClient.subscription.upgrade()`.
   *
   * Resolved server-side from `process.env.FUSE_USE_EMBEDDED_CHECKOUT === "true"`
   * in `app/(app)/settings/billing/page.tsx` and passed as a prop to avoid
   * the client-bundle env-stripping footgun (CLAUDE.md known-quirk 1.13.10:
   * non-NEXT_PUBLIC_ env vars read value-side in "use client" components are
   * silently inlined as `undefined`).
   *
   * ec-05 feature flag. Set `false` (default) to preserve the legacy
   * `authClient.subscription.upgrade()` path for reversibility.
   */
  useEmbeddedCheckout?: boolean;
  /**
   * Active member role on the active org. Owner + admin can open the Stripe
   * Customer Portal; member cannot (BA's organization plugin enforces this
   * server-side on `billingPortal()` via the canonical RBAC defaults at
   * `node_modules/.../organization/access/statement.mjs`). This client-side
   * gate is defense-in-depth UX: members see an explanatory line in place
   * of a button instead of clicking, waiting on a portal call, and getting
   * a permission error toast.
   *
   * Mirror of `app/(app)/settings/workspace/page.tsx:111-118` Codex P2 closure
   * pattern (PR #510 — surface permission boundary at render-time, not
   * after irreversible-op friction).
   *
   * Reads via existing `withOrgFor` boundary helper in
   * `app/(app)/settings/billing/page.tsx` — HR 18 compliant consumer, not
   * boundary author. BA writes "owner" / "admin" / "member" canonical values
   * to `member.role` (free-text column at `lib/db/schema.ts:248`); the page
   * narrows to this 3-arm union and falls soft to "member" (least-privileged)
   * on missing row per CLAUDE.md HR 18 defense-in-depth pattern.
   */
  role: "owner" | "admin" | "member";
}) {
  const currentPlanName: PlanName = activeSubscription?.plan.name ?? "free";
  const showDunningBanner = isInDunningStatus(activeSubscription?.status);

  return (
    <div className="flex flex-col gap-6">
      {showDunningBanner ? <DunningBanner orgId={orgId} /> : null}

      <Tabs defaultValue="plans" className="flex flex-col gap-6">
        <TabsList aria-label="Billing sections">
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="flex flex-col gap-6">
          <PlansList
            orgId={orgId}
            plans={plans}
            currentPlanName={currentPlanName}
            isPaidActive={
              activeSubscription !== null &&
              activeSubscription.status !== "canceled" &&
              !activeSubscription.cancelAtPeriodEnd
            }
            cancelsAt={
              activeSubscription?.cancelAtPeriodEnd
                ? activeSubscription.periodEnd
                : null
            }
            useEmbeddedCheckout={useEmbeddedCheckout}
          />
          <ManageBillingButton
            orgId={orgId}
            hasActiveSubscription={activeSubscription !== null}
            role={role}
          />
        </TabsContent>

        <TabsContent value="usage" className="flex flex-col gap-6">
          <UsageCardSWR fallbackData={usage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plans list — flat grid with current-plan highlight + Upgrade CTAs
// ---------------------------------------------------------------------------

function PlansList({
  orgId,
  plans,
  currentPlanName,
  isPaidActive,
  cancelsAt,
  useEmbeddedCheckout,
}: {
  orgId: string;
  plans: ReadonlyArray<FusePlan>;
  currentPlanName: PlanName;
  isPaidActive: boolean;
  cancelsAt: Date | null;
  useEmbeddedCheckout: boolean;
}) {
  // Hoisted dialog state — one dialog instance for the entire plans list,
  // not one per row. Closes review finding B9. Lazy-mount preserved: the
  // dialog is only rendered when `selectedPlan !== null`, which means the
  // EmbeddedCheckoutProvider only fires `fetchClientSecret` after the user
  // explicitly clicks Upgrade on a paid tier (Starter / Pro). Enterprise
  // (priceId === null) routes to mailto via `handleUpgrade` and never
  // touches this state.
  const [selectedPlan, setSelectedPlan] = useState<
    Extract<PlanName, "starter" | "pro"> | null
  >(null);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-h2 font-medium leading-tight text-foreground">
        Plans
      </h2>
      <ul className="flex flex-col gap-2">
        {plans.map((plan) => (
          <PlanRow
            key={plan.name}
            orgId={orgId}
            plan={plan}
            isCurrent={plan.name === currentPlanName}
            isPaidActive={isPaidActive}
            cancelsAt={
              plan.name === currentPlanName && cancelsAt ? cancelsAt : null
            }
            useEmbeddedCheckout={useEmbeddedCheckout}
            onOpenEmbeddedDialog={() => {
              if (plan.name === "starter" || plan.name === "pro") {
                setSelectedPlan(plan.name);
              }
            }}
          />
        ))}
      </ul>
      {selectedPlan ? (
        <EmbeddedCheckoutDialog
          open
          onOpenChange={(o) => {
            if (!o) setSelectedPlan(null);
          }}
          plan={selectedPlan}
        />
      ) : null}
    </div>
  );
}

function PlanRow({
  orgId,
  plan,
  isCurrent,
  isPaidActive,
  cancelsAt,
  useEmbeddedCheckout,
  onOpenEmbeddedDialog,
}: {
  orgId: string;
  plan: FusePlan;
  isCurrent: boolean;
  isPaidActive: boolean;
  cancelsAt: Date | null;
  useEmbeddedCheckout: boolean;
  /**
   * Callback to open the (hoisted) EmbeddedCheckoutDialog with this plan
   * selected. Only fires when `useEmbeddedCheckout === true` and this row
   * is Starter or Pro. Parent (`PlansList`) decides whether to actually
   * mount the dialog based on the active selected plan. Hoisted per
   * review finding B9.
   */
  onOpenEmbeddedDialog: () => void;
}) {
  const [isPending, setIsPending] = useState(false);

  const handleUpgrade = async () => {
    if (!plan.priceId) {
      // Enterprise — talk-to-us. Founder leads via email; no self-serve.
      window.location.href = "mailto:founder@fuse.gtm?subject=Enterprise plan inquiry";
      return;
    }
    setIsPending(true);
    try {
      const { error } = await authClient.subscription.upgrade({
        plan: plan.name,
        // Org-as-billing-entity: BA-Stripe defaults to user-level (customerType=
        // "user", referenceId=user.id). Our authorizeReference (Slice 7) ONLY
        // accepts org-level mutations, so without these explicit fields every
        // upgrade is rejected with 403. See decision-log entry B (2026-05-11).
        referenceId: orgId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ customerType: "organization" } as any),
        successUrl: "/settings/billing?upgrade=success",
        cancelUrl: "/settings/billing",
      });
      if (error) {
        toast.error(error.message ?? "Couldn't start checkout");
        setIsPending(false);
      }
      // On success, BA-Stripe redirects to Stripe Checkout — no further state to update.
    } catch (err) {
      console.error("[billing-tabs] upgrade error", err);
      toast.error("Couldn't start checkout");
      setIsPending(false);
    }
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border px-4 py-3 transition-colors sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        isCurrent
          ? "border-primary bg-primary/5"
          : "border-input hover:border-primary/40",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-h2 font-medium text-foreground">
            {plan.title}
          </span>
          {plan.badge ? (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-micro font-medium text-muted-foreground">
              {plan.badge}
            </span>
          ) : null}
          {isCurrent ? (
            <span className="text-micro font-medium text-primary">
              Current plan
            </span>
          ) : null}
        </div>
        <ul className="flex flex-col gap-0.5 text-body text-muted-foreground">
          {plan.features.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
        {cancelsAt ? (
          <p className="mt-1 text-dense text-destructive">
            Cancels at period end — {cancelsAt.toLocaleDateString()}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <div className="flex items-baseline gap-1">
          <span className="text-h2 font-medium text-foreground">
            {plan.monthlyPriceUsd === null
              ? "Custom"
              : `$${plan.monthlyPriceUsd}`}
          </span>
          {plan.monthlyPriceUsd !== null ? (
            <span className="text-dense text-muted-foreground">/month</span>
          ) : null}
        </div>
        {renderCTA({
          plan,
          isCurrent,
          isPaidActive,
          isPending,
          onUpgrade: handleUpgrade,
          useEmbeddedCheckout,
          onOpenEmbeddedDialog,
        })}
        {/*
         * EmbeddedCheckoutDialog is hoisted to <PlansList> per review
         * finding B9 — it's mounted once for the entire list, not once
         * per row. Lazy-mount semantics preserved: dialog only renders
         * when a paid-tier plan is selected.
         */}
      </div>
    </li>
  );
}

function renderCTA({
  plan,
  isCurrent,
  isPaidActive,
  isPending,
  onUpgrade,
  useEmbeddedCheckout,
  onOpenEmbeddedDialog,
}: {
  plan: FusePlan;
  isCurrent: boolean;
  isPaidActive: boolean;
  isPending: boolean;
  onUpgrade: () => void | Promise<void>;
  useEmbeddedCheckout: boolean;
  onOpenEmbeddedDialog: () => void;
}) {
  if (isCurrent && isPaidActive) {
    // Currently on this paid plan — no action needed; portal handles changes.
    return <span className="text-dense text-muted-foreground">Active</span>;
  }
  if (isCurrent && !isPaidActive) {
    // On Free tier (no Stripe sub) — no upgrade CTA on the Free row itself.
    return <span className="text-dense text-muted-foreground">Active</span>;
  }
  if (plan.priceId === null && plan.name === "free") {
    // Free row shown when user is on paid plan — show "Downgrade" via portal.
    return (
      <span className="text-dense text-muted-foreground">
        Downgrade via Manage billing
      </span>
    );
  }
  // ec-05 feature-flag switch: when embedded checkout is enabled AND this is
  // a paid tier (Starter/Pro have priceId), route Upgrade clicks to the
  // dialog opener. Enterprise (priceId === null) always falls through to
  // `onUpgrade` → handleUpgrade's mailto branch. Legacy
  // `authClient.subscription.upgrade()` path is preserved under
  // `onUpgrade` for reversibility per PRD §Reversibility.
  const handleClick =
    useEmbeddedCheckout && plan.priceId !== null
      ? onOpenEmbeddedDialog
      : onUpgrade;
  return (
    <Button
      size="sm"
      variant={plan.badge === "Most popular" ? "default" : "outline"}
      onClick={handleClick}
      disabled={isPending}
    >
      {plan.priceId === null
        ? "Contact us"
        : isPending
          ? "Loading…"
          : "Upgrade"}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// "Manage billing" button — Stripe Customer Portal
// ---------------------------------------------------------------------------

function ManageBillingButton({
  orgId,
  hasActiveSubscription,
  role,
}: {
  orgId: string;
  hasActiveSubscription: boolean;
  /**
   * Active member role. Member role sees an explanatory line instead of
   * the button (defense-in-depth UX; BA's organization plugin enforces the
   * permission server-side on `billingPortal()` regardless — this avoids
   * the member clicking → portal call → permission-error-toast roundtrip).
   * Mirrors `app/(app)/settings/workspace/page.tsx:142` owner-gate pattern
   * (Codex P2 closure, PR #510 review 2026-05-09).
   */
  role: "owner" | "admin" | "member";
}) {
  const [isPending, setIsPending] = useState(false);
  const handlePortal = async () => {
    if (!hasActiveSubscription) {
      toast.info("No active subscription to manage. Upgrade to a paid plan first.");
      return;
    }
    setIsPending(true);
    try {
      const { error } = await authClient.subscription.billingPortal({
        // Same org-as-billing-entity reasoning as upgrade — must scope the
        // portal session to the active org.
        referenceId: orgId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ customerType: "organization" } as any),
        returnUrl: "/settings/billing",
      });
      if (error) {
        toast.error(error.message ?? "Couldn't open billing portal");
        setIsPending(false);
      }
    } catch (err) {
      console.error("[billing-tabs] billingPortal error", err);
      toast.error("Couldn't open billing portal");
      setIsPending(false);
    }
  };

  // Member role: hide the destructive-adjacent affordance, render an
  // explanatory line per brief §Composition rules sentence-case. Server-side
  // BA RBAC still rejects member-role billingPortal() calls; this is UX
  // defense-in-depth (same pattern as workspace page `<DeleteOrganization>`
  // owner gate). Closes PRD US 9/10/11 + founder-feedback line 27 (Manage
  // billing missing role gate).
  if (role === "member") {
    return (
      <div className="flex items-center justify-start">
        <p className="text-muted-foreground text-body">
          Owners + admins manage billing.
        </p>
      </div>
    );
  }

  // UC-B canonical Edit / secondary-action button: `variant="outline" size="sm"`
  // per founder lock 2026-05-15 Option β ("explicit affordance — mainstream
  // Linear/Stripe Settings UX pattern"; slice `uc-b-edit-button-variant-
  // unification` in `docs/open.md`). Manage billing is the Settings → Billing
  // tab's secondary-action affordance (open Stripe portal to edit subscription
  // / payment method) — the Edit-equivalent across Settings. Prior shape
  // (`variant="ghost"` + `text-[12px]` + `cursor-pointer` + custom hover
  // overrides) re-implemented `outline`'s native chrome ad-hoc and was the
  // only non-canonical Edit/secondary affordance the UC-B audit surfaced
  // across all 7 Settings tabs. `cursor-pointer` is unnecessary — `<Button>`
  // is a native `<button>` element so the UA-default cursor already applies.
  return (
    <div className="flex items-center justify-start">
      <Button
        size="sm"
        variant="outline"
        onClick={handlePortal}
        disabled={isPending || !hasActiveSubscription}
        aria-busy={isPending}
      >
        {isPending ? (
          <>
            <Loader2Icon
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Opening
          </>
        ) : (
          "Manage billing"
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dunning banner — rendered when subscription is past_due / unpaid
// ---------------------------------------------------------------------------

function DunningBanner({ orgId }: { orgId: string }) {
  const [isPending, setIsPending] = useState(false);
  const handleUpdate = async () => {
    setIsPending(true);
    try {
      const { error } = await authClient.subscription.billingPortal({
        referenceId: orgId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ customerType: "organization" } as any),
        returnUrl: "/settings/billing",
      });
      if (error) {
        toast.error(error.message ?? "Couldn't open billing portal");
        setIsPending(false);
      }
    } catch (err) {
      console.error("[billing-tabs] dunning portal error", err);
      toast.error("Couldn't open billing portal");
      setIsPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-h3 font-medium text-foreground">
          Payment needs attention
        </p>
        <p className="text-body text-muted-foreground">
          Your last payment didn’t go through. Update your payment method to keep
          your plan active.
        </p>
      </div>
      <Button
        size="sm"
        variant="default"
        onClick={handleUpdate}
        disabled={isPending}
      >
        {isPending ? "Opening…" : "Update payment method"}
      </Button>
    </div>
  );
}
