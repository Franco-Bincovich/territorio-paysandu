import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolConnection } from "mariadb";
import { accountBucket, HttpError } from "../security";
import type { AuthStore, AuthUser, Session } from "./auth";
import { mariaPool } from "./pool";

type Row = Record<string, any>;
const unavailable = () => new HttpError(503, "AUTH_UNAVAILABLE", "El acceso no está disponible temporalmente.");
const userSelect = `SELECT u.USER_ID, u.USERNAME, u.ROLE, u.ENABLED,
  u.MUST_CHANGE_PASSWORD, c.PASSWORD_HASH FROM FB_USUARIOS u
  JOIN FB_USUARIOS_CREDENCIALES c ON c.USER_ID = u.USER_ID`;
const userFrom = (row: Row): AuthUser => ({ id: row.USER_ID, username: row.USERNAME,
  role: row.ROLE, enabled: Number(row.ENABLED) === 1,
  mustChangePassword: Number(row.MUST_CHANGE_PASSWORD) === 1, passwordHash: row.PASSWORD_HASH });

/** Real SQL adapter for the confirmed schema. No DDL, no Supabase access.
 * Named locks require a single MariaDB primary, not load-balanced connections
 * across independent servers. All auth writers must use the same lock protocol.
 */
export class MariaAuthStore implements AuthStore {
  constructor(private pool: Pick<Pool, "getConnection"> = mariaPool()) {}

  private async connection<T>(run: (c: PoolConnection) => Promise<T>): Promise<T> {
    let c: PoolConnection | undefined;
    try {
      c = await this.pool.getConnection();
      await c.query("SET time_zone = '+00:00'");
      return await run(c);
    } catch {
      // Never expose SQL, parameter values, credentials or driver error messages.
      if (c) c.destroy();
      throw unavailable();
    } finally {
      if (c) try { await c.release(); } catch { c.destroy(); throw unavailable(); }
    }
  }
  private async transaction<T>(run: (c: PoolConnection) => Promise<T>): Promise<T> {
    return this.connection(async c => {
      await c.beginTransaction();
      try { const result = await run(c); await c.commit(); return result; }
      catch (error) {
        try { await c.rollback(); } catch { c.destroy(); }
        throw error;
      }
    });
  }

  async reserveAttempt(bucket: string, _now: number, limit: number, windowMs: number) {
    return this.connection(async c => {
      const name = createHash("sha256").update(`tp.auxiliares.auth.${bucket}`).digest("hex");
      const lock = await c.query("SELECT GET_LOCK(?, 3) AS acquired", [name]);
      if (Number(lock[0].acquired) !== 1) throw unavailable();
      try {
        // Autocommit: count observes all previously reserved attempts under this lock.
        const rows = await c.query(`SELECT COUNT(*) AS total FROM FB_LOGIN_INTENTOS
          WHERE IDENTIFICADOR_HASH = ? AND FECHA_INTENTO > TIMESTAMPADD(MICROSECOND, ?, UTC_TIMESTAMP(6))`,
        [bucket, -windowMs * 1000]);
        if (Number(rows[0].total) >= limit) return false;
        const result = await c.query(`INSERT INTO FB_LOGIN_INTENTOS
          (IDENTIFICADOR_HASH, IP_HASH, FECHA_INTENTO, EXITOSO) VALUES (?, NULL, UTC_TIMESTAMP(6), 0)`, [bucket]);
        return String(result.insertId);
      } finally {
        try {
          const released = await c.query("SELECT RELEASE_LOCK(?) AS released", [name]);
          if (Number(released[0].released) !== 1) throw unavailable();
        } catch (error) { c.destroy(); throw error; }
      }
    });
  }
  async findUser(username: string) {
    return this.connection(async c => {
      // Binary comparison avoids accent-insensitive aliases bypassing account limits.
      const rows = await c.query(`${userSelect} WHERE BINARY u.USERNAME = BINARY ?`, [username]);
      return rows[0] ? userFrom(rows[0]) : null;
    });
  }
  async issueSession(session: Session, expectedHash: string, attemptId?: string) {
    return this.transaction(async c => {
      const rows = await c.query(`${userSelect} WHERE u.USER_ID = ? FOR UPDATE`, [session.userId]);
      const user = rows[0] && userFrom(rows[0]);
      if (!user || !user.enabled || user.role !== "collaborator" || user.passwordHash !== expectedHash) return false;
      if (!attemptId) return false;
      const attempts = await c.query(`SELECT ID_INTENTO FROM FB_LOGIN_INTENTOS
        WHERE ID_INTENTO = ? AND IDENTIFICADOR_HASH = ? AND EXITOSO = 0
        AND FECHA_INTENTO > TIMESTAMPADD(MINUTE, -15, UTC_TIMESTAMP(6)) FOR UPDATE`,
      [attemptId, accountBucket(user.username)]);
      if (!attempts.length) return false;
      // Duration fixed by server; DB clock owns both creation and expiry.
      await c.query(`INSERT INTO FB_USUARIOS_SESIONES
        (SESSION_ID, USER_ID, TOKEN_HASH, CREATED_AT, LAST_ACTIVITY_AT, EXPIRES_AT, REVOKED_AT)
        VALUES (?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), TIMESTAMPADD(HOUR, 8, UTC_TIMESTAMP(6)), NULL)`,
      [randomUUID(), user.id, session.tokenHash]);
      await c.query("UPDATE FB_LOGIN_INTENTOS SET EXITOSO = 1 WHERE ID_INTENTO = ?", [attemptId]);
      return true;
    });
  }
  async sessionWithUser(hash: string) {
    return this.connection(async c => {
      const rows = await c.query(`SELECT u.USER_ID, u.USERNAME, u.ROLE, u.ENABLED,
        u.MUST_CHANGE_PASSWORD, c.PASSWORD_HASH, s.TOKEN_HASH,
        UNIX_TIMESTAMP(s.EXPIRES_AT) * 1000 AS expires_ms
        FROM FB_USUARIOS_SESIONES s JOIN FB_USUARIOS u ON u.USER_ID = s.USER_ID
        JOIN FB_USUARIOS_CREDENCIALES c ON c.USER_ID = u.USER_ID
        WHERE s.TOKEN_HASH = ? AND s.REVOKED_AT IS NULL AND s.EXPIRES_AT > UTC_TIMESTAMP(6)
        AND s.LAST_ACTIVITY_AT > TIMESTAMPADD(HOUR, -1, UTC_TIMESTAMP(6))`, [hash]);
      if (!rows.length) return null;
      const user = userFrom(rows[0]);
      if (user.enabled && user.role === "collaborator") {
        const result = await c.query(`UPDATE FB_USUARIOS_SESIONES SET LAST_ACTIVITY_AT = UTC_TIMESTAMP(6)
          WHERE TOKEN_HASH = ? AND REVOKED_AT IS NULL AND EXPIRES_AT > UTC_TIMESTAMP(6)
          AND LAST_ACTIVITY_AT > TIMESTAMPADD(HOUR, -1, UTC_TIMESTAMP(6))`, [hash]);
        if (!result.affectedRows) return null;
      }
      return { user, session: { tokenHash: hash, userId: user.id,
        expiresAt: Number(rows[0].expires_ms), revoked: false } };
    });
  }
  async revokeSession(hash: string) {
    await this.connection(c => c.query(`UPDATE FB_USUARIOS_SESIONES
      SET REVOKED_AT = COALESCE(REVOKED_AT, UTC_TIMESTAMP(6)) WHERE TOKEN_HASH = ?`, [hash]));
  }
  async changePassword(hash: string, expectedHash: string, nextHash: string, _now: number) {
    return this.transaction(async c => {
      const owner = await c.query("SELECT USER_ID FROM FB_USUARIOS_SESIONES WHERE TOKEN_HASH = ?", [hash]);
      if (!owner.length) return false;
      // Consistent lock order: user+credential, then sessions. Serializes login/change.
      const rows = await c.query(`${userSelect} WHERE u.USER_ID = ? FOR UPDATE`, [owner[0].USER_ID]);
      const user = rows[0] && userFrom(rows[0]);
      if (!user || !user.enabled || user.role !== "collaborator" || user.passwordHash !== expectedHash) return false;
      const active = await c.query(`SELECT SESSION_ID FROM FB_USUARIOS_SESIONES
        WHERE TOKEN_HASH = ? AND REVOKED_AT IS NULL AND EXPIRES_AT > UTC_TIMESTAMP(6)
        AND LAST_ACTIVITY_AT > TIMESTAMPADD(HOUR, -1, UTC_TIMESTAMP(6)) FOR UPDATE`, [hash]);
      if (!active.length) return false;
      await c.query(`UPDATE FB_USUARIOS_CREDENCIALES SET PASSWORD_HASH = ?,
        PASSWORD_UPDATED_AT = UTC_TIMESTAMP(6) WHERE USER_ID = ?`, [nextHash, user.id]);
      await c.query(`UPDATE FB_USUARIOS SET MUST_CHANGE_PASSWORD = 0,
        PASSWORD_CHANGED_AT = UTC_TIMESTAMP(6) WHERE USER_ID = ?`, [user.id]);
      await c.query(`UPDATE FB_USUARIOS_SESIONES SET REVOKED_AT = UTC_TIMESTAMP(6)
        WHERE USER_ID = ? AND REVOKED_AT IS NULL`, [user.id]);
      return true;
    });
  }
  async createTestUser(user: { username: string; passwordHash: string }) {
    if (!/^qa_[a-z0-9_]{8,80}$/.test(user.username) || !user.passwordHash.startsWith("$argon2id$"))
      throw new Error("Solo se admite un usuario QA exclusivo y hash Argon2id.");
    const id = randomUUID();
    await this.transaction(async c => {
      await c.query(`INSERT INTO FB_USUARIOS
        (USER_ID, USERNAME, ROLE, ENABLED, MUST_CHANGE_PASSWORD) VALUES (?, ?, 'collaborator', 1, 1)`, [id, user.username]);
      await c.query(`INSERT INTO FB_USUARIOS_CREDENCIALES
        (USER_ID, PASSWORD_HASH, CREATED_AT) VALUES (?, ?, UTC_TIMESTAMP(6))`, [id, user.passwordHash]);
    });
    return { id, username: user.username, role: "collaborator" as const };
  }
}
