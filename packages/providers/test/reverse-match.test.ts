import { describe, expect, it } from "vitest";
import { appleQueryForVideo, bestAppleMatchForVideo, type TrackCandidate } from "../src";

const video = (title: string, artistName: string, durationMs?: number): TrackCandidate => ({ provider: "YOUTUBE", externalId: "v", title, artistName, embeddable: true, ...(durationMs ? { durationMs } : {}) });
const apple = (externalId: string, title: string, artistName: string, durationMs: number): TrackCandidate => ({ provider: "APPLE_MUSIC", externalId, title, artistName, durationMs });

describe("YouTube → Apple Music", () => {
  it("builds a clean Apple search from a video title", () => {
    expect(appleQueryForVideo(video("Usher - U Remind Me (Official Video) [HD]", "UsherVEVO"))).toBe("Usher U Remind Me");
    expect(appleQueryForVideo(video("No Scrubs (Lyrics)", "TLC"))).toBe("TLC No Scrubs");
    expect(appleQueryForVideo(video("Aaliyah - Try Again | Remastered 2021", "Aaliyah"))).toBe("Aaliyah Try Again");
  });

  it("picks the studio recording and rejects weak matches", () => {
    const v = video("Usher - U Remind Me (Official Video)", "Usher", 241_000);
    const results = [apple("1", "U Remind Me (Live)", "Usher", 300_000), apple("2", "U Remind Me", "Usher", 243_000), apple("3", "Remind Me", "Someone Else", 200_000)];
    expect(bestAppleMatchForVideo(v, results)?.candidate.externalId).toBe("2");
    expect(bestAppleMatchForVideo(v, [apple("3", "Remind Me", "Someone Else", 200_000)])).toBeNull();
  });
});
