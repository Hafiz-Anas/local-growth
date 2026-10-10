/**
 * Demo logins. The seed script creates these users (with bcrypt-hashed
 * passwords), and the login page lists them when DEMO_ACCOUNTS_ENABLED is "true".
 */
export interface DemoAccount {
  email: string;
  password: string;
  role: "admin" | "user";
  name: string;
  avatarUrl: string | null;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: "admin@localgrowth.dev", password: "Admin@123", role: "admin", name: "Raid Admin", avatarUrl: "/avatars/team/raid-admin.svg" },
  { email: "user@mathanetbaity.dev", password: "User@123", role: "user", name: "Mathanet Baity", avatarUrl: "/avatars/businesses/mathanet-baity.svg" },
  { email: "cafe@localgrowth.dev", password: "User@123", role: "user", name: "Dalla & Bean", avatarUrl: "/avatars/businesses/dalla-bean.svg" },
  { email: "boutique@localgrowth.dev", password: "User@123", role: "user", name: "Noor Boutique", avatarUrl: "/avatars/businesses/noor-boutique.svg" },
  // Self sign-up that stopped at onboarding step 3 (competitors) — logging in resumes the wizard there.
  { email: "bakery@localgrowth.dev", password: "User@123", role: "user", name: "Fereej Bakery", avatarUrl: null },
];

export function demoAccountsEnabled(): boolean {
  return process.env.DEMO_ACCOUNTS_ENABLED !== "false";
}
