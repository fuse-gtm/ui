"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { mutate } from "swr";
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from "@stripe/react-stripe-js";

import { stripePromise } from "@/lib/billing/stripe-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanName } from "@/lib/billing/plans";

/**
 * @fuse/embedded-checkout-dialog — Stripe Embedded Checkout dialog with Fuse
 * design canon applied.
 *
 * Renders a Stripe Embedded Checkout iframe inside a shadcn `<Dialog>`.
 * Source of truth: fuse-web `components/billing/embedded-checkout-dialog.tsx`.
 *
 * What this wrapper adds vs raw `<Dialog>` + `<EmbeddedCheckoutProvider>`:
 *
 *   - `<Dialog modal={false}>` per fuse-web Hard Rule 12 + custom handlers
 *     for `onInteractOutside.preventDefault` + `onOpenAutoFocus.preventDefault`.
 *     Radix's default `modal={true}` applies `pointer-events: none` to portal
 *     siblings AND traps focus inside the dialog. Stripe's iframe (and the
 *     3DS challenge iframe stacked on top) lives outside Radix's portal
 *     subtree — under the default, the user can't type into the card field.
 *
 *   - Lazy mount: only renders `EmbeddedCheckoutProvider` when `open === true`.
 *     Without this gate, `fetchClientSecret` fires on first parent render,
 *     creating a stale Stripe session on every page visit.
 *
 *   - `fetchClientSecret` wrapped in `useCallback` with `[plan]` dep so it's
 *     stable across re-renders of the same plan.
 *
 *   - HR 24 fall-soft: fetch errors are caught + surfaced via toast; the
 *     dialog closes gracefully. The callback never silently swallows.
 *
 *   - HR 18 boundary: this component is CLIENT-only. DB writes happen
 *     exclusively in `POST /api/billing/create-checkout-session` (server-
 *     side); `orgId` is read server-side from the session — never passed in
 *     here.
 *
 *   - HR 23 step-5: no `shadow-(md|lg|xl|2xl)`, no non-plum-sand `bg-*`,
 *     no `rounded-(lg|xl|2xl|3xl|4xl)`, no `uppercase`, no off-scale `gap-*`.
 *
 *   - On success, revalidates SWR cache for `/api/billing/balance` (usage
 *     card) + `router.refresh()` to re-render the server page so the
 *     "Current plan" badge picks up the new subscription.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/lib/billing/stripe-client` module exporting `stripePromise`
 *     (canonical Stripe.js loader — module-scope; do NOT call `loadStripe()`
 *     inside a component per Stripe's docs).
 *   - Provides `@/lib/billing/plans` module exporting `PlanName` type.
 *   - Provides `@/components/ui/dialog` (canonical shadcn Dialog primitive).
 *   - Provides `POST /api/billing/create-checkout-session` server route that
 *     accepts `{ plan }` and returns `{ clientSecret }`.
 *   - Provides `GET /api/billing/balance` for SWR mutate post-completion.
 */

type EmbeddedCheckoutDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Extract<PlanName, "starter" | "pro">;
};

export function EmbeddedCheckoutDialog({
  open,
  onOpenChange,
  plan,
}: EmbeddedCheckoutDialogProps) {
  const router = useRouter();

  /**
   * Stable fetchClientSecret — fires on EmbeddedCheckoutProvider mount.
   * Calls the server route which calls Stripe `checkout.sessions.create`
   * with `ui_mode: "embedded_page"` and returns `{ clientSecret }`.
   *
   * HR 24 fall-soft: on any network / server error, catches + toasts
   * and re-throws (Stripe SDK requires the rejection to cancel the
   * provider mount cleanly; the dialog's <DialogContent> stays open
   * so the user can close manually).
   */
  const fetchClientSecret = useCallback(async (): Promise<string> => {
    try {
      const r = await fetch("/api/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (!r.ok) {
        const body = await r.json().catch(() => ({ message: "Checkout failed" }));
        throw new Error(
          (body as { message?: string; code?: string }).message ??
            (body as { code?: string }).code ??
            "Checkout failed",
        );
      }

      const data = (await r.json()) as { clientSecret: string };
      return data.clientSecret;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Couldn't start checkout";
      toast.error(message);
      // Re-throw so EmbeddedCheckoutProvider can surface an error state
      // rather than hanging indefinitely. The dialog stays open for the
      // user to close manually.
      throw err;
    }
  }, [plan]);

  /**
   * onComplete fires after a successful payment inside the Stripe iframe
   * (card flow only — redirect-only PMs hit `return_url` instead per the
   * route's `redirect_on_completion: "if_required"` setting).
   *
   * Steps:
   * 1. Close the dialog.
   * 2. Revalidate SWR cache for /api/billing/balance (usage card).
   * 3. `router.refresh()` to re-render the server page so the Plans-tab
   *    "Current plan" badge picks up the new subscription. The BA-Stripe
   *    webhook commits the subscription row pre-redirect via the plugin,
   *    so a refresh re-reads the new plan from `getActiveSubscription()`.
   *    Without this, the badge stays stale until next nav.
   * 4. Toast success.
   */
  const handleComplete = useCallback(() => {
    onOpenChange(false);
    void mutate("/api/billing/balance");
    router.refresh();
    toast.success("Upgrade complete");
  }, [onOpenChange, router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        className="max-w-2xl p-0"
        // Prevent Radix from auto-stealing focus on open or closing on
        // outside interaction. Stripe's iframe must be free to receive
        // focus / clicks from the user.
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/*
         * Accessible name comes from the sr-only DialogTitle below — the
         * canonical Radix accessible-name source. Avoid `aria-label` here:
         * it would override the DialogTitle and create an accessible-name
         * collision.
         */}
        <DialogHeader className="sr-only">
          <DialogTitle>
            Upgrade to {plan.charAt(0).toUpperCase() + plan.slice(1)}
          </DialogTitle>
        </DialogHeader>

        {/*
         * Lazy mount: only render the provider (and trigger fetchClientSecret)
         * when the dialog is open. This prevents stale Stripe sessions on
         * every parent render.
         *
         * When `open` transitions false → true, a fresh EmbeddedCheckoutProvider
         * mounts → calls fetchClientSecret → Stripe mounts the iframe.
         * When `open` transitions true → false, React unmounts the provider,
         * which destroys the Stripe session automatically.
         */}
        {open ? (
          <EmbeddedCheckoutProvider
            stripe={stripePromise}
            options={{
              fetchClientSecret,
              onComplete: handleComplete,
            }}
          >
            {/*
             * min-h keeps the dialog from collapsing while Stripe's iframe
             * loads. Stripe controls its own internal height via the iframe;
             * the dialog does not scroll — the iframe does. `<EmbeddedCheckout>`
             * accepts no className (Stripe controls sizing internally); the
             * wrapper handles all layout.
             */}
            <div className="min-h-[480px] w-full overflow-hidden rounded-md">
              <EmbeddedCheckout />
            </div>
          </EmbeddedCheckoutProvider>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
