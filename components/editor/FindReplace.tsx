"use client";

import type { FindOptions, MatchSummary } from "@/lib/find-replace";

export interface FindState extends FindOptions {
  query: string;
  replacement: string;
}

interface FindReplaceProps {
  state: FindState;
  matches: MatchSummary;
  // Caption currently selected in the list, if any.
  selectedIndex: number | null;
  disabled?: boolean;
  onChange: (next: FindState) => void;
  onReplaceAll: () => void;
  onReplaceSelected: () => void;
  lastReplaced: number | null;
}

export default function FindReplace({
  state,
  matches,
  selectedIndex,
  disabled,
  onChange,
  onReplaceAll,
  onReplaceSelected,
  lastReplaced,
}: FindReplaceProps) {
  const patch = (next: Partial<FindState>) => onChange({ ...state, ...next });
  const hasQuery = state.query.trim() !== "";
  const inSelected = selectedIndex ? (matches.perSegment.get(selectedIndex) ?? 0) : 0;

  return (
    <div className="find-replace" role="search" aria-label="Find and replace">
      <div className="find-row">
        <input
          type="search"
          value={state.query}
          onChange={(event) => patch({ query: event.target.value })}
          placeholder="Find"
          aria-label="Find in captions"
        />
        <button
          type="button"
          className={state.matchCase ? "active" : ""}
          onClick={() => patch({ matchCase: !state.matchCase })}
          aria-pressed={Boolean(state.matchCase)}
          title="Match case"
        >
          Aa
        </button>
        <button
          type="button"
          className={state.wholeWord ? "active" : ""}
          onClick={() => patch({ wholeWord: !state.wholeWord })}
          aria-pressed={Boolean(state.wholeWord)}
          title="Whole word"
        >
          ab
        </button>
      </div>
      <div className="find-row">
        <input
          type="text"
          value={state.replacement}
          onChange={(event) => patch({ replacement: event.target.value })}
          placeholder="Replace with"
          aria-label="Replace with"
        />
      </div>
      <div className="find-actions">
        <span aria-live="polite">
          {hasQuery
            ? matches.total === 0
              ? "No matches"
              : `${matches.total} in ${matches.perSegment.size} caption${
                  matches.perSegment.size === 1 ? "" : "s"
                }`
            : lastReplaced !== null
              ? `Replaced ${lastReplaced}`
              : "Type to search"}
        </span>
        <button
          type="button"
          onClick={onReplaceSelected}
          disabled={disabled || inSelected === 0}
          title="Replace only in the selected caption"
        >
          This caption
        </button>
        <button
          type="button"
          onClick={onReplaceAll}
          disabled={disabled || matches.total === 0}
        >
          Replace all
        </button>
      </div>
    </div>
  );
}
