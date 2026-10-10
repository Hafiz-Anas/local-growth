import bcrypt from "bcryptjs";

const COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A valid bcrypt hash of a random string. Compared against when the email is
 * unknown so a failed login takes the same time whether or not the account exists.
 */
export const DUMMY_HASH = "$2b$12$QqmDJQF.Aaw.wd.SgsV1kux5NGO9XBdS2ytOA9yxol0tsX4dDr1Dq";
