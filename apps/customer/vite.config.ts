import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// /api is proxied so the app and API share an origin in dev (same as production behind one domain).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000" } },
  preview: { port: 4173, proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000" } },
  build: { target: "es2020", sourcemap: true },
});
