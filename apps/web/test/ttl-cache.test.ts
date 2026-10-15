import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/lib/ttl-cache";

describe("TtlCache", () => {
  it("expires entries after the TTL", () => {
    const cache = new TtlCache<number>(1000);
    cache.set("a", 1, 0);
    expect(cache.get("a", 999)).toBe(1);
    expect(cache.get("a", 1000)).toBeUndefined();
  });

  it("evicts the oldest entry when full", () => {
    const cache = new TtlCache<number>(1000, 2);
    cache.set("a", 1, 0);
    cache.set("b", 2, 0);
    cache.set("c", 3, 0);
    expect(cache.get("a", 0)).toBeUndefined();
    expect(cache.get("c", 0)).toBe(3);
  });

  it("loads once and serves the cached value", async () => {
    const cache = new TtlCache<number>(60_000);
    let calls = 0;
    const load = async () => ++calls;
    await cache.getOrLoad("k", load);
    expect(await cache.getOrLoad("k", load)).toBe(1);
    expect(calls).toBe(1);
  });
});
