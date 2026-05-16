"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Toggle } from "@/components/ui/toggle";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * @fuse/update-plan-card — Fuse-canon plan-comparison + upgrade UI.
 *
 * Wraps the shape of `dodopayments/billingsdk update-plan-card`
 * (https://billingsdk.com / `npx shadcn@latest add @billingsdk/update-plan-card`)
 * with Fuse design canon applied:
 *
 *   - Canonical type tokens — text-h2 (16px) / text-h3 (14px) / text-body
 *     (13px) / text-dense (12px) / text-micro (11px) replace `text-base` /
 *     `text-sm` / `text-xs` / `text-[10px]` / `text-[11px]` per
 *     `app/globals.css:334-397`. Closes the 4 arbitrary `text-[Npx]`
 *     violations in the BillingSDK vendored copy flagged by
 *     `scripts/fuse-rules.sh` Slice γ gate run (fuse-web PR #642).
 *
 *   - No rest-state shadows — Card sits flat at rest per CLAUDE.md HR 11 +
 *     Sleek-pass brief §Shadows. `shadow-sm` on the selected-row gradient
 *     dropped (was a Sleek-pass §17-design-review-001 finding on the
 *     vendored copy; closed for the wrapper here too).
 *
 *   - 4px radius hairline — `rounded-md` everywhere; `rounded-lg` /
 *     `rounded-xl` from the vendored copy collapse per CLAUDE.md HR 23
 *     step-5 gate (no `rounded-(lg|xl|2xl)+`).
 *
 *   - No semantic green — features inherit `text-muted-foreground`; no
 *     `iconColor` defaults. The vendored seed `iconColor` (green/orange/
 *     teal/blue/zinc) was already stripped per Fuse `lib/billingsdk-config.ts`
 *     comments; preserved here.
 *
 *   - Sentence case — "Upgrade plan" (default title) not "Upgrade Plan";
 *     "Current plan" not "Current Plan". HR 4 don't patronize.
 *
 *   - Hardware-accel friendly — motion transitions stay on opacity / y /
 *     height; no shadow animation; `transition-all` widening only on the
 *     row hover state (Tailwind built-in).
 *
 * Built on shadcn primitives: Card / Button / Badge / RadioGroup / Toggle /
 * Label. Consumes @fuse/tokens for --foreground, --muted-foreground,
 * --border, --primary, --muted, plus the type-scale utilities.
 *
 * @example
 *   import { UpdatePlanCard } from "@/components/fuse-update-plan-card";
 *   <UpdatePlanCard
 *     currentPlan={currentPlan}
 *     plans={plans}
 *     onPlanChange={(planId) => handleUpgrade(planId)}
 *     title="Upgrade plan"  // optional; defaults to "Upgrade plan"
 *   />
 *
 * Plan shape is BillingSDK-compatible — drop-in replacement for the vendored
 * `components/billingsdk/update-plan-card.tsx`. See
 * `lib/billingsdk-config.ts` (fuse-web) for the canonical Plan interface.
 */
export interface Plan {
  id: string;
  title: string;
  description: string;
  highlight?: boolean;
  type?: "monthly" | "yearly";
  currency?: string;
  monthlyPrice: string;
  yearlyPrice: string;
  buttonText: string;
  badge?: string;
  features: {
    name: string;
    icon: string;
    iconColor?: string;
  }[];
}

export interface UpdatePlanCardProps {
  currentPlan: Plan;
  plans: Plan[];
  onPlanChange: (planId: string) => void;
  className?: string;
  /** Defaults to "Upgrade plan" — sentence case per HR 4 + brand voice. */
  title?: string;
}

const easing = [0.4, 0, 0.2, 1] as const;

export function UpdatePlanCard({
  currentPlan,
  plans,
  onPlanChange,
  className,
  title,
}: UpdatePlanCardProps) {
  const [isYearly, setIsYearly] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | undefined>(
    undefined,
  );

  const getCurrentPrice = useCallback(
    (plan: Plan) => (isYearly ? `${plan.yearlyPrice}` : `${plan.monthlyPrice}`),
    [isYearly],
  );

  const handlePlanChange = useCallback((planId: string) => {
    setSelectedPlan((prev) => (prev === planId ? undefined : planId));
  }, []);

  return (
    <Card
      className={cn(
        // Card sits flat at rest per HR 11 + Sleek-pass brief §Shadows.
        // No shadow-sm / shadow-md / shadow-lg here.
        "mx-auto w-full max-w-xl overflow-hidden text-left",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        {/*
          text-h2 (16px) replaces vendored `text-base` (16px) per Fuse
          type-scale token convention. Sentence case (HR 4): "Upgrade plan"
          not "Upgrade Plan".
        */}
        <CardTitle className="text-h2 font-semibold">
          {title || "Upgrade plan"}
        </CardTitle>
        {/*
          text-h3 (14px) replaces vendored `text-sm` (14px) per Fuse type-scale.
        */}
        <div className="flex items-center gap-2 text-h3">
          <Toggle
            size="sm"
            pressed={!isYearly}
            onPressedChange={(pressed) => setIsYearly(!pressed)}
            className="px-3"
          >
            Monthly
          </Toggle>
          <Toggle
            pressed={isYearly}
            onPressedChange={(pressed) => setIsYearly(pressed)}
            className="px-3"
          >
            Yearly
          </Toggle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <RadioGroup value={selectedPlan} onValueChange={handlePlanChange}>
          <div className="space-y-2.5 sm:space-y-3">
            {plans.map((plan, index) => (
              <motion.div
                key={plan.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  layout: { duration: 0.3, ease: easing },
                  opacity: { delay: index * 0.05, duration: 0.3, ease: easing },
                  y: { delay: index * 0.05, duration: 0.3, ease: easing },
                }}
                onClick={() => handlePlanChange(plan.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handlePlanChange(plan.id);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={selectedPlan === plan.id}
                className={cn(
                  // rounded-md (4px) replaces vendored `rounded-lg sm:rounded-xl`
                  // per HR 23 step-5 gate. No rest-state shadow per HR 11 +
                  // Sleek-pass brief §Shadows: the vendored `shadow-sm` on the
                  // selected branch is dropped here.
                  "relative cursor-pointer overflow-hidden rounded-md border transition-all duration-200",
                  "focus-visible:ring-primary touch-manipulation focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  selectedPlan === plan.id
                    ? "border-primary from-muted/60 to-muted/30 bg-gradient-to-br"
                    : "border-border hover:border-primary/50",
                )}
              >
                <motion.div layout="position" className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-3">
                    <div className="flex min-w-0 flex-1 gap-2 sm:gap-3">
                      <RadioGroupItem
                        value={plan.id}
                        id={plan.id}
                        className="pointer-events-none mt-0.5 flex-shrink-0 sm:mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                          {/*
                            text-h3 (14px) replaces vendored `text-sm` (14px) /
                            `sm:text-base` (16px). The font-semibold + sm:font-medium
                            cascade preserved.
                          */}
                          <Label
                            htmlFor={plan.id}
                            className="cursor-pointer text-h3 leading-tight font-semibold sm:text-h2 sm:font-medium"
                          >
                            {plan.title}
                          </Label>
                          {plan.badge && (
                            // text-micro (11px) replaces vendored `text-[10px]`
                            // (sub-11px arbitrary) + `sm:text-xs` (12px). 11px is
                            // the canonical floor per Fuse type-scale; 10px would
                            // require an HR 19 carve-out cite for sub-11px. Closes
                            // 1 of 4 text-[Npx] violations.
                            <Badge
                              variant="secondary"
                              className="h-5 flex-shrink-0 px-1.5 py-0 text-micro sm:h-auto sm:px-2 sm:py-0.5 sm:text-dense"
                            >
                              {plan.badge}
                            </Badge>
                          )}
                        </div>
                        {/*
                          text-micro (11px) replaces vendored `text-[11px]` —
                          direct canonical-token swap, closes 1 of 4 violations.
                          sm:text-dense (12px) replaces vendored `sm:text-xs`.
                        */}
                        <p className="text-muted-foreground mt-1 text-micro leading-relaxed sm:text-dense">
                          {plan.description}
                        </p>
                        {plan.features.length > 0 && (
                          <div className="pt-2 sm:pt-3">
                            <div className="flex flex-wrap gap-1.5 sm:gap-2">
                              {plan.features.map((feature, featureIndex) => (
                                <div
                                  key={featureIndex}
                                  // rounded-sm (2px) replaces vendored `rounded-md`
                                  // / `sm:rounded-lg` per brief radius range.
                                  className="bg-muted/20 border-border/30 flex flex-shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 sm:gap-2"
                                >
                                  <div className="bg-primary h-1 w-1 flex-shrink-0 rounded-full sm:h-1.5 sm:w-1.5" />
                                  {/*
                                    text-micro (11px) replaces vendored `text-[10px]`
                                    sub-11px arbitrary + `sm:text-xs` (12px). Closes
                                    1 of 4 violations.
                                  */}
                                  <span className="text-muted-foreground text-micro leading-none whitespace-nowrap sm:text-dense">
                                    {feature.name}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="min-w-[60px] flex-shrink-0 text-right sm:min-w-[80px]">
                      {/*
                        text-h2 (16px) replaces vendored `text-base` (16px);
                        sm:text-h1 (22px) replaces vendored `sm:text-xl` (20px) —
                        upshift to canonical h1 size. Both within brief type ramp.
                      */}
                      <div className="text-h2 leading-tight font-bold sm:text-h1 sm:font-semibold">
                        {parseFloat(getCurrentPrice(plan)) >= 0
                          ? `${plan.currency}${getCurrentPrice(plan)}`
                          : getCurrentPrice(plan)}
                      </div>
                      {/*
                        text-micro (11px) replaces vendored `text-[10px]`
                        sub-11px arbitrary + `sm:text-xs` (12px). Closes the
                        4th of 4 violations.
                      */}
                      <div className="text-muted-foreground mt-0.5 text-micro sm:text-dense">
                        /{isYearly ? "year" : "month"}
                      </div>
                    </div>
                  </div>
                </motion.div>

                <AnimatePresence initial={false}>
                  {selectedPlan === plan.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{
                        height: "auto",
                        opacity: 1,
                        transition: {
                          height: { duration: 0.3, ease: easing },
                          opacity: {
                            duration: 0.25,
                            delay: 0.05,
                            ease: easing,
                          },
                        },
                      }}
                      exit={{
                        height: 0,
                        opacity: 0,
                        transition: {
                          height: { duration: 0.25, ease: easing },
                          opacity: { duration: 0.15, ease: easing },
                        },
                      }}
                      className="overflow-hidden"
                    >
                      <motion.div
                        initial={{ y: -8 }}
                        animate={{
                          y: 0,
                          transition: {
                            duration: 0.25,
                            delay: 0.05,
                            ease: easing,
                          },
                        }}
                        exit={{ y: -8 }}
                        className="px-3 pb-3 sm:px-4 sm:pb-4"
                      >
                        {/*
                          text-h3 (14px) replaces vendored `text-sm` (14px);
                          sm:text-h2 (16px) replaces vendored `sm:text-base`.
                          Button text-scale upshift through canonical tokens.
                          "Current plan" sentence case (HR 4).
                        */}
                        <Button
                          className="h-10 w-full touch-manipulation text-h3 font-medium sm:h-11 sm:text-h2"
                          disabled={selectedPlan === currentPlan.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlanChange(plan.id);
                          }}
                        >
                          {selectedPlan === currentPlan.id
                            ? "Current plan"
                            : "Upgrade"}
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
