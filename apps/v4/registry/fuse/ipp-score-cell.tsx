"use client";

import { cn } from "@/lib/utils";

/**
 * @fuse/ipp-score-cell — Fuse-canon IPP (Ideal Partner Profile) score cell.
 *
 * Source of truth: fuse-web `components/grid/ipp-score-cell.tsx`.
 *
 * Renders a partner's IPP fit score (0-100) as a colored mini-bar +
 * tabular-nums numeric. Used in the Discover Results grid as the leading
 * sortable column.
 *
 * What this wrapper adds vs raw `<span>`:
 *
 *   - 3-stop threshold palette (HO-grid-1 lock per CLAUDE.md):
 *
 *       | Score range  | Bar color                       |
 *       |--------------|---------------------------------|
 *       | ≥ 75 (high)  | `bg-[var(--plum-9)]` (crown)    |
 *       | ≥ 50 (mid)   | `bg-[var(--sand-11)]`           |
 *       | < 50 (low)   | `bg-[var(--sand-8)]`            |
 *
 *     Per fuse-web HR 2 ("no semantic green") — bar moves through plum →
 *     sand, never green/yellow/red.
 *
 *   - Null/undefined guard: renders muted `--` placeholder for missing
 *     scores (e.g., pre-stream cells, partners with insufficient evidence).
 *
 *   - CLAUDE.md rule 20: cell has no provenance — no tooltip, no hover,
 *     no strengths/gaps surfacing. Plain-language factors live in the
 *     panel IPP fit tab; references live in the Evidence tab.
 *
 *   - 3px-wide × 20px-tall bar (`h-5 w-[3px]`) keeps the indicator visually
 *     restrained in dense grid contexts; numeric is `font-mono` +
 *     `tabular-nums` for stable column alignment.
 *
 * Consumer responsibilities (registry contract):
 *   - Provides `@/lib/utils` exporting `cn` helper (canonical shadcn utility).
 *   - Provides `--plum-9`, `--sand-11`, `--sand-8` CSS variables (canonical
 *     Radix `plum` + `sand` palette steps; install `@fuse/tokens`).
 */

interface IppScoreCellProps {
  score: number | null;
}

export function IppScoreCell({ score }: IppScoreCellProps) {
  if (score === null || score === undefined) {
    return <span className="font-mono text-micro text-muted-foreground/50">--</span>;
  }

  // HO-grid-1 palette: plum-9 crown on top tier, sand-11 mid, sand-8 low.
  // CLAUDE.md rule 20: cell has no provenance — no tooltip, no hover, no
  // strengths/gaps surfacing. Plain-language factors live in the panel
  // IPP fit tab; references live in the Evidence tab.
  const color =
    score >= 75
      ? "bg-[var(--plum-9)]"
      : score >= 50
        ? "bg-[var(--sand-11)]"
        : "bg-[var(--sand-8)]";

  return (
    <div className="flex items-center gap-2">
      <div className={cn("h-5 w-[3px] rounded-full", color)} />
      <span className="font-mono text-body tabular-nums">{score}</span>
    </div>
  );
}
