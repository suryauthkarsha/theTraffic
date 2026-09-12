import { CAMERA_COLORS } from "@/components/map/cameraLayers";
import { CASING } from "@/components/map/layers";

/**
 * The legend's camera key: the same pictogram the map draws (`drawCameraGlyph`), as an inline SVG so a
 * key and its marker always match. Flat fill, hairline casing, no glow.
 */
export function CameraGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect x="9.5" y="3.5" width="5" height="4" fill={CAMERA_COLORS.mark} stroke={CASING} strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="3" y="7" width="18" height="12" rx="2.5" fill={CAMERA_COLORS.mark} stroke={CASING} strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.6" fill={CASING} />
      <circle cx="12" cy="13" r="1.6" fill={CAMERA_COLORS.mark} />
    </svg>
  );
}

/** The legend's cluster key: a warm-white counted disc. */
export function ClusterGlyph({ size = 16 }: { size?: number }) {
  return (
    <span className="mono inline-flex shrink-0 items-center justify-center rounded-full text-[8px] font-medium leading-none" style={{ width: size, height: size, background: CAMERA_COLORS.mark, color: CAMERA_COLORS.count, boxShadow: `inset 0 0 0 1px ${CASING}` }} aria-hidden>
      12
    </span>
  );
}
