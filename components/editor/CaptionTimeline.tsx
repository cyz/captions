"use client";

import type { Segment } from "@/lib/srt";

interface CaptionTimelineProps {
  segments: Segment[];
  durationMs: number;
  currentMs: number;
  selectedIndex: number | null;
  onSelect: (segment: Segment) => void;
}

function compactTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

export default function CaptionTimeline({
  segments,
  durationMs,
  currentMs,
  selectedIndex,
  onSelect,
}: CaptionTimelineProps) {
  const duration = Math.max(durationMs, 1);

  return (
    <aside className="timeline-panel" aria-label="Caption timeline">
      <div className="timeline-toolbar">
        <div>
          <span>TIMELINE</span>
          <h2>Caption navigation</h2>
        </div>
        <strong>{segments.length}</strong>
      </div>

      <div className="timeline-side-body">
        <div className="timeline-progress-rail" aria-hidden="true">
          <div
            className="timeline-progress-fill"
            style={{ height: `${Math.min(100, (currentMs / duration) * 100)}%` }}
          />
          <div
            className="timeline-progress-dot"
            style={{ top: `${Math.min(100, (currentMs / duration) * 100)}%` }}
          />
        </div>

        <div className="timeline-side-list">
          {segments.map((segment) => (
            <button
              key={segment.index}
              type="button"
              className={`timeline-side-segment ${
                selectedIndex === segment.index ? "active" : ""
              }`}
              onClick={() => onSelect(segment)}
            >
              <span className="timeline-side-index">
                {String(segment.index).padStart(2, "0")}
              </span>
              <span className="timeline-side-content">
                <span className="timeline-side-time">
                  {compactTime(segment.start)} — {compactTime(segment.end)}
                </span>
                <strong>{segment.text}</strong>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="timeline-side-footer">
        <span>{compactTime(currentMs)}</span>
        <span>{compactTime(durationMs)}</span>
      </div>
    </aside>
  );
}
