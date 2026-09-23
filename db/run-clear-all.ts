import "dotenv/config";
import { clearAllData } from "./clear-all-data";

clearAllData({ recreateAdmin: process.argv.includes("--recreate-admin") }).catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
