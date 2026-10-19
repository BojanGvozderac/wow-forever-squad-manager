import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      persistState: process.env.E2E === "1" ? { path: ".wrangler/e2e" } : true,
    }),
    tanstackStart(),
    react(),
    tailwindcss(),
  ],
});
