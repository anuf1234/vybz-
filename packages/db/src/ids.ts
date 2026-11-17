import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 20-char lowercase id with a time prefix, so ids sort roughly by creation. */
export function newId(): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const bytes = randomBytes(11);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % 36];
  return time + rand;
}
