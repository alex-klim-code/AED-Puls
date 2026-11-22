import test from "node:test";
import assert from "node:assert/strict";
import { reverseAddress } from "../src/geocoding/reverse";
import { signLocationReceipt,readLocationReceipt,type LocationReceipt } from "../src/modules/submission-location";

const receipt:LocationReceipt={userId:"fixture",expiresAt:Date.now()+60000,capturedAt:Date.now(),
  latitude:52.23,longitude:21.01,accuracy:10,address:"Testowa 1",city:"TEST",postalCode:"00-001",voivodeship:"TEST",addressStatus:"RESOLVED"};
test("GPS receipt is account-bound, expiring and cannot be modified",()=>{
  const token=signLocationReceipt(receipt);
  assert.deepEqual(readLocationReceipt(token,"fixture"),receipt);
  assert.throws(()=>readLocationReceipt(token,"another-user"),/GPS/);
  assert.throws(()=>readLocationReceipt(signLocationReceipt({...receipt,expiresAt:Date.now()-1}),"fixture"),/GPS/);
  assert.throws(()=>readLocationReceipt(`${token}x`,"fixture"),/GPS/);
  assert.throws(()=>readLocationReceipt(undefined,"fixture"),/GPS/);
});
test("reverse address uses nearby Polish results without replacing the GPS coordinates",()=>{
  const address=reverseAddress(52.23,21.01,{results:[{country_code:"pl",lat:52.2301,lon:21.0101,street:"Testowa",housenumber:"1",city:"TEST",postcode:"00-001",state:"TEST"}]});
  assert.equal(address.address,"Testowa 1");assert.equal(address.addressStatus,"RESOLVED");
  assert.equal(reverseAddress(52.23,21.01,{results:[{country_code:"pl",lat:50.06,lon:19.94,street:"Daleka",city:"TEST"}]}).addressStatus,"UNRESOLVED");
  assert.equal(reverseAddress(52.23,21.01,{results:[]}).address,"");
  assert.equal(reverseAddress(52.23,21.01,{results:[{country_code:"de",lat:52.23,lon:21.01}]}).city,"");
});
