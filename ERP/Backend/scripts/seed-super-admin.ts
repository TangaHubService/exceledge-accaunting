/**
 * Creates the Super Admin account only — safe to run against production.
 *
 * Unlike `npm run prisma:seed` (prisma/seed.ts), this does NOT run
 * seedDemoDataset() (fake org/users/sales/products) or touch anything else.
 * Idempotent: does nothing if the account already exists.
 *
 * Credentials come from env vars (never hardcode real credentials in source):
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD (required)
 *   SUPER_ADMIN_NAME (optional, defaults to "Super Admin")
 *
 * Usage:
 *   SUPER_ADMIN_EMAIL="you@example.com" SUPER_ADMIN_PASSWORD="..." \
 *     DATABASE_URL="<production connection string>" npx tsx scripts/seed-super-admin.ts
 *
 * Or add SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD to Backend/.env (gitignored)
 * and just run: npx tsx scripts/seed-super-admin.ts
 */
import dotenv from "dotenv"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

dotenv.config()

const prisma = new PrismaClient()

const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || "Super Admin"

async function main() {
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
    throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars are required (set them inline or in Backend/.env).")
  }

  const existing = await prisma.user.findUnique({ where: { email: SUPER_ADMIN_EMAIL } })
  if (existing) {
    console.log(`Super Admin already exists (${SUPER_ADMIN_EMAIL}), skipping.`)
    return
  }

  const hashedPassword = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10)
  await prisma.user.create({
    data: {
      email: SUPER_ADMIN_EMAIL,
      password: hashedPassword,
      name: SUPER_ADMIN_NAME,
      role: "SYSTEM_OWNER",
      isActive: true,
      isEmailVerified: true,
    },
  })
  console.log(`Created Super Admin account (${SUPER_ADMIN_EMAIL}). Change the password after first login.`)
}

main()
  .catch((e) => {
    console.error("Failed to seed Super Admin:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
