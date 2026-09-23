import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup-vitest.ts"],
    css: false,
  },
});
