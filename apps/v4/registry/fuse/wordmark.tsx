import type { CSSProperties, ReactNode } from "react";

/**
 * @fuse/wordmark — Fuse brand mark, wordmark, and composite logo.
 *
 * Three exports:
 *   - FuseMark   — pixel-terrace SVG logomark (canonical 5-step geometry from
 *                  the master Fuse logo bundle; auto-simplifies to 2-step
 *                  silhouette at size <= 18 or variant="favicon")
 *   - Wordmark   — "Fuse" word in Funnel Display 700 (brand=true) or
 *                  Inter semibold (brand=false)
 *   - Logo       — composite (mark + wordmark)
 *
 * Hard Rule 14: Wordmark uses var(--font-display) when brand=true.
 *   Consumer wires --font-display via next/font/google in their root layout.
 *   Closes Drift 1 (Wordmark inline `fontFamily`) production-port pattern.
 *
 * Hard Rule 10: no Gloock, no serif. Editorial signal comes from scale +
 *   letter-spacing + color, not a serif switch.
 *
 * Sentence case everywhere — wordmark renders "Fuse", not "FUSE".
 *
 * Geometry source: /Users/dhruvraina/Downloads/fuse_logo_package
 *   (canonical bundle 2026-04-30; staged at /tmp/fuse-brand-assets/fuse_logo.svg)
 *   — generator-artifact font-embed stripped, fill becomes currentColor for
 *   theming, font-family becomes var(--font-display) per Hard Rule 14.
 *
 * Consumes @fuse/tokens for --plum-9, --foreground, --sidebar-foreground,
 *   and --font-display.
 */

type FuseMarkProps = {
  size?: number;
  color?: string;
  variant?: "favicon" | "default";
  title?: string;
};

export function FuseMark({
  size = 24,
  color,
  variant,
  title = "Fuse",
}: FuseMarkProps) {
  const fill = color ?? "var(--plum-9)";
  const simplified = variant === "favicon" || size <= 18;

  if (simplified) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        role="img"
        aria-label={title}
      >
        <rect x="2" y="12" width="9" height="10" fill={fill} />
        <rect x="13" y="2" width="9" height="20" fill={fill} />
      </svg>
    );
  }

  // Canonical pixel-terrace geometry from /tmp/fuse-brand-assets/fuse_logo.svg
  // (master Fuse logo bundle, viewBox 0 0 186 186). Five-step terrace shape:
  // bottom-left bracket (37x37), full right column (37x148), middle box
  // (37x74 at 74,111), middle horizontal bar (74x37 at 0,74), and top bar
  // (148x37 at 0,0). fill="currentColor" lets consumers theme via Tailwind
  // text-* classes or the color prop.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 186 186"
      role="img"
      aria-label={title}
    >
      <path
        d="M37.1332 148.533V185.666H0V148.533H37.1332ZM185.666 37.1332V185.666H148.533V37.1332H185.666ZM74.2664 111.4H111.4V185.666H74.2664V111.4ZM74.2664 74.2664V111.4H0V74.2664H74.2664ZM148.533 0V37.1332H0V0H148.533Z"
        fill={fill}
      />
    </svg>
  );
}

type WordmarkProps = {
  size?: number;
  color?: string;
  className?: string;
  /**
   * When true, renders in Funnel Display 700 via var(--font-display).
   * When false (default), renders in Inter semibold.
   * Hard Rule 14 closure: ALWAYS uses var(--font-display) when brand=true —
   * never inline a hardcoded font-family string.
   */
  brand?: boolean;
};

export function Wordmark({
  size = 18,
  color,
  className,
  brand = false,
}: WordmarkProps): ReactNode {
  const style: CSSProperties = brand
    ? {
        fontSize: size,
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: color ?? "var(--foreground)",
      }
    : {
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-0.025em",
        color: color ?? "var(--sidebar-foreground)",
      };

  return (
    <span className={className} style={style}>
      Fuse
    </span>
  );
}

type LogoProps = {
  size?: number;
  brand?: boolean;
  color?: string;
  gap?: number;
  className?: string;
};

export function Logo({
  size = 24,
  brand = false,
  color,
  gap = 6,
  className,
}: LogoProps): ReactNode {
  const markColor = color ?? "var(--plum-9)";
  const wordColor = color ?? "var(--foreground)";
  return (
    <span
      className={`inline-flex items-center${className ? ` ${className}` : ""}`}
      style={{ gap }}
    >
      <FuseMark size={size} color={markColor} />
      <Wordmark size={size * 0.85} color={wordColor} brand={brand} />
    </span>
  );
}
