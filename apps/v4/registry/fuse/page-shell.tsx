import type { ReactNode } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * @fuse/page-shell — Fuse flow-state shell.
 *
 * Hard Rule 14 (flow-state pages share one shell):
 *   Outer wrapper is `flex flex-col gap-6 px-6 py-6`. Used by every flow-
 *   state surface — Discover new-search, Lists new-list, Settings, Discover
 *   results, partner-detail, etc. If you add a third flow-state page, it
 *   inherits this shell.
 *
 * Hard Rule 6 (breadcrumb is the eyebrow):
 *   Format: `{Partner type} > {Section} > {Page}`, left-aligned. Top-right
 *   of the same row carries Linear-style view controls (Display / Filter /
 *   Sort / +) passed via `rightSlot`. These are persistent and never mode-
 *   switch on selection. Bulk actions on selection appear in a floating
 *   bottom bar (NOT in rightSlot). Forbidden in rightSlot: notifications,
 *   avatar, help, upgrade, keyboard hints — those live in the sidebar's
 *   `...` menu.
 *
 * V1.5 scope (per D34 + D16 verdicts):
 *   rightSlot carries Sort-only at V1.5. Display + Filter activate at V1.6
 *   when Twenty's view-subsystem ports in (T-TWENTY-VIEWS-1/2/3).
 *
 * Built on shadcn primitives: <Breadcrumb> + <Button>. Consumes @fuse/tokens
 * for --foreground, --muted-foreground, --border, spacing, radius.
 *
 * Closes D34 CO-07 + DS-08 combined extraction (PageShell with rightSlot).
 *
 * Source design intent:
 *   /tmp/fuse-ds-21/ui_kits/fuse/Shell.jsx — design intent only;
 *   implementation uses shadcn primitives, not ZIP custom code.
 *   /tmp/fuse-ds-21/preview/components-breadcrumb.html — visual reference.
 */

export type BreadcrumbSegment = {
  /** The displayed text. Sentence case. */
  label: string;
  /** Optional href; if omitted, segment renders as the current page (non-link). */
  href?: string;
};

export type PageShellProps = {
  /**
   * Ordered breadcrumb segments — left-to-right.
   * Format per Hard Rule 6: `{Partner type} > {Section} > {Page}`.
   * Last segment renders as <BreadcrumbPage> (current; not a link).
   */
  breadcrumbSegments: BreadcrumbSegment[];
  /**
   * Right-aligned controls for the eyebrow row. V1.5: Sort only.
   * V1.6: Display / Filter / Sort / + (Twenty view-subsystem).
   * Bulk actions DO NOT belong here — those go in a floating bottom bar.
   */
  rightSlot?: ReactNode;
  /**
   * Page body. Rendered below the breadcrumb row. Receives the
   * `flex flex-col gap-6` from the outer wrapper.
   */
  children: ReactNode;
  /**
   * Optional className appended to the outer wrapper. Use for page-level
   * overrides only (e.g. `max-w-5xl`); do NOT override the gap-6 / px-6 /
   * py-6 invariants.
   */
  className?: string;
};

export function PageShell({
  breadcrumbSegments,
  rightSlot,
  children,
  className,
}: PageShellProps): ReactNode {
  const lastIndex = breadcrumbSegments.length - 1;

  return (
    <div
      className={`flex flex-col gap-6 px-6 py-6${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbSegments.map((segment, index) => {
              const isLast = index === lastIndex;
              return (
                <span
                  key={`${segment.label}-${index}`}
                  className="contents"
                >
                  <BreadcrumbItem>
                    {isLast || !segment.href ? (
                      <BreadcrumbPage>{segment.label}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink href={segment.href}>
                        {segment.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        {rightSlot ? (
          <div className="flex items-center gap-2">{rightSlot}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
