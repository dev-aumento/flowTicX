import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function isMongoConnectionString(value: string) {
  return value.startsWith("mongodb+srv://") || value.startsWith("mongodb://");
}

/** Standard (non-SRV) URI — works when mongodb+srv DNS fails on Windows */
function buildStandardMongoUri(): string {
  const direct = process.env.MONGODB_URI_STANDARD?.trim() ?? "";
  if (direct && isMongoConnectionString(direct)) {
    return direct;
  }

  const user = process.env.MONGODB_USER?.trim();
  const password = process.env.MONGODB_PASSWORD?.trim();
  const hosts = process.env.MONGODB_STANDARD_HOSTS?.trim();
  const dbName = process.env.MONGODB_DB_NAME?.trim() || "tracker_app";

  if (user && password && hosts) {
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(password);
    return `mongodb://${encodedUser}:${encodedPass}@${hosts}/${dbName}?ssl=true&authSource=admin&retryWrites=true&w=majority`;
  }

  return "";
}

function buildSrvMongoUri(): string {
  const direct = process.env.MONGODB_URI?.trim() ?? "";
  if (direct && !direct.includes("YOUR_CLUSTER") && isMongoConnectionString(direct)) {
    return direct;
  }

  const legacy = process.env.DATABASE_URL?.trim() ?? "";
  if (legacy && isMongoConnectionString(legacy) && !legacy.includes("YOUR_CLUSTER")) {
    return legacy;
  }

  const user = process.env.MONGODB_USER?.trim();
  const password = process.env.MONGODB_PASSWORD?.trim();
  const host = process.env.MONGODB_CLUSTER_HOST?.trim();
  const dbName = process.env.MONGODB_DB_NAME?.trim() || "tracker_app";

  if (user && password && host) {
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(password);
    return `mongodb+srv://${encodedUser}:${encodedPass}@${host}/${dbName}?retryWrites=true&w=majority`;
  }

  return "";
}

function buildMongoUri(): string {
  // Prefer standard URI (avoids querySrv ECONNREFUSED on some Windows networks)
  const standard = buildStandardMongoUri();
  if (standard) return standard;

  return buildSrvMongoUri();
}

export function getMongoUri(): string {
  return buildMongoUri();
}

export function isMongoUriConfigured(): boolean {
  const uri = getMongoUri();
  return Boolean(uri) && !uri.includes("YOUR_CLUSTER");
}

/** Mongo is used only when USE_DATABASE=true and a connection string is set. */
export function isDatabaseEnabled(): boolean {
  return process.env.USE_DATABASE === "true" && isMongoUriConfigured();
}

export const env = {
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  get mongoUri() {
    return getMongoUri();
  },
  mongoDbName: process.env.MONGODB_DB_NAME ?? "tracker_app",
  databaseUrl: process.env.DATABASE_URL ?? "",
};
