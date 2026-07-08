// Password hashing via WebCrypto SHA-256 with an app-specific salt.
// Note: this is device-local auth to keep the team's data behind a login on a
// shared machine — it is not a substitute for a real server-side account
// system (see README for the upgrade path).
export async function hashPassword(email, password) {
  const data = new TextEncoder().encode("kantoforge|" + email.trim().toLowerCase() + "|" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function findUser(users, email) {
  const e = email.trim().toLowerCase();
  return users.find((u) => u.email.trim().toLowerCase() === e) || null;
}

export async function verifyLogin(users, email, password) {
  const user = findUser(users, email);
  if (!user) return null;
  const hash = await hashPassword(email, password);
  return hash === user.hash ? user : null;
}
