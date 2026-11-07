import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  READ_ENDPOINTS,
  WRITE_ENDPOINTS,
  UPSTREAM_ENDPOINTS,
  classifyEndpoint,
} from "./rpc-endpoints.mjs";

const vendorIndex = new URL("../../vendor/mattskills-1.8.0-rc.7/lib/index.js", import.meta.url);
const source = await readFile(vendorIndex, "utf8");
const registered = new Set();
for (const match of source.matchAll(/harness\.handle\('(?:wf\.)?([^']+)'/g)) registered.add(match[1]);

const missing = [...registered].filter(name => !UPSTREAM_ENDPOINTS.has(name));
const extra = [...UPSTREAM_ENDPOINTS].filter(name => !registered.has(name));
assert.deepEqual(missing, [], "Manifest is missing upstream endpoints: " + missing.join(", "));
assert.deepEqual(extra, [], "Manifest has endpoints the vendor no longer registers: " + extra.join(", "));

for (const name of registered) {
  assert.notEqual(classifyEndpoint(name, {}), "unknown", `No classification for ${name}`);
}
for (const name of READ_ENDPOINTS) {
  assert.equal(classifyEndpoint(name, {}), "read", `${name} must classify as read`);
}
for (const name of WRITE_ENDPOINTS) {
  assert.equal(classifyEndpoint(name, {}), "write", `${name} must classify as write`);
}
assert.equal(classifyEndpoint("setupLayout", {}), "read");
assert.equal(classifyEndpoint("setupLayout", { layout: "multi" }), "write");
assert.equal(classifyEndpoint("not-an-endpoint", {}), "unknown");

const overlap = [...READ_ENDPOINTS].filter(name => WRITE_ENDPOINTS.has(name));
assert.deepEqual(overlap, [], "Read/write sets must not overlap");
assert.equal(READ_ENDPOINTS.size + WRITE_ENDPOINTS.size, UPSTREAM_ENDPOINTS.size);

console.log(`PASS upstream endpoint manifest covers all ${registered.size} harness.handle registrations`);
console.log(`PASS read=${READ_ENDPOINTS.size} write=${WRITE_ENDPOINTS.size} conditional=setupLayout`);
