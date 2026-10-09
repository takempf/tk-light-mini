import { defineConfig } from "vite";
export default defineConfig({
  server: { port: 1423, strictPort: true },
  build: { target: "es2022" },
});
