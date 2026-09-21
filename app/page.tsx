"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UploadPage() {
  const router = useRouter();
  const [video, setVideo] = useState<File | null>(null);
  const [srt, setSrt] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!video || !srt) {
      setError("Select the video and the .srt file.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("video", video);
      form.append("srt", srt);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      router.push(`/editor/${data.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold">Caption Burner</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Upload a vertical (9:16) video and an .srt file. Captions are placed
        inside the safe zone, with at most two lines per segment.
      </p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div>
          <label className="mb-2 block text-sm font-medium">Video (.mp4 / .mov)</label>
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/*"
            onChange={(e) => setVideo(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-300 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-white hover:file:bg-indigo-500"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Subtitles (.srt)</label>
          <input
            type="file"
            accept=".srt,text/plain"
            onChange={(e) => setSrt(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-neutral-300 file:mr-4 file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-white hover:file:bg-indigo-500"
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Uploading..." : "Upload and edit captions"}
        </button>
      </form>
    </main>
  );
}
