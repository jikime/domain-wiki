import assert from "node:assert/strict";
import {
  fetchOfficial,
  officialUrl,
  publicAddress,
  withinSite,
} from "../src/server/official/fetch.ts";
import { htmlDocument } from "../src/server/parsers/html.ts";

const site = {
  origin: "https://agency.example",
  pathPrefix: "/docs",
  active: true,
};
for (const value of [
  "127.0.0.1",
  "10.1.2.3",
  "169.254.169.254",
  "100.64.0.1",
  "192.168.1.1",
  "::1",
  "fc00::1",
  "fe80::1",
  "::ffff:127.0.0.1",
  "2001:db8::1",
])
  assert.equal(publicAddress(value), false, value);
assert.equal(publicAddress("93.184.216.34"), true);
assert.equal(
  withinSite(officialUrl("https://agency.example/docs/a"), site),
  true,
);
assert.equal(
  withinSite(officialUrl("https://agency.example/docs-other/a"), site),
  false,
);
for (const url of [
  "http://agency.example/docs",
  "https://127.0.0.1/docs",
  "https://agency.example:444/docs",
  "https://user:pass@agency.example/docs",
  "https://agency.example/docs%2fprivate",
])
  assert.throws(() => officialUrl(url));
const calls = [];
const dependencies = {
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  transport: async (url, address) => {
    calls.push({ url: url.href, address });
    return {
      status: 200,
      bytes: Buffer.from("<main><p>내용</p></main>"),
      contentType: "text/html",
    };
  },
};
const result = await fetchOfficial(
  "https://agency.example/docs/a",
  [site],
  AbortSignal.timeout(2000),
  dependencies,
);
assert.equal(result.filename, "수집원문.html");
assert.equal(calls[0].address, "93.184.216.34");
await assert.rejects(
  () =>
    fetchOfficial(
      "https://agency.example/docs/a",
      [site],
      AbortSignal.timeout(2000),
      {
        ...dependencies,
        lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      },
    ),
  (e) => e.status === 403,
);
let redirects = 0;
await assert.rejects(
  () =>
    fetchOfficial(
      "https://agency.example/docs/a",
      [site],
      AbortSignal.timeout(2000),
      {
        ...dependencies,
        transport: async () => {
          redirects++;
          return {
            status: 302,
            location: "https://other.example/docs/a",
            bytes: Buffer.from(""),
            contentType: "text/html",
          };
        },
      },
    ),
  (e) => e.status === 403,
);
assert.equal(redirects, 1);
await assert.rejects(
  () =>
    fetchOfficial(
      "https://agency.example/docs/a",
      [site],
      AbortSignal.timeout(2000),
      {
        ...dependencies,
        transport: async () => ({
          status: 302,
          location: "/docs/a",
          bytes: Buffer.from(""),
          contentType: "text/html",
        }),
      },
    ),
  (e) => e.status === 502,
);
const abortDns = new AbortController();
const dnsTimer = setTimeout(() => abortDns.abort(), 30);
try {
  await assert.rejects(() =>
    fetchOfficial("https://agency.example/docs/a", [site], abortDns.signal, {
      ...dependencies,
      lookup: async () => new Promise(() => {}),
    }),
  );
} finally {
  clearTimeout(dnsTimer);
}
const parsed = htmlDocument(
  Buffer.from(
    '<html><head><meta property="article:published_time" content="2026-08-01"><title>검토 표본</title></head><body><main><h1>조건</h1><p>30초마다 갱신하되 일괄 적용하지 않습니다.</p><script>비밀 전송 지시</script><table><tr><th>항목</th><th>조건</th></tr><tr><td>화면</td><td>30초</td></tr></table><a href="/docs/a.pdf">첨부</a></main></body></html>',
  ),
  "https://agency.example/docs/a",
);
assert.equal(parsed.publishedHint, "2026-08-01");
assert.equal(parsed.attachments[0].url, "https://agency.example/docs/a.pdf");
assert.ok(parsed.chunks.some((c) => c.text.includes("일괄 적용하지 않습니다")));
assert.ok(
  parsed.chunks.some(
    (c) => c.locator.table === 1 && c.text.includes("2열(조건): 30초"),
  ),
);
assert.ok(!JSON.stringify(parsed.chunks).includes("비밀 전송 지시"));
console.log(
  "공식 수집 경계·예약 IP·DNS 대기 취소·이동 재검사 및 HTML 구절·표·날짜 후보·첨부 추출 검사 통과",
);
