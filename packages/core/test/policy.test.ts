import { describe, expect, it } from "vitest";
import { type Actor, can } from "../src";

const user = (over: Partial<Actor> = {}): Actor => ({
  id: "u1",
  role: "USER",
  status: "ACTIVE",
  emailVerified: true,
  handle: "slowjamsonly",
  ...over,
});

describe("can()", () => {
  it("lets anyone view an active profile but hides banned ones from non-staff", () => {
    expect(can(null, { type: "profile.view", target: { id: "x", status: "ACTIVE" } }).allow).toBe(true);
    expect(can(null, { type: "profile.view", target: { id: "x", status: "BANNED" } })).toEqual({ allow: false, reason: "NOT_FOUND" });
    expect(can(user({ role: "MODERATOR" }), { type: "profile.view", target: { id: "x", status: "BANNED" } }).allow).toBe(true);
  });

  it("requires sign-in for every write", () => {
    for (const type of ["battle.create", "vote.cast", "media.upload"] as const) {
      expect(can(null, { type })).toEqual({ allow: false, reason: "SIGN_IN_REQUIRED" });
    }
    expect(can(null, { type: "profile.update", target: { id: "u1" } }).allow).toBe(false);
  });

  it("only lets owners edit their profile", () => {
    expect(can(user(), { type: "profile.update", target: { id: "u1" } }).allow).toBe(true);
    expect(can(user(), { type: "profile.update", target: { id: "u2" } })).toEqual({ allow: false, reason: "NOT_OWNER" });
    expect(can(user({ role: "ADMIN" }), { type: "profile.update", target: { id: "u2" } }).allow).toBe(false);
  });

  it("allows choosing a handle once", () => {
    expect(can(user({ handle: null }), { type: "profile.setHandle", target: { id: "u1", handle: null } }).allow).toBe(true);
    expect(can(user(), { type: "profile.setHandle", target: { id: "u1", handle: "taken" } })).toEqual({
      allow: false,
      reason: "HANDLE_ALREADY_SET",
    });
  });

  it("gates battling and voting on verification, onboarding and status", () => {
    expect(can(user(), { type: "vote.cast" }).allow).toBe(true);
    expect(can(user({ emailVerified: false }), { type: "vote.cast" })).toEqual({ allow: false, reason: "EMAIL_UNVERIFIED" });
    expect(can(user({ handle: null }), { type: "battle.create" })).toEqual({ allow: false, reason: "ONBOARDING_REQUIRED" });
    expect(can(user({ status: "SUSPENDED" }), { type: "vote.cast" })).toEqual({ allow: false, reason: "ACCOUNT_RESTRICTED" });
    expect(can(user({ status: "BANNED" }), { type: "profile.update", target: { id: "u1" } })).toEqual({
      allow: false,
      reason: "ACCOUNT_RESTRICTED",
    });
  });

  it("limits uploads to creators and above", () => {
    expect(can(user(), { type: "media.upload" })).toEqual({ allow: false, reason: "INSUFFICIENT_ROLE" });
    expect(can(user({ role: "CREATOR" }), { type: "media.upload" }).allow).toBe(true);
  });

  it("lets only admins change roles, never their own", () => {
    expect(can(user({ role: "MODERATOR" }), { type: "user.setRole", target: { id: "u2" } }).allow).toBe(false);
    expect(can(user({ role: "ADMIN" }), { type: "user.setRole", target: { id: "u2" } }).allow).toBe(true);
    expect(can(user({ role: "ADMIN" }), { type: "user.setRole", target: { id: "u1" } }).allow).toBe(false);
  });

  it("lets moderators suspend only lower roles", () => {
    const mod = user({ role: "MODERATOR" });
    expect(can(mod, { type: "user.suspend", target: { id: "u2", role: "CREATOR" } }).allow).toBe(true);
    expect(can(mod, { type: "user.suspend", target: { id: "u2", role: "MODERATOR" } }).allow).toBe(false);
    expect(can(mod, { type: "user.suspend", target: { id: "u2", role: "ADMIN" } }).allow).toBe(false);
    expect(can(user({ role: "ADMIN" }), { type: "user.suspend", target: { id: "u2", role: "MODERATOR" } }).allow).toBe(true);
  });
});
