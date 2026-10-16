import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "@vybz/db";
import { NextResponse } from "next/server";
import { LocalStorage, UPLOAD_RULES, storage } from "@/lib/uploads/storage";

/**
 * Local-disk storage for development only: the signed PUT target and the
 * signed, range-capable GET for playback. In production files go straight to
 * R2 and this route answers 404.
 */
type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  if (!(storage instanceof LocalStorage) || !/^[a-z0-9]{1,40}$/i.test(id)) return null;
  return prisma.upload.findUnique({ where: { id } });
}

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const upload = await load(id);
  const local = storage as LocalStorage;
  if (!upload || !local.verify(id, "put", new URL(req.url).searchParams.get("token"))) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Upload not found." } }, { status: 404 });
  }
  if (upload.status !== "PENDING" || !req.body) return NextResponse.json({ error: { code: "CONFLICT", message: "Upload already finished." } }, { status: 409 });

  const max = Math.min(UPLOAD_RULES[upload.kind].maxBytes, upload.sizeBytes);
  let seen = 0;
  const limited = Readable.fromWeb(req.body as never).on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > max) limited.destroy(new Error("too large"));
  });
  await local.ensureDir(upload.storageKey);
  try {
    await pipeline(limited, createWriteStream(local.filePath(upload.storageKey)));
  } catch {
    await local.remove(upload.storageKey);
    return NextResponse.json({ error: { code: "INVALID", message: "That file is too big." } }, { status: 413 });
  }
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  const upload = await load(id);
  const local = storage as LocalStorage;
  if (!upload || upload.status !== "READY" || !local.verify(id, "get", new URL(req.url).searchParams.get("token"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const file = local.filePath(upload.storageKey);
  const size = (await stat(file)).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  const headers = {
    "content-type": upload.contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(body, { status: 206, headers: { ...headers, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` } });
  }
  return new NextResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
