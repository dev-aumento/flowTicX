import "dotenv/config";
import { ensureDefaultAdmin } from "./ensure-admin";

ensureDefaultAdmin().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
