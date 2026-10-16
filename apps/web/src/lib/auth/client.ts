"use client";

import { createAuthClient } from "better-auth/react";

// Same-origin: the client calls /api/auth on whatever host served the page.
export const authClient = createAuthClient();
