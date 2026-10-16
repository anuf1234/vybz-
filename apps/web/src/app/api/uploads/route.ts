import { can } from "@vybz/core";
import { prisma } from "@vybz/db";
import { z } from "zod";
import { route } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { LIMITS } from "@/lib/rate-limit";
import { UPLOAD_RULES, storage } from "@/lib/uploads/storage";

const Input = z.object({
  kind: z.enum(["MIX", "AVATAR"]),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().positive(),
  name: z.string().max(200).optional(),
  /** Uploaders confirm they own or have licensed what they upload. */
  rightsAttested: z.literal(true, { error: "Confirm you have the rights to share this file." }),
});

/** Starts an upload: records it and returns a short-lived URL to PUT the file to. */
export const POST = route({ input: Input, limit: { name: "upload", ...LIMITS.upload } }, async ({ actor, input }) => {
  const gate = can(actor, { type: "battle.create" });
  if (!gate.allow) throw new AppError("FORBIDDEN", "Confirm your email and pick a username first.");
  if (!storage) throw new AppError("UNAVAILABLE", "File uploads aren't set up on this server yet.");
  const rules = UPLOAD_RULES[input.kind];
  if (!(rules.types as readonly string[]).includes(input.contentType)) {
    throw new AppError("INVALID", input.kind === "MIX" ? "Upload an MP3, M4A, AAC or WAV file." : "Upload a JPEG, PNG or WebP image.");
  }
  if (input.sizeBytes > rules.maxBytes) {
    throw new AppError("INVALID", `That file is too big. The limit is ${Math.round(rules.maxBytes / 1024 / 1024)} MB.`);
  }

  const upload = await prisma.upload.create({
    data: {
      ownerId: actor!.id,
      kind: input.kind,
      // Key is ours, never derived from the file name.
      storageKey: `${input.kind.toLowerCase()}/${actor!.id}/${crypto.randomUUID()}`,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      originalName: input.name?.replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200) ?? null,
      rightsAttestedAt: new Date(),
    },
    select: { id: true, storageKey: true },
  });
  const put = await storage.presignPut(upload.storageKey, input.contentType, upload.id);
  return { id: upload.id, put };
});
