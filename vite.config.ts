import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import { resolve } from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  root: resolve(__dirname),
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron", "electron-store"],
            },
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete
          options.reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
