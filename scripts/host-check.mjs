import { readFileSync } from "node:fs";
console.log(
  readFileSync(
    new URL("../docs/swiftbar-compatibility.md", import.meta.url),
    "utf8",
  ),
);
