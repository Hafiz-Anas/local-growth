-- Logins remembered on a device ("Accounts on this device"). Only the token's SHA-256 is stored.
CREATE TABLE "RememberedLogin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RememberedLogin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RememberedLogin_tokenHash_key" ON "RememberedLogin"("tokenHash");
CREATE INDEX "RememberedLogin_userId_idx" ON "RememberedLogin"("userId");

ALTER TABLE "RememberedLogin" ADD CONSTRAINT "RememberedLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
