import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, ilike, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db, aeds, sources, auditLogs, submissions, reports, dataConflicts } from "@workspace/db";
import {
  CreateReportBody, ReviewAedBody, GetAedResponse, ListAedsResponse,
  GetWorkspaceResponse, GetStatsResponse, ListSourcesResponse, GetSourceDirectoryResponse,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import { fail, requireUser } from "./auth";
import { provenanceMap } from "../ingestion/provenance";
import { gzipSync } from "node:zlib";
import { located, locatedClause, verificationClause, verificationState } from "./record-state";
import { sourceDirectory } from "./source-directory";
import { prepareProposal,storeProposal,proposalDto,proposalSource } from "./proposal-service";
import { SubmitAedResponse } from "@workspace/api-zod";
import { attachPhoto } from "./submission-photos";

export const publicAed = () => and(isNull(aeds.mergedIntoId), locatedClause(), or(
  verificationClause("VERIFIED"),
  and(verificationClause("unverified"), eq(aeds.publicImport, true)),
));

export function demoScope(_req: FastifyRequest) {
  // Demo identifies the authentication method, never a separate dataset.
  return false;
}
export function serializeAed(row: typeof aeds.$inferSelect) {
  return GetAedResponse.parse({
    ...row,
    verificationStatus:verificationState(row.verificationStatus),
    accessibility: row.sourceConflict ? "unknown" : row.accessibility,
    openingHours: row.sourceConflict ? undefined : row.openingHours ?? undefined,
    postalCode: row.postalCode ?? undefined, voivodeship: row.voivodeship ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    operationalStatus: row.deviceOperationalStatus,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  });
}
const uuid = z.string().uuid();
function idParam(req: FastifyRequest) {
  return uuid.parse((req.params as { id: string }).id);
}
export function registerAeds(app: FastifyInstance) {
  const list = async (req:FastifyRequest,locatedOnly=false) => {
    const q = z.object({
      search: z.string().max(200).optional(),
      accessibility: z.enum(["24/7", "limited", "unknown", ""]).optional(),
      verificationStatus: z.string().max(40).optional(), demo: z.enum(["true", "false"]).optional(),
      sourceId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(20000).default(2000),
    }).parse(req.query);
    const scope = demoScope(req);
    const status = q.verificationStatus || "public";
    if (!["public", "verified", "unverified"].includes(status)) {
      const user = requireUser(req, ["ADMIN"]);
    }
    const clauses = [eq(aeds.isDemo, scope), isNull(aeds.mergedIntoId),
      status === "public" ? publicAed()! : status === "unverified" && req.account?.role !== "ADMIN" ? and(verificationClause(status), eq(aeds.publicImport, true))! : verificationClause(status)];
    if(locatedOnly)clauses.push(locatedClause());
    if (q.sourceId) clauses.push(sql`exists (
      select 1 from source_observations o join aed_records origin on o.aed_id=origin.id
      where o.source_id=${q.sourceId} and (origin.id=${aeds.id} or origin.merged_into_id=${aeds.id})
    )`);
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, "\\$&")}%`;
      clauses.push(or(ilike(aeds.city, term), ilike(aeds.address, term), ilike(aeds.name, term))!);
    }
    if (q.accessibility) clauses.push(eq(aeds.accessibility, q.accessibility));
    const rows = await db.select().from(aeds).where(and(...clauses)).orderBy(aeds.city, aeds.name, aeds.id).limit(q.limit).offset((q.page - 1) * q.limit);
    return rows;
  };
  app.get("/api/aeds",async req=>ListAedsResponse.parse((await list(req)).map(serializeAed)));
  app.get("/api/map-points",async(req,reply)=>{
    const rows=(await list(req,true)).filter(located);
    const points=rows.map(r=>({id:r.id,name:r.name,address:r.address,city:r.city,latitude:r.latitude,longitude:r.longitude,
      accessibility:r.sourceConflict?"unknown":r.accessibility,verificationStatus:verificationState(r.verificationStatus)==="VERIFIED"?"verified":verificationState(r.verificationStatus)==="REJECTED"?"rejected":"unverified",qualityScore:r.qualityScore,isDemo:false,
      sourceName:r.sourceName,license:r.license,sourceCategory:r.sourceCategory,publicationCount:r.publicationCount,
      independentSourceCount:r.independentSourceCount,sourceConflict:r.sourceConflict}));
    reply.header("Vary","Accept-Encoding");
    if(/\bgzip\b/.test(req.headers["accept-encoding"]??"")){
      reply.header("Content-Encoding","gzip");
      return reply.type("application/json").send(gzipSync(JSON.stringify(points)));
    }
    return points;
  });
  app.get("/api/aeds/:id", async (req) => {
    let [row] = await db.select().from(aeds).where(eq(aeds.id, idParam(req)));
    if (!row) fail(404, "Nie znaleziono AED.");
    for (let depth = 0; row?.mergedIntoId && depth < 100; depth++) {
      [row] = await db.select().from(aeds).where(eq(aeds.id, row.mergedIntoId));
    }
    if (!row) fail(404, "Nie znaleziono rekordu po scaleniu.");
    if (row.isDemo) fail(404, "Nie znaleziono AED.");
    if (verificationState(row.verificationStatus) !== "VERIFIED" && !(verificationState(row.verificationStatus) === "NOT_VERIFIED" && row.imported && row.publicImport && located(row))) {
      const user = requireUser(req);
      const owns = row.submittedBy === user.id || (user.role === "PROVIDER" && !!user.organizationId && user.organizationId === row.organizationId);
      if (!owns && user.role !== "ADMIN") fail(404, "Nie znaleziono AED.");
    }
    return { ...serializeAed(row), provenance: (await provenanceMap([row.id])).get(row.id) ?? [] };
  });
  app.post("/api/aeds", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = requireUser(req);
    const prepared=await prepareProposal(req.body,user);
    const row=await db.transaction(tx=>storeProposal(tx,prepared,user.id));
    return reply.code(201).send(SubmitAedResponse.parse(proposalDto(row)));
  });
  app.post("/api/reports", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user=requireUser(req,["USER","PROVIDER"]);
    const input = CreateReportBody.parse(req.body);
    const [row] = await db.select().from(aeds).where(eq(aeds.id, input.aedId));
    if (!row || row.isDemo || row.mergedIntoId || (verificationState(row.verificationStatus) !== "VERIFIED" && !(verificationState(row.verificationStatus) === "NOT_VERIFIED" && row.imported && row.publicImport && located(row)))) fail(404, "Nie znaleziono publicznego AED.");
    const sourceName=await proposalSource(user);
    await db.transaction(async tx=>{
      const [report]=await tx.insert(reports).values({ ...input,status:"NEW",isDemo:false,submittedBy:user.id,
        organizationId:user.organizationId,sourceName }).returning();
      await attachPhoto(tx,input.photoId,user,"ERROR",report!.id);
      await tx.insert(auditLogs).values({userId:user.id,entityId:report!.id,action:"Przekazano zgłoszenie błędu do administratora",
        details:{aedId:input.aedId}});
    });
    return reply.code(201).send({ status: "Zgłoszenie zapisano. Dziękujemy za pomoc w poprawie danych." });
  });
  app.get("/api/stats", async (req) => {
    const demo = demoScope(req);
    const publicRecords = await db.select().from(aeds).where(and(eq(aeds.isDemo, demo), publicAed()));
    // Pending counters are visible only to administrators; guests cannot infer private submissions.
    const pending = req.account?.role === "ADMIN"
      ? (await db.select({ id: aeds.id }).from(aeds).where(and(eq(aeds.isDemo, demo), isNull(aeds.mergedIntoId), verificationClause("NOT_VERIFIED")))).length : 0;
    const total = req.account?.role === "ADMIN"
      ? (await db.select({ id: aeds.id }).from(aeds).where(and(eq(aeds.isDemo, demo), isNull(aeds.mergedIntoId)))).length
      : publicRecords.length;
    const directory = await sourceDirectory();
    return GetStatsResponse.parse({
      total, verified: publicRecords.filter(r => verificationState(r.verificationStatus) === "VERIFIED").length,
      sources: directory.integrationCount, integrationCount: directory.integrationCount,
      independentPublisherCount: directory.independentPublisherCount, uniqueAedCount: total, pending,
      cities: new Set(publicRecords.map(r => r.city)).size, isDemo: demo,
      averageQuality: publicRecords.length ? Math.round(publicRecords.reduce((n, r) => n + r.qualityScore, 0) / publicRecords.length) : 0,
    });
  });
  app.get("/api/sources", async () => {
    const rows = await db.select().from(sources).where(isNotNull(sources.key)).orderBy(sources.name);
    return ListSourcesResponse.parse(rows.map(r => ({ ...r, lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null })));
  });
  app.get("/api/source-directory", async () => GetSourceDirectoryResponse.parse(await sourceDirectory()));
  app.get("/api/workspace", async (req) => {
    const user = requireUser(req);
    const access = user.role === "ADMIN" ? undefined : user.role === "PROVIDER" && user.organizationId
      ? or(eq(aeds.organizationId, user.organizationId), sql`exists (
          select 1 from source_observations obs
          join data_sources src on src.id=obs.source_id
          join government_institutions gi on gi.id=obs.publisher_id
          join government_organization_claims claim on claim.institution_id=gi.id
          join aed_records origin on origin.id=obs.aed_id
          where coalesce(origin.merged_into_id,origin.id)=${aeds.id}
            and gi.organization_id=${user.organizationId} and claim.user_id=${user.id}
            and claim.status='APPROVED' and obs.removed_at is null
            and (src.key='dane-gov' or src.key like 'dane-gov:%')
        )`) : eq(aeds.submittedBy, user.id);
    const rows = await db.select().from(aeds).where(and(eq(aeds.isDemo, false), access)).orderBy(desc(aeds.createdAt)).limit(1000);
    const logs = await db.select().from(auditLogs).where(and(
      user.role === "ADMIN" ? undefined : eq(auditLogs.userId, user.id),
    )).orderBy(desc(auditLogs.createdAt)).limit(20);
    return GetWorkspaceResponse.parse({
      role: user.role, records: rows.map(serializeAed),
      ownRecords: rows.filter(r => r.submittedBy === user.id).map(serializeAed),
      activity: logs.map(l => ({ id: l.id, action: l.action, createdAt: l.createdAt.toISOString() })),
    });
  });
  app.post("/api/admin/aeds/:id/review", async (req) => {
    const user = requireUser(req, ["ADMIN"]);
    const id = idParam(req), { decision } = ReviewAedBody.parse(req.body);
    const updated = await db.transaction(async (tx) => {
      const [record] = await tx.select().from(aeds).where(and(eq(aeds.id, id), eq(aeds.isDemo, false))).for("update");
      if (!record) fail(404, "Nie znaleziono rekordu w Twoim środowisku.");
      if (verificationState(record.verificationStatus)!=="NOT_VERIFIED" || record.mergedIntoId) fail(409, "To zgłoszenie zostało już rozpatrzone lub połączone.");
      if (decision === "verified" && !["CC0-1.0", "CC-BY-4.0", "ODbL-1.0"].includes(record.license)) fail(400, "Najpierw wyjaśnij licencję źródła.");
      if (decision === "verified") {
        const [licensing] = await tx.select({ id: dataConflicts.id }).from(dataConflicts).where(and(eq(dataConflicts.aedId, id), eq(dataConflicts.field, "license"), eq(dataConflicts.status, "pending"))).limit(1);
        if (licensing) fail(400, "Najpierw rozstrzygnij konflikt licencji źródła.");
      }
      const [row] = await tx.update(aeds).set({
        verificationStatus: decision==="verified"?"VERIFIED":"REJECTED", updatedAt: new Date(),
        // Approval is an editorial decision, not confirmation of medical functionality.
        lastVerifiedAt: decision === "verified" ? new Date() : null,
      }).where(eq(aeds.id, id)).returning();
      await tx.update(submissions).set({ status: decision }).where(eq(submissions.aedId, id));
      await tx.insert(auditLogs).values({
        userId: user.id, entityId: id, isDemo: user.isDemo,
        action: decision === "verified" ? "Zatwierdzono zgłoszenie AED" : "Odrzucono zgłoszenie AED",
        details: { previousStatus: record.verificationStatus, decision },
      });
      return row!;
    });
    return serializeAed(updated);
  });
}
