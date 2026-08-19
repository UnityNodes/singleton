import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    /*
      A small enough font gets inlined as a data: URI, and the site's CSP names
      font-src 'self' with no data:. The result is one subset that silently
      fails to load and an error in the console on every page. Keeping fonts as
      files is the fix that does not widen the policy.
    */
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
});
