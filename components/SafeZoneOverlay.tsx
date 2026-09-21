"use client";

import { SAFE_ZONE, CAPTION_BOTTOM_OFFSET } from "@/lib/safezone";

// Visual guides drawn over the preview video: the safe text rectangle plus the
// reserved bottom band. Percent-based so it scales with the video element.
export default function SafeZoneOverlay({ caption }: { caption?: string }) {
  const top = SAFE_ZONE.topMargin * 100;
  const bottom = SAFE_ZONE.bottomMargin * 100;
  const left = SAFE_ZONE.leftMargin * 100;
  const right = SAFE_ZONE.rightMargin * 100;

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Safe text rectangle */}
      <div
        className="absolute rounded-sm border border-dashed border-emerald-400/70"
        style={{
          top: `${top}%`,
          bottom: `${bottom}%`,
          left: `${left}%`,
          right: `${right}%`,
        }}
      />
      {/* Reserved bottom band */}
      <div
        className="absolute inset-x-0 bottom-0 bg-red-500/10"
        style={{ height: `${bottom}%` }}
      />
      {/* Reserved top band */}
      <div
        className="absolute inset-x-0 top-0 bg-red-500/10"
        style={{ height: `${top}%` }}
      />
      {/* Live caption preview positioned at the caption baseline */}
      {caption && (
        <div
          className="absolute"
          style={{
            bottom: `${CAPTION_BOTTOM_OFFSET * 100}%`,
            left: `${left}%`,
            right: `${right}%`,
          }}
        >
          <div className="rounded bg-black/90 px-2 py-1 text-center">
            {caption.split("\n").map((line, i) => (
              <div
                key={i}
                className="text-center text-lg font-bold leading-tight text-white"
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
