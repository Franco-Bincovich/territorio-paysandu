import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { accountBucket, HttpError, required } from "../security";
import { isRole } from "../../../shared/permissions";
import { usernameKey } from "../../../shared/user-profile";
import { auditActor, auditNoChange } from "../audit/platform";
import { passwordIssues, passwordPolicyMessage, PASSWORD_MAX_LENGTH } from "../../../shared/password-policy";

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
  issueSession(session: Session, expectedHash: string, attemptId?: string, priorSessionHash?: string): Promise<boolean>;
  sessionWithUser(hash: string, touchActivity?: boolean): Promise<{ session: Session; user: AuthUser } | null>;
  revokeSession(hash: string): Promise<void>;
  changePassword(hash: string, expectedHash: string, nextHash: string, now: number): Promise<boolean>;
}
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const hashPassword = (password: string) => argon2.hash(password, {
  type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1,
});
const invalid = () => new HttpError(401, "INVALID_LOGIN", "Usuario o contraseña incorrectos.");
const expired = () => new HttpError(401, "UNAUTHENTICATED", "Iniciá sesión para continuar.");
const validToken = (token: string | undefined): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

export async function createMariaAuth(store: AuthStore, now = Date.now) {
  // A random dummy credential equalizes password verification for unknown users.
  const dummy = await hashPassword(randomBytes(32).toString("base64url"));
  async function identify(token: string | undefined, allowPasswordChange = false, touchActivity = true) {
    if (!validToken(token)) throw expired();
    const sessionHash = tokenHash(token);
    const found = await store.sessionWithUser(sessionHash, touchActivity);
    if (!found || found.session.revoked || found.session.expiresAt <= now() ||
      found.session.userId !== found.user.id) throw expired();
    const { user } = found;
    const { role } = user;
    if (!user.enabled || !isRole(role))
      throw new HttpError(403, "FORBIDDEN", "No tenés acceso a esta aplicación.");
    auditActor(user);
    if (user.mustChangePassword && !allowPasswordChange)
      throw new HttpError(403, "PASSWORD_CHANGE_REQUIRED", "Cambiá tu contraseña para continuar.");
    return { ...user, role, sessionHash, sessionExpiresAt: found.session.expiresAt };
  }
  return {
    identify,
    async login(username: string, password: string, priorToken?: string) {
      username = usernameKey(required(username, 100));
      required(password, 1024);
      const timestamp = now();
      const attempt = await store.reserveAttempt(accountBucket(username), timestamp, 5, 15 * 60_000);
      if (!attempt)
        throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Esperá unos minutos.");
      const user = await store.findUser(username);
      const candidate = user?.passwordHash.startsWith("$argon2id$") ? user.passwordHash : dummy;
      const valid = await argon2.verify(candidate, password);
      if (!user || candidate === dummy || !valid || !user.enabled || !isRole(user.role)) throw invalid();
      const token = randomBytes(32).toString("base64url");
      const session: Session = { tokenHash: tokenHash(token), userId: user.id,
        expiresAt: timestamp + 8 * 60 * 60_000, revoked: false };
      if (!await store.issueSession(session, user.passwordHash, typeof attempt === "string" ? attempt : undefined,
        validToken(priorToken) ? tokenHash(priorToken) : undefined)) throw invalid();
      auditActor(user);
      return { token, expiresAt: session.expiresAt,
        user: { id: user.id, username: user.username, role: user.role }, mustChangePassword: user.mustChangePassword };
    },
    async logout(token: string | undefined) {
      if (validToken(token)) await store.revokeSession(tokenHash(token));
      else auditNoChange();
    },
    async changePassword(token: string, currentPassword: string, password: string, confirmPassword: string) {
      const user = await identify(token, true);
      required(currentPassword, PASSWORD_MAX_LENGTH);
      const [issue] = passwordIssues(password, confirmPassword, currentPassword);
      if (issue) throw new HttpError(400, issue, passwordPolicyMessage(issue));
      if (!await store.reserveAttempt(accountBucket(user.username), now(), 5, 15 * 60_000))
        throw new HttpError(429, "RATE_LIMIT", "Demasiados intentos. Esperá unos minutos.");
      if (!await argon2.verify(user.passwordHash, currentPassword))
        throw new HttpError(400, "CURRENT_PASSWORD_INVALID", "La contraseña actual no es correcta.");
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
