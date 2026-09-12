import type { SVGProps } from "react";

type XLogoProps = SVGProps<SVGSVGElement> & { size?: number };

/**
 * The X mark in lucide's stroke style (24-unit grid, 2 px round strokes) — lucide ships no glyph for
 * it, and a filled brand logo would sit oddly among the site's outline icons. Geometry after Tabler
 * Icons' `brand-x` (MIT).
 */
export function XLogo({ size = 24, ...props }: XLogoProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 4l11.733 16h4.267L8.267 4H4z" />
      <path d="M4 20l6.768-6.768m2.46-2.46L20 4" />
    </svg>
  );
}
