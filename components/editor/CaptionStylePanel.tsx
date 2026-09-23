"use client";

import {
  type CaptionStyle,
} from "@/lib/caption-style";

const TEXT_COLORS = ["#ffffff", "#f4f1e8", "#f8d849", "#f65282"];
const BACKGROUND_COLORS = ["#111318", "#282c34", "#172033", "#5c2337"];

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
              <option>Segoe UI</option>
              <option>Arial</option>
              <option>Helvetica</option>
              <option>Verdana</option>
              <option>Georgia</option>
              <option>Trebuchet MS</option>
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
          <button
            type="button"
            className={style.uppercase ? "active" : ""}
            onClick={() => patch({ uppercase: !style.uppercase })}
          >
            AA
          </button>
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
        <label className="range-field">
          <span>Background opacity <b>{Math.round(style.backgroundOpacity * 100)}%</b></span>
          <input
            type="range"
            min="20"
            max="100"
            value={style.backgroundOpacity * 100}
            onChange={(event) =>
              patch({ backgroundOpacity: Number(event.target.value) / 100 })
            }
          />
        </label>
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
