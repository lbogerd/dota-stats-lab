import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // DuckDB is server-only and includes native .node binaries that must not be
    // scanned by Vite's browser dependency optimizer during `pnpm dev`.
    exclude: ["@duckdb/node-api"],
  },
  ssr: {
    external: ["@duckdb/node-api"],
  },
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    viteReact(),
  ],
});
