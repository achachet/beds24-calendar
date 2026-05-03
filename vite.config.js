import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api/v2": {
        target: "https://beds24.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
