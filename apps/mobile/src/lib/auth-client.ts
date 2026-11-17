import { expoClient } from "@better-auth/expo/client";
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
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
