// 통합시험 프로세스에서만 사용합니다. 서버의 URL/IP 검사는 그대로 실행하고
// 전송 계층의 가상 공식 사이트만 대체합니다. 운영 환경에서는 로드하지 않습니다.
const dns = require("node:dns/promises");
const https = require("node:https");
const { syncBuiltinESMExports } = require("node:module");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { readFileSync } = require("node:fs");
const originalLookup = dns.lookup;
const originalRequest = https.request;
dns.lookup = async function (hostname, options) {
  if (["official.example.test", "private.example.test"].includes(hostname)) {
    const address =
      hostname === "private.example.test" ? "127.0.0.1" : "93.184.216.34";
    return options?.all ? [{ address, family: 4 }] : { address, family: 4 };
  }
  return originalLookup.call(this, hostname, options);
};
https.request = function (...args) {
  const [options, callback] = args;
  if (options?.servername !== "official.example.test")
    return originalRequest.apply(this, args);
  if (
    options.hostname !== "93.184.216.34" ||
    options.headers.Host !== "official.example.test"
  )
    throw new Error("시험: 검증한 IP 또는 원래 Host가 다릅니다.");
  const request = new EventEmitter();
  let timer;
  request.end = () => {
    timer = setTimeout(
      () => {
        if (options.signal?.aborted) {
          request.emit("error", new Error("aborted"));
          return;
        }
        const path = options.path;
        let bytes = Buffer.from(
          `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>가상 기관 관제 기준</title><meta property="article:published_time" content="2026-08-01"></head><body><main><h1>가상 기관 관제 기준</h1><p>관제 화면은 30초마다 갱신합니다. 모든 화면에 일괄 적용하지 않습니다.</p><p>시행일: 2026-09-01. 실제 기관 자료가 아닌 개발 시험입니다.</p><table><tr><th>항목</th><th>조건</th></tr><tr><td>재연결</td><td>확인 후 적용, 즉시 적용하지 않음</td></tr></table><a href="/files/guide.pdf">첨부 기준 PDF</a><a href="https://outside.example.test/a.pdf">허용하지 않은 첨부</a><script>throw Error('실행되면 안 됨')</script></main></body></html>`,
        );
        let status = 200;
        const headers = { "content-type": "text/html; charset=utf-8" };
        if (path.startsWith("/redirect-out")) {
          status = 302;
          headers.location = "https://outside.example.test/secret";
        }
        if (path.startsWith("/redirect-ok")) {
          status = 302;
          headers.location = "/notice";
        }
        if (path.startsWith("/oversize"))
          headers["content-length"] = "99999999";
        if (path.startsWith("/files/guide.pdf")) {
          bytes = readFileSync(
            "docs/evaluation/stage-02/fixtures/text-pages.pdf",
          );
          headers["content-type"] = "application/pdf";
        }
        if (path.startsWith("/forbidden")) status = 403;
        const response = Readable.from([bytes]);
        response.statusCode = status;
        response.headers = headers;
        callback(response);
      },
      options.path.startsWith("/slow") ? 1600 : 2,
    );
  };
  options.signal?.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      request.emit("error", new Error("aborted"));
    },
    { once: true },
  );
  return request;
};
syncBuiltinESMExports();
