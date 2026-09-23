import devServer from "@hono/vite-dev-server"
import path from "path"
import { loadEnv } from "vite"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  process.env.MONGODB_USER ??= env.MONGODB_USER;
  process.env.MONGODB_PASSWORD ??= env.MONGODB_PASSWORD;
  process.env.MONGODB_DB_NAME ??= env.MONGODB_DB_NAME;
  process.env.MONGODB_CLUSTER_HOST ??= env.MONGODB_CLUSTER_HOST;
  process.env.MONGODB_STANDARD_HOSTS ??= env.MONGODB_STANDARD_HOSTS;
  process.env.MONGODB_URI ??= env.MONGODB_URI;
  process.env.AUTH_DISABLED ??= env.AUTH_DISABLED;
  process.env.APP_SECRET ??= env.APP_SECRET;
  process.env.USE_DATABASE ??= env.USE_DATABASE;

  return {
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
};
});
