"use client";

import { Fragment } from "react";
import {
  getSafeZoneProfile,
  type SafeZoneFormat,
} from "@/lib/safezone";
import { getFormatProfile } from "@/lib/video-format";
import {
  DEFAULT_CAPTION_STYLE,
  cssFontStack,
  readableTextOn,
  type CaptionStyle,
} from "@/lib/caption-style";

// Percent-based preview overlay that scales with the video element.
export default function SafeZoneOverlay({
  caption,
  format = "social",
  showGuides = true,
  captionStyle = DEFAULT_CAPTION_STYLE,
  activeWord = null,
}: {
  caption?: string;
  format?: SafeZoneFormat;
  showGuides?: boolean;
  captionStyle?: CaptionStyle;
  activeWord?: number | null;
}) {
  const safeZone = getSafeZoneProfile(format);
  const profile = getFormatProfile(format);
  const top = safeZone.topMargin * 100;
  const left = safeZone.leftMargin * 100;
  const right = safeZone.rightMargin * 100;
  const highlighting = captionStyle.wordHighlight && activeWord !== null;
  let wordCounter = 0;

  return (
    <div className="pointer-events-none absolute inset-0">
      {showGuides && (
        <div
          className="safe-zone-border absolute"
          style={{
            top: `${top}%`,
            bottom: `${safeZone.bottomMargin * 100}%`,
            left: `${left}%`,
            right: `${right}%`,
          }}
        />
      )}
      {/* Live caption preview positioned at the caption baseline */}
      {caption && (
        <div
          className="caption-preview-position absolute"
          style={{
            top: `${captionStyle.verticalPosition}%`,
            left: `${left}%`,
            right: `${right}%`,
            transform: "translateY(-100%)",
          }}
        >
          <div
            className={`caption-preview ${captionStyle.preset}`}
            style={{
              color: captionStyle.textColor,
              background: captionStyle.backgroundEnabled
                ? captionStyle.backgroundColor
                : "transparent",
              fontFamily: cssFontStack(captionStyle.fontFamily),
              fontWeight: captionStyle.fontWeight,
              // The caption container spans the safe zone, so scale the font
              // from the frame width the renderer uses.
              fontSize: `max(6px, ${
                ((captionStyle.fontSize / profile.referenceWidth) * 100) /
                (1 - safeZone.leftMargin - safeZone.rightMargin)
              }cqw)`,
              ...(profile.boxMode === "hug"
                ? { padding: "0.22em 0.45em" }
                : {}),
              textAlign: captionStyle.alignment,
              WebkitTextStroke:
                captionStyle.outlineWidth > 0
                  ? `${Math.max(0.5, captionStyle.outlineWidth / 4)}px ${
                      captionStyle.outlineColor
                    }`
                  : undefined,
              textTransform: captionStyle.uppercase ? "uppercase" : "none",
            }}
          >
            {caption.split("\n").map((line, i) => (
              <div
                key={i}
                className="caption-preview-line"
              >
                {highlighting
                  ? line
                      .split(" ")
                      .filter(Boolean)
                      .map((word, position) => {
                        const active = wordCounter++ === activeWord;
                        const pill = captionStyle.highlightMode === "pill";
                        return (
                          <Fragment key={position}>
                            {position > 0 && " "}
                            <span
                              style={
                                active
                                  ? pill
                                    ? {
                                        background: captionStyle.highlightColor,
                                        color: readableTextOn(
                                          captionStyle.highlightColor,
                                        ),
                                        borderRadius: "0.2em",
                                        margin: "0 -0.1em",
                                        padding: "0 0.1em",
                                      }
                                    : { color: captionStyle.highlightColor }
                                  : undefined
                              }
                            >
                              {word}
                            </span>
                          </Fragment>
                        );
                      })
                  : line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
