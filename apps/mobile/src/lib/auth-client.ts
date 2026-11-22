import { expoClient } from "@better-auth/expo/client";
import { anonymousClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as SecureStore from "expo-secure-store";
import { API_URL } from "./config";

/**
 * Same Better Auth sessions as the website. The Expo plugin keeps the session
 * cookie in SecureStore; `api.ts` attaches it to /api/v1 calls.
 */
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      scheme: "vybz",
      storagePrefix: "vybz",
      cookiePrefix: "vybz",
      storage: SecureStore,
    }),
    // Guests: play a friend's challenge without signing up first.
    anonymousClient(),
  ],
});

/** Sign in as a guest (one tap). Guests can play battles they were invited to, then save the account. */
export async function playAsGuest(): Promise<void> {
  const res = await authClient.signIn.anonymous();
  if (res.error) throw new Error(res.error.message ?? "Couldn't start a guest session.");
}

export const { useSession, signIn, signUp, signOut } = authClient;

/** A single-use token (valid a minute) that signs DJ Studio in when the app opens it in its browser view. */
export async function studioHandoffToken(): Promise<string | null> {
  try {
    const res = await authClient.$fetch<{ token: string }>("/one-time-token/generate", { method: "GET" });
    return res.data?.token ?? null;
  } catch {
    return null;
  }
}
