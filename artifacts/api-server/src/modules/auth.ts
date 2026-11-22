import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { and, eq, gt } from "drizzle-orm";
import { db, sessions, users, auditLogs } from "@workspace/db";
import { DemoLoginBody } from "@workspace/api-zod";
import { ensureMockAccounts } from "./mock-accounts";

type Account = typeof users.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
declare module "fastify" {
  interface FastifyRequest { account: Account | null; aedSession: SessionRow | null }
}
const token = () => randomBytes(32).toString("base64url");
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const isSecure = process.env.NODE_ENV === "production";
export const demoEnabled = () => process.env.DEMO_AUTH_ENABLED === "true";
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOptions = { path: "/api", httpOnly: true, secure: isSecure, sameSite: "lax" as const, signed: true, maxAge: 60 * 60 * 8 };

export async function attachSession(req: FastifyRequest) {
  req.account = null;
  req.aedSession = null;
  const signed = req.cookies.aed_session;
  const unsigned = signed ? req.unsignCookie(signed) : null;
  if (!unsigned?.valid || !unsigned.value) return;
  const [s] = await db.select().from(sessions).where(and(eq(sessions.id, digest(unsigned.value)), gt(sessions.expiresAt, new Date())));
  if (!s) return;
  req.aedSession = s;
  if (s.userId) {
    const [u] = await db.select().from(users).where(eq(users.id, s.userId));
    if (u && (!u.isDemo || demoEnabled())) req.account = u;
  }
}
async function newSession(req: FastifyRequest, reply: FastifyReply, userId?: string) {
  if (req.aedSession) await db.delete(sessions).where(eq(sessions.id, req.aedSession.id));
  const raw = token();
  const [row] = await db.insert(sessions).values({
    id: digest(raw), userId, csrfToken: token(), expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
  }).returning();
  req.aedSession = row!;
  reply.setCookie("aed_session", raw, cookieOptions);
  return row!;
}
export async function protectMutation(req: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const csrf = req.headers["x-csrf-token"];
  if (!req.aedSession || typeof csrf !== "string" || !equal(csrf, req.aedSession.csrfToken)) {
    fail(403, "Sesja formularza wygasła. Odśwież stronę i spróbuj ponownie.");
  }
  const origin = req.headers.origin;
  const host = (req.headers["x-forwarded-host"] || req.headers.host) as string | undefined;
  if (origin && host && new URL(origin).host !== host) fail(403, "Niedozwolone pochodzenie żądania.");
}
export function requireUser(req: FastifyRequest, roles?: string[]) {
  if (!req.account) fail(401, "Zaloguj się, aby kontynuować.");
  if (roles && !roles.includes(req.account.role)) fail(403, "Brak uprawnień do tej operacji.");
  return req.account;
}
function sessionPayload(req: FastifyRequest) {
  const a = req.account;
  return {
    authenticated: !!a, demoEnabled: demoEnabled(), googleEnabled: googleEnabled(),
    csrfToken: req.aedSession!.csrfToken,
    ...(a ? { user: { id: a.id, name: a.name, role: a.role, isDemo: a.isDemo, organizationId: a.organizationId } } : {}),
  };
}
function oauth() {
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL);
}
export function registerAuth(app: FastifyInstance) {
  app.get("/api/auth/session", async (req, reply) => {
    if (!req.aedSession) await newSession(req, reply);
    return sessionPayload(req);
  });
  app.post("/api/auth/demo", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!demoEnabled()) fail(404, "Logowanie dla sędziów jest wyłączone.");
    const { role: requestedRole } = DemoLoginBody.parse(req.body);
    const role = requestedRole === "ORGANIZATIONS" ? "PROVIDER" : requestedRole;
    const account = (await ensureMockAccounts())[role];
    req.account = account;
    reply.clearCookie("aed_demo_identity", cookieOptions);
    await newSession(req, reply, account.id);
    return sessionPayload(req);
  });
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.aedSession) await db.delete(sessions).where(eq(sessions.id, req.aedSession.id));
    reply.clearCookie("aed_session", cookieOptions);
    return { status: "Wylogowano" };
  });
  app.get("/api/auth/google", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!googleEnabled()) fail(503, "Logowanie Google wymaga konfiguracji OAuth. Skorzystaj z logowania dla sędziów, jeśli jest dostępne.");
    const s = await newSession(req, reply);
    const state = token(), nonce = token(), verifier = token();
    await db.update(sessions).set({ oauthState: state, oauthNonce: nonce, oauthVerifier: verifier, oauthExpiresAt: new Date(Date.now() + 600000) }).where(eq(sessions.id, s.id));
    const url = oauth().generateAuthUrl({
      scope: ["openid", "profile", "email"], state, nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256" as never,
    });
    return reply.redirect(url);
  });
  app.get("/api/auth/google/callback", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const s = req.aedSession;
    if (!googleEnabled() || !s?.oauthState || !s.oauthNonce || !s.oauthVerifier || !s.oauthExpiresAt ||
        s.oauthExpiresAt < new Date() || typeof q.state !== "string" || !equal(q.state, s.oauthState) || !q.code) {
      fail(400, "Nieprawidłowa lub wygasła autoryzacja Google.");
    }
    const nonce = s.oauthNonce, verifier = s.oauthVerifier;
    // Consume state before exchanging the code to prevent replay.
    await db.update(sessions).set({ oauthState: null, oauthNonce: null, oauthVerifier: null, oauthExpiresAt: null }).where(eq(sessions.id, s.id));
    const client = oauth();
    const { tokens } = await client.getToken({ code: q.code, codeVerifier: verifier });
    if (!tokens.id_token) fail(400, "Brak tokenu tożsamości Google.");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email_verified || (identity as unknown as { nonce: string }).nonce !== nonce) fail(400, "Nie udało się potwierdzić tożsamości.");
    const [account] = await db.insert(users).values({
      googleSubject: identity.sub, name: identity.name || "Użytkownik", role: "USER", isDemo: false,
    }).onConflictDoUpdate({ target: users.googleSubject, set: { name: identity.name || "Użytkownik" } }).returning();
    req.account = account!;
    await newSession(req, reply, account!.id);
    await db.insert(auditLogs).values({ userId: account!.id, action: "Logowanie Google", isDemo: false });
    return reply.redirect("/dashboard");
  });
}
