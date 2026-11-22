import test from "node:test";
import assert from "node:assert/strict";
import { connectSource, SOURCE_DEFINITIONS, REVIEWED_SOURCES } from "../src/ingestion/connectors";
import { scheduledSource } from "../src/ingestion/source-registry";
import { exportOptions } from "../src/modules/export-dataset";

test("multiple real integrations are registered; WMS remains auxiliary", () => {
  assert.deepEqual(SOURCE_DEFINITIONS.map(s=>s.key).sort(),
    ["dane-gov","openaedmap","przemysl","warszawa","openaed-eu"].sort());
  assert.equal(REVIEWED_SOURCES[0]?.key,"geoportal");
  for(const key of ["dane-gov","openaedmap","przemysl"]){
    assert.equal(scheduledSource({key} as Parameters<typeof scheduledSource>[0]),true);
  }
  for(const key of ["geoportal","dane-gov:3624","unknown"]){
    assert.equal(scheduledSource({key} as Parameters<typeof scheduledSource>[0]),false);
  }
  assert.equal(scheduledSource({key:"warszawa",status:"unavailable",lastSuccessAt:null} as Parameters<typeof scheduledSource>[0]),false);
});

test("export accepts several providers and licenses without assigning a common license", () => {
  const providers="dane-gov,aed-puls,source:00000000-0000-4000-8000-000000000001";
  const request={query:{scope:"public",providerIds:providers,licenses:"CC0-1.0,CC-BY-4.0,ODbL-1.0"}};
  const options=exportOptions(request as Parameters<typeof exportOptions>[0],"public");
  assert.deepEqual(options.providerIds,providers.split(","));
  assert.deepEqual(options.licenses,["CC-BY-4.0","CC0-1.0","ODbL-1.0"]);
});

test("OpenAED without configuration reports a real configuration error, not fake points",async()=>{
  // No credentials or network access are needed to exercise this branch.
  const {openAedConfiguration}=await import("../src/ingestion/optional-connectors");
  assert.equal(openAedConfiguration({}).ready,false);
  assert.equal(typeof connectSource,"function");
});
