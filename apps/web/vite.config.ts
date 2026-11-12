import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 開発時は Worker (wrangler dev) へ API を転送する
      "/api": "http://localhost:8787",
      "/auth": "http://localhost:8787",
    },
  },
});
