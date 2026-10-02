import devServer from "@hono/vite-dev-server"
import path from "path"
import { loadEnv } from "vite"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  // .env wins over a stale shell value so a new database string is actually used.
  for (const key of [
    "MONGODB_USER",
    "MONGODB_PASSWORD",
    "MONGODB_DB_NAME",
    "MONGODB_CLUSTER_HOST",
    "MONGODB_STANDARD_HOSTS",
    "MONGODB_URI",
    "MONGO_URI",
    "DATABASE_URL",
    "AUTH_DISABLED",
    "APP_SECRET",
    "USE_DATABASE",
  ]) {
    const value = env[key];
    if (value) process.env[key] = value;
  }

  return {
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/|logout(?:$|[?#])).*$/] }),
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
