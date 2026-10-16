import { FIXTURE_TRACKS } from "@vybz/providers";
import { NextResponse } from "next/server";
import { fixturesEnabled } from "@/lib/providers";

/**
 * Development only: a 30-second generated melody standing in for a preview
 * clip, so sample-catalog battles can be listened to and voted on. Each track
 * gets its own notes so the two sides of a round sound different.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const index = FIXTURE_TRACKS.findIndex((t) => t.externalId === id);
  if (!fixturesEnabled || index === -1) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(melodyWav(index)), {
    headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400" },
  });
}

const SAMPLE_RATE = 8000;
const SECONDS = 30;
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

function melodyWav(seed: number): Buffer {
  const n = SAMPLE_RATE * SECONDS;
  const data = Buffer.alloc(n);
  const root = 196 * 2 ** ((seed % 12) / 12); // G3 shifted per track
  const noteLen = SAMPLE_RATE / 4; // quarter-second notes
  for (let i = 0; i < n; i++) {
    const note = Math.floor(i / noteLen);
    const step = PENTATONIC[(note * (seed + 3) + Math.floor(note / 4)) % PENTATONIC.length]!;
    const freq = root * 2 ** (step / 12);
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, (i % noteLen) / 200) * Math.exp(-((i % noteLen) / noteLen) * 3);
    data[i] = 128 + Math.round(60 * env * Math.sin(2 * Math.PI * freq * t));
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + n, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE, 28); // byte rate (8-bit mono)
  header.writeUInt16LE(1, 32); // block align
  header.writeUInt16LE(8, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(n, 40);
  return Buffer.concat([header, data]);
}
