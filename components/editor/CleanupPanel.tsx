"use client";

import { useMemo, useState } from "react";
import {
  applyCleanup,
  DEFAULT_CLEANUP,
  findCleanupCandidates,
  type CleanupCandidate,
  type CleanupOptions,
  type CleanupResult,
} from "@/lib/cleanup";
import { totalCutMs, type Cut } from "@/lib/cuts";
import type { Silence } from "@/lib/silence";
import type { Segment } from "@/lib/srt";

interface CleanupPanelProps {
  segments: Segment[];
  silences: Silence[];
  cuts: Cut[];
  durationMs: number;
  language?: string;
  disabled?: boolean;
  onApply: (result: CleanupResult) => void;
  onClearCuts: () => void;
  onSeek: (ms: number) => void;
}

function clock(ms: number): string {
  const seconds = ms / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

const KIND_LABEL: Record<CleanupCandidate["kind"], string> = {
  silence: "Pause",
  hesitation: "Hesitation",
  filler: "Filler",
  custom: "Word",
};

export default function CleanupPanel({
  segments,
  silences,
  cuts,
  durationMs,
  language,
  disabled,
  onApply,
  onClearCuts,
  onSeek,
}: CleanupPanelProps) {
  const [options, setOptions] = useState<CleanupOptions>(DEFAULT_CLEANUP);
  const [customText, setCustomText] = useState("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const candidates = useMemo(
    () =>
      findCleanupCandidates(segments, silences, cuts, {
        ...options,
        language,
        customWords: customText.split(",").map((word) => word.trim()).filter(Boolean),
      }),
    [segments, silences, cuts, options, language, customText],
  );
  const chosen = candidates.filter((candidate) => !skipped.has(candidate.id));
  const saving = totalCutMs(
    applyCleanup([], [], chosen, durationMs).cuts,
  );
  const hasAudioAnalysis = silences.length > 0 || cuts.length > 0;
  const patch = (next: Partial<CleanupOptions>) => setOptions((current) => ({ ...current, ...next }));

  const toggle = (id: string) =>
    setSkipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="cleanup-panel">
      <div className="side-panel-heading">
        <span>CLEAN UP</span>
        <h2>Pauses and fillers</h2>
        <p>Shorten long pauses and remove hesitations. Cuts apply to the export.</p>
      </div>

      {cuts.length > 0 && (
        <div className="cleanup-applied">
          <span>
            ✓ {cuts.length} cut{cuts.length === 1 ? "" : "s"} · {(totalCutMs(cuts) / 1000).toFixed(1)}s removed
          </span>
          <button type="button" onClick={onClearCuts} disabled={disabled}>
            Clear cuts
          </button>
        </div>
      )}

      <div className="style-section">
        <span className="style-section-title">PAUSES</span>
        {silences.length === 0 && !hasAudioAnalysis ? (
          <p className="side-empty">
            Pause detection runs while the audio is transcribed, so it is not
            available for this project.
          </p>
        ) : (
          <label className="style-field wide">
            <span>Shorten pauses longer than {(options.silenceMinMs / 1000).toFixed(1)}s</span>
            <input
              type="range"
              min="400"
              max="3000"
              step="100"
              value={options.silenceMinMs}
              onChange={(event) => patch({ silenceMinMs: Number(event.target.value) })}
            />
          </label>
        )}
      </div>

      <div className="style-section">
        <span className="style-section-title">WORDS</span>
        <label className="cleanup-check">
          <input
            type="checkbox"
            checked={options.hesitations}
            onChange={(event) => patch({ hesitations: event.target.checked })}
          />
          <span>Hesitations (hum, uh, ahn…)</span>
        </label>
        <label className="cleanup-check">
          <input
            type="checkbox"
            checked={options.fillers}
            onChange={(event) => patch({ fillers: event.target.checked })}
          />
          <span>Filler words (né, tipo, like…)</span>
        </label>
        <label className="style-field wide">
          <span>Other words to remove</span>
          <input
            type="text"
            value={customText}
            onChange={(event) => setCustomText(event.target.value)}
            placeholder="separated by commas"
          />
        </label>
      </div>

      <div className="style-section">
        <span className="style-section-title">
          FOUND · {candidates.length}
        </span>
        {candidates.length === 0 ? (
          <p className="side-empty">Nothing to clean up with these settings.</p>
        ) : (
          <ul className="cleanup-list">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <input
                  type="checkbox"
                  checked={!skipped.has(candidate.id)}
                  onChange={() => toggle(candidate.id)}
                  aria-label={`Include ${candidate.label} at ${clock(candidate.start)}`}
                />
                <button type="button" onClick={() => onSeek(candidate.start)}>
                  <small>{KIND_LABEL[candidate.kind]}</small>
                  <strong>{candidate.label}</strong>
                  <span>{clock(candidate.start)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="cleanup-apply"
        disabled={disabled || chosen.length === 0}
        onClick={() => {
          onApply(applyCleanup(segments, cuts, chosen, durationMs));
          setSkipped(new Set());
        }}
      >
        Remove {chosen.length} · save ~{(saving / 1000).toFixed(1)}s
      </button>
    </div>
  );
}
