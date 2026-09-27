import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { koloLibraryPlugin } from "./viteLibraryPlugin";

const host = process.env.TAURI_DEV_HOST;
const port = process.env.PORT ? Number(process.env.PORT) : 1420;

export default defineConfig({
  plugins: [koloLibraryPlugin(), react(), tailwindcss()],
  clearScreen: false,
  server: {
    port,
    strictPort: !process.env.PORT,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
  },
  preview: {
    port: 1420,
    strictPort: true,
    host: host || false,
  },
});
