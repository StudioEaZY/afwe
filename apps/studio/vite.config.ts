import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `web-dist` (not `dist`) is embedded into the `afwe` binary and used by Tauri as frontendDist.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { outDir: "web-dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    // In dev, the API comes from `afwe studio --port 4242 --no-open`
    proxy: { "/api": "http://127.0.0.1:4242" },
  },
});
