"use client";

import { useState } from "react";

type State = { kind: "idle" } | { kind: "uploading"; pct: number } | { kind: "done"; name: string } | { kind: "error"; message: string };

/**
 * Uploads a DJ mix straight to storage with a signed URL, then asks the
 * server to verify it. Only original or licensed mixes: the uploader attests
 * to the rights before anything is sent.
 */
export function MixUpload({ onReady }: { onReady: (uploadId: string | null) => void }) {
  const [attested, setAttested] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function upload(file: File) {
    onReady(null);
    setState({ kind: "uploading", pct: 0 });
    try {
      const start = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "MIX", contentType: file.type || "audio/mpeg", sizeBytes: file.size, name: file.name, rightsAttested: attested }),
      });
      const started = await start.json();
      if (!start.ok) throw new Error(started.error?.message ?? "Couldn't start the upload.");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", started.put.url);
        for (const [k, v] of Object.entries(started.put.headers as Record<string, string>)) xhr.setRequestHeader(k, v);
        xhr.upload.onprogress = (e) => e.lengthComputable && setState({ kind: "uploading", pct: Math.round((e.loaded / e.total) * 100) });
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error("The upload failed. Try again.")));
        xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection."));
        xhr.send(file);
      });

      const done = await fetch(`/api/uploads/${started.id}/complete`, { method: "POST" });
      const body = await done.json();
      if (!done.ok) throw new Error(body.error?.message ?? "We couldn't verify that file.");
      setState({ kind: "done", name: file.name });
      onReady(started.id);
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 size-4 accent-violet" />
        <span>I made this mix or have the rights to share it. I won&apos;t upload ripped or downloaded tracks.</span>
      </label>
      <input
        type="file"
        accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav"
        disabled={!attested || state.kind === "uploading"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
        className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-surface-3 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-text disabled:opacity-50"
        aria-label="Mix file (MP3, M4A, AAC or WAV, up to 200 MB)"
      />
      <p className="text-xs text-muted">MP3, M4A, AAC or WAV, up to 200 MB.</p>
      {state.kind === "uploading" && <p className="text-sm text-violet-soft">Uploading… {state.pct}%</p>}
      {state.kind === "done" && <p className="text-sm text-win">Ready: {state.name}</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-300">
          {state.message}
        </p>
      )}
    </div>
  );
}
