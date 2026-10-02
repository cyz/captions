"use client";

import { useEffect, useState } from "react";

const STEP_MS = 100;

function msToInput(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${minutes}:${remainder}.${millis}`;
}

function inputToMs(value: string): number {
  const match = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return Number.NaN;
  return (
    Number.parseInt(match[1], 10) * 60000 +
    Number.parseInt(match[2], 10) * 1000 +
    (match[3] ? Number.parseInt(match[3].padEnd(3, "0"), 10) : 0)
  );
}

interface TimeFieldProps {
  label: string;
  valueMs: number;
  playheadMs: number;
  onCommit: (ms: number) => void;
}

export default function TimeField({
  label,
  valueMs,
  playheadMs,
  onCommit,
}: TimeFieldProps) {
  const [text, setText] = useState(msToInput(valueMs));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(msToInput(valueMs));
    setInvalid(false);
  }, [valueMs]);

  const commit = () => {
    const next = inputToMs(text);
    if (Number.isNaN(next)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== valueMs) onCommit(next);
  };

  return (
    <div className={`time-field ${invalid ? "invalid" : ""}`}>
      <button
        type="button"
        onClick={() => onCommit(Math.max(0, valueMs - STEP_MS))}
        aria-label={`${label} 0.1 seconds earlier`}
        title="0.1 s earlier"
      >
        −
      </button>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        aria-label={label}
        aria-invalid={invalid}
        inputMode="decimal"
      />
      <button
        type="button"
        onClick={() => onCommit(valueMs + STEP_MS)}
        aria-label={`${label} 0.1 seconds later`}
        title="0.1 s later"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => onCommit(playheadMs)}
        aria-label={`Set ${label.toLowerCase()} to the playhead`}
        title="Set to playhead"
      >
        ⌖
      </button>
      {invalid && <small role="alert">Use mm:ss.mmm</small>}
    </div>
  );
}
