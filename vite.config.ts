/// <reference types="vitest/config" />
import { readdirSync, readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

/*
  We import tk-design-system's .tsx source, which Vite serves as-is instead of
  pre-bundling, so the Base UI parts it imports would reach the browser raw
  (and Base UI pulls in a CommonJS shim that breaks as ESM). Pre-bundle every
  Base UI entry its source names.
*/
const dsSrc = fileURLToPath(new URL("./node_modules/tk-design-system/src", import.meta.url));
const dsDeps = [
  ...new Set(
    readdirSync(dsSrc, { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((f) => [
        ...readFileSync(`${dsSrc}/${f}`, "utf8").matchAll(
          /from ['"](@base-ui\/react\/[\w-]+)['"]/g,
        ),
      ])
      .map((m) => m[1] as string),
  ),
];

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  // Keep Rust errors visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  optimizeDeps: { include: dsDeps },
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
