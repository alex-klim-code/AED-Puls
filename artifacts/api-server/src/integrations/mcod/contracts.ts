import { z } from "zod/v4";

// Application DTOs, NOT claims about the remote MCOD request/response formats.
const id=z.string().trim().min(1).max(200);
export const institutionDetails=z.object({
  fullName:z.string().trim().min(2).max(500),shortName:z.string().trim().max(100).default(""),
  institutionType:z.string().trim().min(1).max(100),address:z.string().trim().min(3).max(1000),
  email:z.email().max(320),phone:z.string().trim().min(3).max(50),
  website:z.union([z.url().max(1000),z.literal("")]).default(""),
  representativeName:z.string().trim().min(2).max(300),
  representativeRole:z.string().trim().min(2).max(300),additionalFields:z.record(z.string(),z.string().max(2000)).default({}),
});
export const institutionDto=z.object({id,name:z.string().min(1),details:z.record(z.string(),z.unknown()).default({})});
export const datasetDto=z.object({id,institutionId:id,title:z.string().min(1),publicationStatus:z.enum(["DRAFT","PUBLISHED"])});
export const resourceDto=z.object({id,datasetId:id,institutionId:id,title:z.string().min(1),
  format:z.enum(["csv","json","geojson"]),license:z.enum(["CC0-1.0","CC-BY-4.0","ODbL-1.0"]).nullable(),
  sourceUrl:z.url(),publisher:z.string().min(1),publicationStatus:z.enum(["DRAFT","PUBLISHED"]),
  publishedAt:z.iso.datetime({offset:true}).nullable(),rightsVerified:z.boolean().default(false),rightsEvidence:z.string().max(10000).default("")});
export const paging=z.object({page:z.number().int().min(1).default(1),pageSize:z.number().int().min(1).max(100).default(50),
  search:z.string().trim().max(200).default("")});
export const pageOf=<T extends z.ZodType>(item:T)=>z.object({items:z.array(item),nextPage:z.number().int().positive().nullable()});
export const operationInputs={
  getInstitutions:paging,getInstitution:z.object({id}),
  createInstitution:institutionDetails.extend({idempotencyKey:id}),
  getDatasets:paging.extend({institutionId:id}),
  createDataset:z.object({institutionId:id,title:z.string().min(1).max(500),description:z.string().max(10000),idempotencyKey:id}),
  getResources:paging.extend({datasetId:id,institutionId:id}),
  getResource:z.object({id,institutionId:id}),
  createResource:z.object({datasetId:id,institutionId:id,title:z.string().min(1),format:z.enum(["csv","geojson"]),content:z.string().max(40*1024*1024),licenses:z.array(z.enum(["CC0-1.0","CC-BY-4.0","ODbL-1.0"])).min(1),idempotencyKey:id}),
  updateResource:z.object({id,datasetId:id,institutionId:id,title:z.string().min(1),format:z.enum(["csv","geojson"]),content:z.string().max(40*1024*1024),licenses:z.array(z.enum(["CC0-1.0","CC-BY-4.0","ODbL-1.0"])).min(1),idempotencyKey:id}),
  publishResource:z.object({id,institutionId:id,idempotencyKey:id}),
  publishDataset:z.object({id,institutionId:id,idempotencyKey:id}),
  downloadResource:z.object({id,institutionId:id}),
};
export type OperationName=keyof typeof operationInputs;
export const operationOutputs={
  getInstitutions:pageOf(institutionDto),getInstitution:institutionDto,createInstitution:institutionDto,
  getDatasets:pageOf(datasetDto),createDataset:datasetDto,getResources:pageOf(resourceDto),getResource:resourceDto,
  createResource:resourceDto,updateResource:resourceDto,publishResource:resourceDto,publishDataset:datasetDto,
  downloadResource:z.object({content:z.string().max(40*1024*1024),format:z.enum(["csv","json","geojson"])}),
};
export type OperationResult<K extends OperationName>=z.infer<typeof operationOutputs[K]>;
export type OperationInput<K extends OperationName>=z.input<typeof operationInputs[K]>;

/** A binding must be supplied by code after reviewing complete, local OpenAPI schemas.
 * An operation path alone does not confirm payloads, pagination or identity semantics.
 * No administrator-provided arbitrary URL can become a binding.
 */
export type ContractBinding={
  method:"GET"|"POST"|"PUT"|"PATCH";evidence:{specSha256:string;reviewedAt:string};
  encode:(input:Record<string,unknown>)=>{path:string;body?:NonNullable<Parameters<typeof fetch>[1]>["body"];headers?:Record<string,string>};
  responseMode?:"json"|"text";
  licensing?:"single-license"|"per-record";
  decode:(body:unknown,metadata:{contentType:string})=>unknown;
};
export type McodBindings=Partial<Record<OperationName,ContractBinding>>;
export const confirmedBindings:McodBindings={};
export const knownOperationPaths=[
  ["GET","/integrations/aed/v1/institutions"],
  ["GET","/integrations/aed/v1/organizations/{org}/datasets"],
  ["POST","/integrations/aed/v1/organizations/{org}/datasets"],
  ["GET","/integrations/aed/v1/organizations/{org}/datasets/{dataset}"],
  ["PATCH","/integrations/aed/v1/organizations/{org}/datasets/{dataset}"],
  ["POST","/integrations/aed/v1/organizations/{org}/datasets/{dataset}/publish"],
  ["POST","/integrations/aed/v1/organizations/{org}/datasets/{dataset}/resources"],
  ["GET","/integrations/aed/v1/organizations/{org}/resources/{resource}"],
  ["PUT","/integrations/aed/v1/organizations/{org}/resources/{resource}"],
  ["POST","/integrations/aed/v1/organizations/{org}/resources/{resource}/publish"],
  ["GET","/integrations/aed/v1/aggregate"],["POST","/integrations/aed/v1/aggregate"],
] as const;
