import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    envDir: fileURLToPath(new URL(".", import.meta.url)),
    define: { "import.meta.env.VITE_ADMIN": JSON.stringify("1") },
    server: {
      port: 1422,
      strictPort: true,
      proxy: {
        // Keep the browser's Host so it matches Origin in the server's origin check.
        "/api": {
          target: `http://127.0.0.1:${process.env.TK_LIGHT_PORT ?? "8787"}`,
          changeOrigin: false,
        },
      },
    },
    build: { outDir: "dist", emptyOutDir: true },
  }),
);
