// Prisma CLI config. The CLI does not read .env on its own, hence dotenv.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a direct (unpooled) connection: on Neon, DIRECT_URL is the
    // non-pooler URL. The app always connects with DATABASE_URL (lib/db.ts).
    // Locally DIRECT_URL is unset, so both use DATABASE_URL as before.
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
