import { importLegacySnapshot } from "../backup/import.js";
const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    "Usage: pnpm import:snapshot /path/to/standalone.sqlite /path/to/new-output-directory",
  );
  process.exit(1);
}
try {
  console.log(JSON.stringify(importLegacySnapshot(input, output), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
