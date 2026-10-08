import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, writeFileSync } from "node:fs";
import { CREATE_SCHEMA_SQL } from "@tasker/core/db";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "native-backup-schema",
      closeBundle() {
        copyFileSync(
          new URL("../../THIRD-PARTY-NOTICES.md", import.meta.url),
          new URL("./dist/THIRD-PARTY-NOTICES.txt", import.meta.url),
        );
        writeFileSync(
          new URL("./dist/schema.sql", import.meta.url),
          CREATE_SCHEMA_SQL,
        );
      },
    },
  ],
  build: { target: "chrome105" },
});
