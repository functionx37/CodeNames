import path from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const basePath = process.env.VITE_BASE_PATH ?? "/codenames/";

export default defineConfig({
  root: path.resolve(__dirname),
  base: basePath,
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "../shared")
    }
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")]
    },
    proxy: {
      "/codenames/socket.io": {
        target: "http://localhost:3000",
        ws: true
      }
    }
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/client"),
    emptyOutDir: true
  }
});
