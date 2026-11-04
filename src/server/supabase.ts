import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { HttpError } from "./security";

export function configuration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const origin = process.env.APP_ORIGIN;
  if (!url || !key || !origin)
    throw new HttpError(
      503,
      "CONFIGURATION",
      "El entorno todavía no está configurado.",
    );
  return { url, key, origin };
}
export async function sessionClient() {
  const config = configuration();
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) =>
        values.forEach(({ name, value, options }) =>
          jar.set(name, value, {
            ...options,
            httpOnly: true,
            secure: new URL(config.origin).protocol === "https:",
            sameSite: "lax",
            path: "/",
          }),
        ),
    },
  });
}
export function privilegedClient() {
  const { url } = configuration();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key)
    throw new HttpError(
      503,
      "CONFIGURATION",
      "El entorno todavía no está configurado.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function identity(allowPasswordChange = false) {
  const client = await sessionClient();
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user)
    throw new HttpError(
      401,
      "UNAUTHENTICATED",
      "Iniciá sesión para continuar.",
    );
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("username,role,enabled,must_change_password")
    .eq("user_id", user.id)
    .single();
  if (profileError || !profile?.enabled || profile.role !== "collaborator")
    throw new HttpError(403, "FORBIDDEN", "No tenés acceso a esta aplicación.");
  // Even pending-password sessions must be current, non-revoked and within idle expiry.
  // This RPC records activity only; it never grants access to business tables.
  const { data: authenticatedSession, error: sessionError } =
    await client.rpc("touch_auth_session");
  if (sessionError || authenticatedSession !== true) {
    await client.auth.signOut();
    throw new HttpError(
      401,
      "SESSION_EXPIRED",
      "La sesión expiró. Iniciá sesión nuevamente.",
    );
  }
  if (profile.must_change_password && !allowPasswordChange)
    throw new HttpError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Cambiá tu contraseña para continuar.",
    );
  if (!profile.must_change_password) {
    const { data: active, error: activityError } =
      await client.rpc("touch_session");
    if (activityError || active !== true) {
      await client.auth.signOut();
      throw new HttpError(
        401,
        "SESSION_EXPIRED",
        "La sesión expiró. Iniciá sesión nuevamente.",
      );
    }
  }
  return { client, user, profile };
}
