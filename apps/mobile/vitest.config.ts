import { defineConfig } from "vitest/config";

// Unit tests cover the app's pure logic; screens are exercised on device/web.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
