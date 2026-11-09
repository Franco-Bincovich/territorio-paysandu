import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { accountBucket, HttpError, required } from "../security";

export type AuthUser = {
  id: string; username: string; enabled: boolean; role: string;
  passwordHash: string; mustChangePassword: boolean;
};
export type Session = {
  tokenHash: string; userId: string; expiresAt: number; revoked: boolean;
};
/** Persistence contract implemented by MariaAuthStore against the confirmed DDL.
 * Implementations MUST use bound parameters, DB UTC, and transactions/row locks.
 * reserveAttempt atomically reserves EVERY attempt (including unknown users),
 * max 5 per account per 15 minutes, across all processes; never clear on success.
 * A string result is the reserved audit ID, marked successful with session insert.
 * issueSession atomically rechecks current user, role and expected passwordHash.
 * sessionWithUser reloads current flags/role, never a cached login snapshot.
 * changePassword atomically checks active session+expected hash, updates hash and
 * flag, and revokes ALL user sessions. Return false for stale/revoked state.
 */
export interface AuthStore {
  reserveAttempt(bucket: string, now: number, limit: number, windowMs: number): Promise<boolean | string>;
  findUser(username: string): Promise<AuthUser | null>;
  issueSession(session: Session, expectedHash: string, attemptId?: string): Promise<boolean>;
  sessionWithUser(hash: string): Promise<{ session: Session; user: AuthUser } | null>;
  revokeSession(hash: string): Promise<void>;
  changePassword(hash: string, expectedHash: string, nextHash: string, now: number): Promise<boolean>;
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const hashPassword = (password: string) => argon2.hash(password, {
  type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1,
});
const invalid = () => new HttpError(401, "INVALID_LOGIN", "Usuario o contraseña incorrectos.");
const expired = () => new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión para continuar.");

export async function createMariaAuth(store: AuthStore, now = Date.now) {
  // A random dummy credential equalizes password verification for unknown users.
  const dummy = await hashPassword(randomBytes(32).toString("base64url"));
  async function identify(token: string | undefined, allowPasswordChange = false) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw expired();
    const found = await store.sessionWithUser(tokenHash(token));
    if (!found || found.session.revoked || found.session.expiresAt <= now() ||
      found.session.userId !== found.user.id) throw expired();
    if (!found.user.enabled || found.user.role !== "collaborator")
      throw new HttpError(403, "FORBIDDEN", "No tenés acceso a esta aplicación.");
    if (found.user.mustChangePassword && !allowPasswordChange)
      throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "Cambiá tu contraseña para continuar.");
    return { ...found.user, sessionExpiresAt: found.session.expiresAt };
  }
  return {
    identify,
    async login(username: string, password: string) {
      username = required(username, 100).normalize("NFKC").trim().toLowerCase();
      required(password, 1024);
      const timestamp = now();
      const attempt = await store.reserveAttempt(accountBucket(username), timestamp, 5, 15 * 60_000);
      if (!attempt)
        throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Esperá unos minutos.");
      const user = await store.findUser(username);
      const candidate = user?.passwordHash.startsWith("$argon2id$") ? user.passwordHash : dummy;
      const valid = await argon2.verify(candidate, password);
      if (!user || candidate === dummy || !valid || !user.enabled || user.role !== "collaborator") throw invalid();
      const token = randomBytes(32).toString("base64url");
      const session: Session = { tokenHash: tokenHash(token), userId: user.id,
        expiresAt: timestamp + 8 * 60 * 60_000, revoked: false };
      if (!await store.issueSession(session, user.passwordHash, typeof attempt === "string" ? attempt : undefined)) throw invalid();
      return { token, expiresAt: session.expiresAt,
        user: { id: user.id, username: user.username }, mustChangePassword: user.mustChangePassword };
    },
    async logout(token: string | undefined) {
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await store.revokeSession(tokenHash(token));
    },
    async changePassword(token: string, password: string) {
      const user = await identify(token, true);
      required(password, 1024);
      if (password.length < 12 || await argon2.verify(user.passwordHash, password))
        throw new HttpError(400, "PASSWORD_WEAK", "Usá una contraseña nueva de al menos 12 caracteres.");
      if (!await store.changePassword(tokenHash(token), user.passwordHash, await hashPassword(password), now())) throw expired();
      // Require a fresh login; no pre-change session survives.
    },
  };
}

export function sessionCookie(token: string, origin: string, expiresAt: number) {
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    throw new Error("Cookies de autenticación requieren HTTPS fuera de localhost.");
  if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Token inválido.");
  return `tp_maria_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${url.protocol === "https:" ? "; Secure" : ""}`;
}
