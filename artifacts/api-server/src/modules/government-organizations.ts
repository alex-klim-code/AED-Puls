import type { FastifyInstance } from "fastify";
import { z } from "zod/v4";
import { and, eq, desc } from "drizzle-orm";
import { db, users, organizations, memberships, governmentInstitutions as institutions,
  governmentClaims as claims, governmentDatasets as datasets, governmentResources as resources } from "@workspace/db";
import {
  ClaimGovernmentOrganizationBody as GovernmentClaimInput,
  ApproveGovernmentOrganizationClaimBody as GovernmentClaimReview,
  SearchGovernmentOrganizationsResponseItem as GovernmentEntity,
  GetMyGovernmentOrganizationsResponse as GovernmentMemberships,
} from "@workspace/api-zod";
import { fail, requireUser } from "./auth";
import { getInstitution, institutionDto, searchInstitutions, queueInstitutionImport } from "./government-catalogue";

const institutionId = (params: unknown) => z.object({ id: z.string().regex(/^\d+$/) }).parse(params).id;
const claimId = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
const claimRows = (userId?: string) => db.select({ claim: claims, institution: institutions, userName: users.name }).from(claims)
  .innerJoin(institutions, eq(institutions.id, claims.institutionId)).innerJoin(users, eq(users.id, claims.userId))
  .where(userId ? eq(claims.userId, userId) : undefined).orderBy(desc(claims.createdAt));
const claimDto = ({ claim, institution, userName }: Awaited<ReturnType<typeof claimRows>>[number]) => ({
  ...institutionDto(institution), id: claim.id, institutionId: institution.id, status: claim.status,
  representative: claim.representative, evidence: claim.evidence, note: claim.note, userName,
});

export function registerGovernmentOrganizations(app: FastifyInstance) {
  app.get("/api/organizations/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async req => {
    const { q } = z.object({ q: z.string().trim().min(2).max(120) }).parse(req.query);
    return GovernmentEntity.array().parse(await searchInstitutions(q));
  });
  app.get("/api/organizations/my", async req => {
    const actor = requireUser(req);
    return GovernmentMemberships.parse({ claims: (await claimRows(actor.id)).map(claimDto), activeOrganizationId: actor.organizationId });
  });
  app.get("/api/organizations/:id", async req => GovernmentEntity.parse(institutionDto(await getInstitution(institutionId(req.params)))));
  app.get("/api/organizations/:id/datasets", async req => {
    const id = institutionId(req.params); await getInstitution(id);
    return GovernmentEntity.array().parse(await db.select().from(datasets).where(eq(datasets.institutionId, id)).orderBy(datasets.name));
  });
  app.get("/api/datasets/:id/resources", async req =>
    GovernmentEntity.array().parse(await db.select().from(resources).where(eq(resources.datasetId, institutionId(req.params))).orderBy(resources.name)));
  app.post("/api/organizations/:id/import", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async req => {
    const actor = requireUser(req, ["USER", "PROVIDER"]);
    return GovernmentEntity.parse(await queueInstitutionImport(institutionId(req.params), actor.id));
  });
  app.post("/api/organizations/:id/claim", async req => {
    const actor = requireUser(req, ["USER", "PROVIDER"]), id = institutionId(req.params);
    const input = GovernmentClaimInput.parse(req.body); await getInstitution(id);
    await db.insert(claims).values({ institutionId: id, userId: actor.id, ...input }).onConflictDoNothing();
    return GovernmentEntity.parse(claimDto((await claimRows(actor.id)).find(r => r.claim.institutionId === id)!));
  });
  app.post("/api/organizations/:id/switch", async req => {
    const actor = requireUser(req, ["USER", "PROVIDER"]), id = institutionId(req.params);
    await db.transaction(async tx => {
      const [claim] = await tx.select().from(claims).where(and(eq(claims.userId, actor.id), eq(claims.institutionId, id), eq(claims.status, "APPROVED"))).for("update");
      if (!claim) fail(403, "Profil jest dostępny dopiero po zatwierdzeniu przedstawiciela przez administratora.");
      const institution = await getInstitution(id);
      if (!institution.organizationId) fail(409, "Brak zatwierdzonego profilu organizacji.");
      const [member] = await tx.select().from(memberships).where(and(eq(memberships.userId, actor.id), eq(memberships.organizationId, institution.organizationId)));
      if (!member) fail(403, "Brak zatwierdzonego członkostwa.");
      await tx.update(users).set({ role: "PROVIDER", organizationId: institution.organizationId }).where(eq(users.id, actor.id));
    });
    return { status: "ok" };
  });
  app.get("/api/admin/organization-claims", async req => {
    requireUser(req, ["ADMIN"]); return GovernmentEntity.array().parse((await claimRows()).map(claimDto));
  });
  for (const decision of ["approve", "reject"] as const) app.post(`/api/admin/organization-claims/:id/${decision}`, async req => {
    const actor = requireUser(req, ["ADMIN"]), id = claimId(req.params), input = GovernmentClaimReview.parse(req.body);
    if (decision === "approve" && !input.representativeVerified) fail(422, "Najpierw potwierdź uprawnienie do reprezentowania instytucji.");
    await db.transaction(async tx => {
      const [claim] = await tx.select().from(claims).where(eq(claims.id, id)).for("update");
      if (!claim) fail(404, "Nie znaleziono wniosku.");
      if (claim.status !== "PENDING") fail(409, "Wniosek został już rozpatrzony.");
      if (decision === "approve") {
        const [institution] = await tx.select().from(institutions).where(eq(institutions.id, claim.institutionId)).for("update");
        let organizationId = institution!.organizationId;
        if (!organizationId) {
          const [org] = await tx.insert(organizations).values({ name: institution!.name, isDemo: false }).returning();
          organizationId = org!.id;
          await tx.update(institutions).set({ organizationId }).where(eq(institutions.id, institution!.id));
        }
        await tx.insert(memberships).values({ userId: claim.userId, organizationId }).onConflictDoNothing();
      }
      await tx.update(claims).set({ status: decision === "approve" ? "APPROVED" : "REJECTED", note: input.note, reviewedBy: actor.id }).where(eq(claims.id, id));
    });
    return { status: "ok" };
  });
}
