import { prisma } from "@vybz/db";
import { route } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/log";
import { UPLOAD_RULES, sniff, storage, typeMatches } from "@/lib/uploads/storage";

/** Verifies what actually landed in storage, then marks the upload ready (or rejects and deletes it). */
export const POST = route<never, { id: string }>({}, async ({ actor, params }) => {
  if (!storage) throw new AppError("UNAVAILABLE", "File uploads aren't set up on this server yet.");
  const upload = await prisma.upload.findUnique({ where: { id: params.id } });
  if (!upload || upload.ownerId !== actor!.id) throw new AppError("NOT_FOUND", "Upload not found.");
  if (upload.status !== "PENDING") return { id: upload.id, status: upload.status };

  const head = await storage.head(upload.storageKey);
  const rules = UPLOAD_RULES[upload.kind];
  let reason: string | null = null;
  if (!head) reason = "The file didn't arrive. Try uploading again.";
  else if (head.size > rules.maxBytes || head.size > upload.sizeBytes) reason = "The file is bigger than expected.";
  else if (!typeMatches(upload.contentType, sniff(await storage.readStart(upload.storageKey, 16)))) {
    reason = "That file isn't the type it says it is.";
  }

  if (reason) {
    await storage.remove(upload.storageKey).catch(() => undefined);
    await prisma.upload.update({ where: { id: upload.id }, data: { status: "REJECTED", rejectReason: reason } });
    log.warn("upload.rejected", { uploadId: upload.id, reason });
    throw new AppError("INVALID", reason);
  }
  await prisma.upload.update({ where: { id: upload.id }, data: { status: "READY", sizeBytes: head!.size } });
  return { id: upload.id, status: "READY" };
});
