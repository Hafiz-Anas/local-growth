import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Secrets of a Meta connection, stored as ONE AES-256-GCM blob in
 * InstagramConnection.credentialsEncrypted. Only server code reads it; it is
 * never selected by DTO queries, returned by the API or logged.
 */
export interface MetaCredentials {
  /** Long-lived user token (~60 days). */
  userToken: string;
  /** ISO; null when Meta says it doesn't expire. */
  userTokenExpiresAt: string | null;
  dataAccessExpiresAt: string | null;
  /** Facebook user id the token belongs to. */
  metaUserId: string;
  pageId: string;
  pageName: string;
  /** Page token derived from the long-lived user token; used for the Instagram Graph calls. */
  pageToken: string;
  igUserId: string;
  scopes: string[];
}

export function sealCredentials(credentials: MetaCredentials): string {
  return encrypt(JSON.stringify(credentials));
}

export function openCredentials(payload: string | null | undefined): MetaCredentials | null {
  if (!payload) return null;
  try {
    return JSON.parse(decrypt(payload)) as MetaCredentials;
  } catch (error) {
    console.error("[meta] stored credentials can't be decrypted (ENCRYPTION_KEY changed?)", (error as Error).message);
    return null;
  }
}
