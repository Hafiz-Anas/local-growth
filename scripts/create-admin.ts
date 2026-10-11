/**
 * Creates ONE admin user: `npm run create-admin` (see DEPLOY.md).
 *
 * For production, which starts with an empty database and never runs the seed.
 * Reads ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD from the environment, and
 * prompts for anything missing (the password without echo). Connects with
 * DATABASE_URL. Refuses to run when the email already exists; it only ever
 * inserts that one user and never changes or deletes other data. The password
 * is never printed or logged.
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { hashPassword } from "../lib/auth/password";
import { emailSchema } from "../lib/validation/auth";
import { passwordProblems } from "../lib/validation/password";
import { describeDatabase } from "./db-target";

const PROBLEM_TEXT: Record<string, string> = {
  length: "8–200 characters",
  letter: "at least one letter",
  number: "at least one number",
  personal: "must not contain the name or the email's local part",
};

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/** Asks one question on the terminal; `hidden` keeps typed characters off the screen. */
function ask(question: string, hidden = false): Promise<string> {
  if (!process.stdin.isTTY) fail(`No terminal to ask "${question.trim()}". Set ADMIN_EMAIL, ADMIN_NAME and ADMIN_PASSWORD instead.`);
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const internal = rl as unknown as { _writeToOutput: (text: string) => void };
      let prompted = false;
      internal._writeToOutput = (text) => {
        // Let the question itself through once, then swallow the echoed keystrokes.
        if (!prompted) {
          prompted = true;
          process.stdout.write(text);
        }
      };
    }
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL is not set.");

  const rawEmail = process.env.ADMIN_EMAIL || (await ask("Admin email: "));
  const parsedEmail = emailSchema.safeParse(rawEmail);
  if (!parsedEmail.success) fail("That is not a valid email address.");
  const email = parsedEmail.data;

  const name = (process.env.ADMIN_NAME || (await ask("Admin name: "))).trim();
  if (!name || name.length > 100) fail("The name must be 1–100 characters.");

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await ask("Password (hidden): ", true);
    const again = await ask("Repeat password: ", true);
    if (password !== again) fail("The passwords don't match.");
  }
  const problems = passwordProblems(password, { email, name });
  if (problems.length) fail(`The password is too weak: ${problems.map((p) => PROBLEM_TEXT[p]).join("; ")}.`);

  const target = describeDatabase(databaseUrl);
  console.log(`\nDatabase: ${target}`);
  if (process.stdin.isTTY) {
    const answer = await ask(`Create admin ${email} in this database? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) fail("Cancelled. Nothing was changed.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      fail(`A user with the email ${email} already exists. Nothing was changed.`);
    }
    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = await db.user.create({
        data: { email, name, passwordHash, role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() },
        select: { id: true, email: true },
      });
    } catch (error) {
      // Created by someone else between the check and the insert.
      if ((error as { code?: string }).code === "P2002") fail(`A user with the email ${email} already exists. Nothing was changed.`);
      throw error;
    }
    console.log(`✔ Created admin ${user.email} (id ${user.id}) in ${target}. Sign in at /login.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  // Prisma errors don't contain the password; print only the message, not the whole object.
  fail(`Could not create the admin: ${(error as Error).message}`);
});
