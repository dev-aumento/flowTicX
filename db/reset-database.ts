import "dotenv/config";
import { clearAllData } from "./clear-all-data";

clearAllData({ recreateAdmin: true }).catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
