import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod/v4";
import { registerAuth, attachSession, protectMutation, demoEnabled } from "./modules/auth";
import { ensureMockAccounts } from "./modules/mock-accounts";
import { registerAeds } from "./modules/aeds";
import { registerOpenData } from "./modules/open-data";
import { registerDataCatalogue } from "./modules/data-catalogue";
import { registerRedMap } from "./modules/red-map";
import { registerNearby } from "./modules/nearby";
import { registerIntegrations } from "./modules/integrations";
import { registerDeviceAssessment } from "./modules/device-assessment";
import { registerAdminRecords } from "./modules/admin-records";
import { registerSubmissionLocation } from "./modules/submission-location";
import { registerProposals } from "./modules/proposals";
import { registerSubmissionThreads } from "./modules/submission-threads";
import { registerSubmissionPhotos } from "./modules/submission-photos";
import { registerMcod } from "./modules/mcod";
import { registerGovernmentOrganizations } from "./modules/government-organizations";
import { McodError } from "./integrations/mcod/client";

export async function buildApp() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    throw new Error("SESSION_SECRET musi mieć co najmniej 16 znaków.");
  }
  const app = Fastify({
    bodyLimit: 1024 * 1024,
    logger: {
      level: "info",
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      redact: ["req.headers.cookie", "req.headers.authorization", "res.headers.set-cookie"],
    },
  });
  if (demoEnabled()) await ensureMockAccounts();
  await app.register(cookie, { secret: process.env.SESSION_SECRET });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if(error instanceof McodError)return reply.code(error.statusCode).send({error:error.message,code:error.code});
    if (error instanceof ZodError) return reply.code(400).send({ error: "Nieprawidłowe dane.", details: error.issues });
    const known = error as { statusCode?: number; name?: string; message?: string };
    const status = typeof known.statusCode === "number" ? known.statusCode : 500;
    if (status >= 500) req.log.error({ name: known.name }, "Błąd obsługi żądania");
    return reply.code(status).send({ error: status >= 500 ? "Wystąpił błąd serwera. Spróbuj ponownie." : known.message });
  });
  app.addHook("preHandler", attachSession);
  app.addHook("preHandler", protectMutation);
  app.get("/api/healthz", async () => ({ status: "ok" }));
  registerAuth(app);
  registerAeds(app);
  registerAdminRecords(app);
  registerSubmissionLocation(app);
  registerProposals(app);
  registerSubmissionThreads(app);
  registerSubmissionPhotos(app);
  registerNearby(app);
  registerIntegrations(app);
  registerDeviceAssessment(app);
  registerOpenData(app);
  registerDataCatalogue(app);
  registerRedMap(app);
  registerMcod(app);
  registerGovernmentOrganizations(app);
  return app;
}
