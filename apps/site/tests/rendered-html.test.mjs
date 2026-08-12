import assert from "node:assert/strict";
import test from "node:test";

const routes = [
  ["/", /Your collection,.*alive.*right moment/is],
  ["/privacy", /Your collection stays yours/i],
  ["/terms", /Alpha software, clear expectations/i],
  ["/security", /Small surface.*Visible boundaries/is],
  ["/accessibility", /Atmosphere without barriers/i],
  ["/support", /Get unstuck without giving up your privacy/i],
];

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

for (const [pathname, expected] of routes) {
  test(`server-renders ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, expected);
    assert.match(html, /Project Ambient/);
    assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  });
}

test("homepage exposes launch and trust paths", async () => {
  const response = await render("/");
  const html = await response.text();
  assert.match(html, /Project-Ambient-alpha\.zip/);
  assert.match(html, /Unsigned alpha/i);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/security"/);
  assert.match(html, /og-project-ambient\.png/);
});
