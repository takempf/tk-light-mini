import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    envDir: fileURLToPath(new URL(".", import.meta.url)),
    define: { "import.meta.env.VITE_ADMIN": JSON.stringify("1") },
    server: { port: 1422, proxy: { "/api": "http://127.0.0.1:8787" } },
    build: { outDir: "dist", emptyOutDir: true },
  }),
);
