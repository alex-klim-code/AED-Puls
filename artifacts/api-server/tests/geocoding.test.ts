import{test}from"node:test";
import assert from"node:assert/strict";
import{assessGeocode}from"../src/geocoding/geoapify";
import{geocodingAddress}from"../src/geocoding/address";
import{publicationAfterGeocoding}from"../src/geocoding/publication";
const address={address:"ul. Nowa 1",city:"Warszawa"};
const building={lat:52.23,lon:21.01,country_code:"pl",city:"Warszawa",street:"Nowa",housenumber:"1",result_type:"building",
  rank:{confidence:1,confidence_city_level:1,confidence_street_level:1,confidence_building_level:1,match_type:"full_match"}};
test("one exact high-confidence Polish building may supply coordinates",()=>{
  const result=assessGeocode(address,[building]);assert.equal(result.status,"RESOLVED");assert.equal(result.candidate?.lat,52.23);
});
test("city/street centroids, nearby addresses and weak confidence cannot become AED locations",()=>{
  for(const candidate of[
    {...building,result_type:"city"},{...building,result_type:"street"},{...building,housenumber:"2"},
    {...building,city:"Kraków"},{...building,street:"Inna"},{...building,country_code:"de"},
    {...building,lat:21.01,lon:52.23},{...building,rank:{...building.rank,confidence_building_level:0.94}},
    {...building,rank:{confidence:1,match_type:"full_match"}},{...building,rank:{...building.rank,match_type:"match_by_building"}},
  ])assert.notEqual(assessGeocode(address,[candidate]).status,"RESOLVED");
});
test("several reliable matches require human review instead of picking the first",()=>{
  assert.equal(assessGeocode(address,[building,{...building,lon:21.0102}]).status,"AMBIGUOUS");
});
test("empty and malformed provider results never create replacement coordinates",()=>{
  assert.equal(assessGeocode(address,[]).status,"UNRESOLVED");
  assert.equal(assessGeocode(address,[{lat:null,lon:0}]).status,"PROVIDER_ERROR");
  assert.notEqual(assessGeocode({address:"Nowa",city:""},[building]).status,"RESOLVED");
});
test("a full source address supplies explicit locality and postcode without changing the original",()=>{
  const input={address:"ul. Nowa 1, 00-001 Warszawa",city:""};
  assert.deepEqual(geocodingAddress(input),{address:"ul. Nowa 1",city:"Warszawa",postalCode:"00-001"});
  assert.equal(input.city,"");
  assert.equal(assessGeocode(input,[{...building,postcode:"00-001"}]).status,"RESOLVED");
  assert.notEqual(assessGeocode(input,[{...building,postcode:"00-002"}]).status,"RESOLVED");
});
test("contradictory localities and partial addresses cannot supply replacement locations",()=>{
  assert.equal(geocodingAddress({address:"Nowa 1, 00-001 Warszawa",city:"Kraków"}),null);
  assert.equal(geocodingAddress({address:"Nowa 1",city:""}),null);
  assert.equal(geocodingAddress({address:"Warszawa",city:"Warszawa"}),null);
  assert.equal(geocodingAddress({address:"Nowa, 00-001 Warszawa",city:""}),null);
});
test("source punctuation can be normalized for a query without inventing a street or house",()=>{
  assert.deepEqual(geocodingAddress({address:"Al.. Piłsudskiego 96, 05-270 Marki",city:""}),
    {address:"Al. Piłsudskiego 96",city:"Marki",postalCode:"05-270"});
});
test("geocoding can resolve a source coordinate hold but never license or administrator holds",()=>{
  const record={publicImport:false,license:"CC-BY-4.0",locationEvidence:{method:"source_recovery",
    issues:[{rule:"outside_poland",severity:"error"}]}};
  assert.equal(publicationAfterGeocoding(record),true);
  assert.equal(publicationAfterGeocoding({...record,license:"UNKNOWN"}),false);
  assert.equal(publicationAfterGeocoding({...record,locationEvidence:{...record.locationEvidence,method:"administrator_edit"}}),false);
  assert.equal(publicationAfterGeocoding({...record,locationEvidence:{...record.locationEvidence,
    issues:[...record.locationEvidence.issues,{rule:"missing_attribution",severity:"error"}]}}),false);
  assert.equal(publicationAfterGeocoding({...record,locationEvidence:{method:"source_recovery"}}),false);
});
