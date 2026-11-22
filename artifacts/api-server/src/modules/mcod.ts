import type { FastifyInstance } from "fastify";
import { GetMcodIntegrationStatusResponse, InspectMcodContractResponse,GetMcodWorkspaceResponse,ListMcodInstitutionsQueryParams,
  SubmitMcodInstitutionRequestBody,ReviewMcodInstitutionRequestBody,PrepareMcodDatasetBody,PrepareMcodPublicationBody,
  SaveMcodAedDraftBody,UpdateMcodAedDraftBody,SubmitMcodAedDraftBody } from "@workspace/api-zod";
import { z } from "zod/v4";
import { requireUser } from "./auth";
import { createMcodClient } from "../integrations/mcod/client";
import { mcodWorkspace,cachedInstitutions,refreshInstitutions,submitInstitution,reviewInstitution } from "./mcod-local";
import { saveAedDraft,submitAedDraft,prepareDataset } from "./mcod-drafts";
import { preparePublication,publicationFile } from "./mcod-plans";
import { executeInstitution,executePublication } from "./mcod-publish";
import { syncMcod } from "./mcod-sync";

const idOf=(params:unknown)=>z.object({id:z.uuid()}).parse(params).id;
const remoteLimit={config:{rateLimit:{max:3,timeWindow:"1 minute"}}};

export function registerMcod(app: FastifyInstance) {
  const client = createMcodClient();
  app.get("/api/admin/mcod/status", async (req) => {
    requireUser(req, ["ADMIN"]);
    return GetMcodIntegrationStatusResponse.parse(client.status());
  });
  app.post("/api/admin/mcod/contract", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req) => {
    requireUser(req, ["ADMIN"]);
    // Global session + CSRF protection applies. No automatic retry or writes.
    return InspectMcodContractResponse.parse(await client.inspectContract());
  });
  app.get("/api/mcod/workspace",async req=>GetMcodWorkspaceResponse.parse(await mcodWorkspace(requireUser(req))));
  app.get("/api/mcod/institutions",async req=>{
    requireUser(req);
    const input=ListMcodInstitutionsQueryParams.parse(req.query);
    return cachedInstitutions(input.page??1,input.search??"");
  });
  app.post("/api/admin/mcod/institutions/refresh",remoteLimit,async req=>refreshInstitutions(requireUser(req,["ADMIN"])));
  app.post("/api/mcod/institution-requests",async(req,reply)=>{
    const result=await submitInstitution(requireUser(req,["USER","PROVIDER"]),SubmitMcodInstitutionRequestBody.parse(req.body));
    return reply.code(201).send(result);
  });
  app.post("/api/admin/mcod/institution-requests/:id/review",async req=>
    reviewInstitution(requireUser(req,["ADMIN"]),idOf(req.params),ReviewMcodInstitutionRequestBody.parse(req.body)));
  app.post("/api/admin/mcod/institution-requests/:id/execute",remoteLimit,async req=>
    executeInstitution(requireUser(req,["ADMIN"]),idOf(req.params)));
  app.post("/api/mcod/datasets",async(req,reply)=>reply.code(201).send(await prepareDataset(requireUser(req,["PROVIDER","ADMIN"]),PrepareMcodDatasetBody.parse(req.body))));
  app.post("/api/mcod/publications",async(req,reply)=>reply.code(201).send(await preparePublication(requireUser(req,["PROVIDER","ADMIN"]),PrepareMcodPublicationBody.parse(req.body))));
  app.get("/api/mcod/publications/:id/download",async(req,reply)=>{
    const id=idOf(req.params),file=await publicationFile(requireUser(req,["PROVIDER","ADMIN"]),id);
    return reply.type(file.format==="csv"?"text/csv; charset=utf-8":"application/geo+json; charset=utf-8")
      .header("Content-Disposition",`attachment; filename="aed-${id}.${file.format}"`).send(file.content);
  });
  app.post("/api/mcod/publications/:id/execute",remoteLimit,async req=>
    executePublication(requireUser(req,["PROVIDER","ADMIN"]),idOf(req.params)));
  app.post("/api/mcod/aed-drafts",async(req,reply)=>
    reply.code(201).send(await saveAedDraft(requireUser(req,["PROVIDER"]),SaveMcodAedDraftBody.parse(req.body))));
  app.put("/api/mcod/aed-drafts/:id",async req=>
    saveAedDraft(requireUser(req,["PROVIDER"]),UpdateMcodAedDraftBody.parse(req.body),idOf(req.params)));
  app.post("/api/mcod/aed-drafts/:id/submit",async req=>
    submitAedDraft(requireUser(req,["PROVIDER"]),idOf(req.params),SubmitMcodAedDraftBody.parse(req.body)));
  app.post("/api/admin/mcod/sync",remoteLimit,async req=>syncMcod(requireUser(req,["ADMIN"])));
}
