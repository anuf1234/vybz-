/** Base URL of the VYBZ web app, which serves /api/auth and /api/v1. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
