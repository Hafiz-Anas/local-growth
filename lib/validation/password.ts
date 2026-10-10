/**
 * Password strength rules for sign-up, shared by the form's live checklist and
 * the server. The first three match `newPasswordSchema`; sign-up also rejects
 * passwords built from the person's own email or name.
 */
export const PASSWORD_RULES = ["length", "letter", "number", "personal"] as const;
export type PasswordRule = (typeof PASSWORD_RULES)[number];

export function passwordProblems(password: string, personal: { email?: string; name?: string } = {}): PasswordRule[] {
  const problems: PasswordRule[] = [];
  if (password.length < 8 || password.length > 200) problems.push("length");
  if (!/[A-Za-z]/.test(password)) problems.push("letter");
  if (!/\d/.test(password)) problems.push("number");
  const lowered = password.toLowerCase();
  const pieces = [personal.email?.split("@")[0], ...(personal.name?.split(/\s+/) ?? [])]
    .map((p) => p?.trim().toLowerCase() ?? "")
    .filter((p) => p.length >= 4);
  if (pieces.some((p) => lowered.includes(p))) problems.push("personal");
  return problems;
}

/** 0–4 for the strength meter: rules met, plus length and character variety. */
export function passwordScore(password: string, personal: { email?: string; name?: string } = {}): number {
  if (!password) return 0;
  if (passwordProblems(password, personal).length > 0) return 1;
  let score = 2;
  if (password.length >= 12) score += 1;
  if (/[^A-Za-z0-9]/.test(password) && /[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  return Math.min(score, 4);
}
