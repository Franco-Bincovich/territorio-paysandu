import test from "node:test";
import assert from "node:assert/strict";
import {
  checkOrigin,
  jsonBody,
  accountBucket,
} from "../../src/server/security";

test("independent: missing, null and look-alike origins cannot mutate", () => {
  for (const origin of [
    undefined,
    "null",
    "https://pilot.example.invalid.evil.invalid",
    "http://pilot.example.invalid",
  ]) {
    const request = new Request(
      "https://pilot.example.invalid/api/auth/password",
      { method: "POST", headers: origin ? { origin } : undefined },
    );
    assert.throws(() => checkOrigin(request, "https://pilot.example.invalid"));
  }
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request("https://pilot.example.invalid/api/auth/password", {
        method: "POST",
        headers: { origin: "https://pilot.example.invalid" },
      }),
      "https://pilot.example.invalid",
    ),
  );
});
test("independent: chunked body without content-length stops at bounded bytes", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(32769));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request(
    "https://pilot.example.invalid/api/consultations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit,
  );
  await assert.rejects(jsonBody(request));
  assert.equal(cancelled, true);
});
test("independent: username case/compatibility variants share abuse bucket", () => {
  assert.equal(accountBucket(" Paysandu "), accountBucket("paysandu"));
  assert.equal(accountBucket("Ｐａｙｓａｎｄｕ"), accountBucket("paysandu"));
});

test('independent: combined history rejects rollover dates and duplicate/overflow filters',async()=>{
 const {historyFilters}=await import('../../src/server/filters');
 for(const query of ['from=2026-02-30','from=2026-04-31','from=2026-05-01&to=2026-04-01','page=1&page=2','page=2147483647&pageSize=100','parcel=1%00','type=Administrador'])assert.throws(()=>historyFilters(new URLSearchParams(query)));
 assert.equal(historyFilters(new URLSearchParams('from=2024-02-29&to=2024-03-01&type=General&parcel=12')).filters.parcel,'12');
});
test('independent: request logging excludes path identifiers and operation error text',async()=>{
 const {observeRequest,routeTemplate}=await import('../../src/server/observability');
 const events:unknown[]=[];const marker='QA-PRIVATE-SENTINEL';
 await assert.rejects(observeRequest(routeTemplate(['parcels',marker,marker]),async()=>{throw Error(marker);},event=>events.push(event)));
 const serialized=JSON.stringify(events);assert.equal(serialized.includes(marker),false);assert.equal((events[0] as {status:number}).status,500);
 const response=await observeRequest('unmatched',async()=>new Response(null,{status:404,headers:{'X-Request-ID':marker}}),event=>events.push(event));assert.notEqual(response.headers.get('X-Request-ID'),marker);
});
