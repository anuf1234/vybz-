import { describe, expect, it } from "vitest";
import { HandleSchema, ProfileUpdateSchema } from "../src";

describe("HandleSchema", () => {
  it("normalizes case, whitespace and a leading @", () => {
    expect(HandleSchema.parse("  @SlowJams_Only ")).toBe("slowjams_only");
  });

  it.each([
    ["ab", "at least 3"],
    ["a".repeat(21), "at most 20"],
    ["slow jams", "letters, numbers"],
    ["dj.nate", "letters, numbers"],
    ["<script>", "letters, numbers"],
    ["Admin", "reserved"],
    ["VYBZ", "reserved"],
  ])("rejects %s", (raw, message) => {
    const result = HandleSchema.safeParse(raw);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(message);
  });
});

describe("ProfileUpdateSchema", () => {
  it("trims, strips control characters and turns an empty bio into null", () => {
    expect(ProfileUpdateSchema.parse({ name: "  Nate \u0007 ", bio: "   " })).toEqual({ name: "Nate", bio: null });
  });

  it("keeps newlines in bios and enforces limits", () => {
    expect(ProfileUpdateSchema.parse({ name: "N", bio: "line 1\nline 2" }).bio).toBe("line 1\nline 2");
    expect(ProfileUpdateSchema.safeParse({ name: "N", bio: "x".repeat(161) }).success).toBe(false);
    expect(ProfileUpdateSchema.safeParse({ name: "   ", bio: "" }).success).toBe(false);
  });
});
