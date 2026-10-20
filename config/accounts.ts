/**
 * How a person reaches several Instagram accounts.
 *
 * Today one login = one Instagram account, and the browser remembers up to MAX_DEVICE_LOGINS logins so
 * the person can switch between them without typing a password again (lib/server/device-logins.ts).
 *
 * The earlier "several Instagram accounts under one login" switching (BusinessMember, lib/server/accounts.ts,
 * /api/accounts, the plan's "Instagram accounts per login" limit) is kept but turned off. Set this to true to
 * bring back its switcher, "Add account", its API routes, the admin System page limit and the admin
 * client page card.
 */
export const LOGIN_HAS_SEVERAL_ACCOUNTS = false;
