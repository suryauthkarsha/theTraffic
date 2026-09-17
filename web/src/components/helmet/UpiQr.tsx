import { useMemo } from "react";

import { qrMatrix, qrPath } from "@/lib/helmet/campaign";

/**
 * A UPI QR code drawn in the page: the payment link encoded into modules (`lib/helmet/campaign`)
 * and rendered as one SVG path — black on a white tile, the way scanners expect, fetched from
 * nowhere. No `innerHTML`: the path is a React attribute.
 */
export function UpiQr({ data, label, size = 192 }: { data: string; label: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const matrix = qrMatrix(data);
    return { path: qrPath(matrix), modules: matrix.length };
  }, [data]);
  return (
    <div className="shrink-0 rounded-[3px] bg-[#FFFFFF] p-3" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${modules} ${modules}`} width="100%" height="100%" role="img" aria-label={label} shapeRendering="crispEdges">
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
