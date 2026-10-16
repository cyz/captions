"use client";

import {
  CAPTION_FONTS,
  QUICK_STYLES,
  cssFontStack,
  type CaptionStyle,
} from "@/lib/caption-style";

const TEXT_COLORS = ["#ffffff", "#f4f1e8", "#f8d849", "#f65282", "#d4d4d4", "#1e1e1e"];
const BACKGROUND_COLORS = ["#111318", "#282c34", "#172033", "#5c2337", "#0078d4", "#008367"];
const HIGHLIGHT_COLORS = ["#f8d849", "#f65282", "#4ade80", "#4daafc", "#dcdcaa", "#20b8a0"];

interface CaptionStylePanelProps {
  style: CaptionStyle;
  onChange: (style: CaptionStyle) => void;
}

export default function CaptionStylePanel({
  style,
  onChange,
}: CaptionStylePanelProps) {
  const patch = (next: Partial<CaptionStyle>) => onChange({ ...style, ...next });

  return (
    <div className="style-panel">
      <div className="side-panel-heading">
        <span>FORMATTING</span>
        <h2>Caption appearance</h2>
        <p>Bold text with a solid background box.</p>
      </div>

      <div className="style-section">
        <span className="style-section-title">PRESETS</span>
        <div className="style-presets">
          {QUICK_STYLES.map((preset) => {
            const look = { ...style, ...preset.patch };
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => patch(preset.patch)}
                aria-label={`Apply ${preset.label} style`}
                title={preset.label}
              >
                <span
                  style={{
                    color: look.textColor,
                    background: look.backgroundColor,
                    fontFamily: cssFontStack(look.fontFamily),
                    textTransform: look.uppercase ? "uppercase" : "none",
                  }}
                >
                  Aa
                </span>
                <small>{preset.label}</small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="style-section">
        <span className="style-section-title">TYPOGRAPHY</span>
        <div className="field-grid">
          <label className="style-field wide">
            <span>Font</span>
            <select
              value={style.fontFamily}
              onChange={(event) =>
                patch({
                  fontFamily: event.target.value as CaptionStyle["fontFamily"],
                })
              }
            >
              {CAPTION_FONTS.map((font) => (
                <option key={font.family} value={font.family}>
                  {font.family}
                </option>
              ))}
            </select>
          </label>
          <label className="style-field wide">
            <span>Size</span>
            <input
              type="number"
              min="28"
              max="96"
              value={style.fontSize}
              onChange={(event) => patch({ fontSize: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="segmented-control">
          {(["left", "center", "right"] as const).map((alignment) => (
            <button
              key={alignment}
              type="button"
              className={style.alignment === alignment ? "active" : ""}
              onClick={() => patch({ alignment })}
              aria-label={`Align ${alignment}`}
            >
              {alignment === "left" ? "≡" : alignment === "center" ? "☰" : "≣"}
            </button>
          ))}
        </div>
        <div className="swatch-field">
          <span>Letter case</span>
          <div className="segmented-control case-control" role="group" aria-label="Letter case">
            <button
              type="button"
              className={!style.uppercase ? "active" : ""}
              onClick={() => patch({ uppercase: false })}
              aria-pressed={!style.uppercase}
            >
              <span className="case-sample" aria-hidden="true">Aa</span>
              <span>Normal</span>
            </button>
            <button
              type="button"
              className={style.uppercase ? "active" : ""}
              onClick={() => patch({ uppercase: true })}
              aria-pressed={style.uppercase}
            >
              <span className="case-sample" aria-hidden="true">AA</span>
              <span>Uppercase</span>
            </button>
          </div>
        </div>
      </div>

      <div className="style-section">
        <span className="style-section-title">COLORS</span>
        <div className="swatch-field">
          <span>Text color</span>
          <div className="color-swatches">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={style.textColor === color ? "active" : ""}
                style={{ background: color }}
                onClick={() => patch({ textColor: color })}
                aria-label={`Text color ${color}`}
              />
            ))}
            <label
              className="custom-color-picker"
              title="Custom text color"
              style={{ background: style.textColor }}
            >
              <input
                type="color"
                value={style.textColor}
                onChange={(event) => patch({ textColor: event.target.value })}
                aria-label="Custom text color"
              />
              <span>+</span>
            </label>
          </div>
        </div>
        <p className="fixed-style-note">Extra bold text for better readability</p>
        <div className="swatch-field">
          <span>Background color</span>
          <div className="color-swatches">
            {BACKGROUND_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={style.backgroundColor === color ? "active" : ""}
                style={{ background: color }}
                onClick={() => patch({ backgroundColor: color })}
                aria-label={`Background color ${color}`}
              />
            ))}
            <label
              className="custom-color-picker"
              title="Custom background color"
              style={{ background: style.backgroundColor }}
            >
              <input
                type="color"
                value={style.backgroundColor}
                onChange={(event) =>
                  patch({ backgroundColor: event.target.value })
                }
                aria-label="Custom background color"
              />
              <span>+</span>
            </label>
          </div>
        </div>
      </div>

      <div className="style-section">
        <span className="style-section-title">WORD HIGHLIGHT</span>
        <div className="segmented-control case-control" role="group" aria-label="Word highlight">
          <button
            type="button"
            className={!style.wordHighlight ? "active" : ""}
            onClick={() => patch({ wordHighlight: false })}
            aria-pressed={!style.wordHighlight}
          >
            Off
          </button>
          <button
            type="button"
            className={style.wordHighlight ? "active" : ""}
            onClick={() => patch({ wordHighlight: true })}
            aria-pressed={style.wordHighlight}
          >
            Highlight
          </button>
        </div>
        {style.wordHighlight && (
          <>
            <div className="segmented-control case-control" role="group" aria-label="Highlight style">
              <button
                type="button"
                className={style.highlightMode === "text" ? "active" : ""}
                onClick={() => patch({ highlightMode: "text" })}
                aria-pressed={style.highlightMode === "text"}
              >
                Text color
              </button>
              <button
                type="button"
                className={style.highlightMode === "pill" ? "active" : ""}
                onClick={() => patch({ highlightMode: "pill" })}
                aria-pressed={style.highlightMode === "pill"}
              >
                Pill
              </button>
            </div>
            <div className="swatch-field">
              <span>Highlight color</span>
              <div className="color-swatches">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={style.highlightColor === color ? "active" : ""}
                    style={{ background: color }}
                    onClick={() => patch({ highlightColor: color })}
                    aria-label={`Highlight color ${color}`}
                  />
                ))}
                <label
                  className="custom-color-picker"
                  title="Custom highlight color"
                  style={{ background: style.highlightColor }}
                >
                  <input
                    type="color"
                    value={style.highlightColor}
                    onChange={(event) =>
                      patch({ highlightColor: event.target.value })
                    }
                    aria-label="Custom highlight color"
                  />
                  <span>+</span>
                </label>
              </div>
            </div>
            <p className="fixed-style-note">
              Uses the word timing from the SRT when each word is its own caption,
              otherwise estimates it from word length. Export takes longer.
            </p>
          </>
        )}
      </div>

      <div className="style-section">
        <label className="range-field">
          <span>Vertical position <b>{style.verticalPosition}%</b></span>
          <input
            type="range"
            min="15"
            max="90"
            value={style.verticalPosition}
            onChange={(event) =>
              patch({ verticalPosition: Number(event.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}
