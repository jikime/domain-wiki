import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const target = "docs/evaluation/stage-02/fixtures";
mkdirSync(target, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 850, height: 1100 },
  });
  const style =
    "<style>body{font-family:Arial,sans-serif;padding:35px;font-size:18px;line-height:1.8}h1{font-size:25px}.page{break-after:page}td,th{border:1px solid #555;padding:12px}table{border-collapse:collapse}.columns{display:grid;grid-template-columns:1fr 1fr;gap:30px}</style>";
  await page.setContent(
    `${style}<section class="page"><h1>텍스트 PDF 개발 표본</h1><p>가상의 새봄시 사업 자료입니다. 실제 고객 지침이 아닙니다.</p><p>정상 통신 상태에서는 30초 간격으로 갱신한다.</p><p>마지막 수신 값을 최신 값으로 표시하면 안 된다.</p></section><section><h1>재연결 점검</h1><p>재연결 후 60초 안에 새 데이터 수신 여부를 확인한다.</p></section>`,
  );
  await page.pdf({
    path: `${target}/text-pages.pdf`,
    format: "A4",
    printBackground: true,
  });
  await page.setContent(
    `${style}<h1>복잡한 배치 개발 표본</h1><p>가상 자료이며 실제 지침이 아닙니다.</p><div class="columns"><div><h2>조건 A</h2><p>정상 통신: 30초 갱신.</p><p>재연결: 60초 이내 확인.</p></div><div><h2>예외 B</h2><p>통신 중단: 최신 값으로 표시하면 안 된다.</p><p>검토 중인 변경은 반영 완료가 아니다.</p></div></div><table><tr><th>사업</th><th>주기</th><th>적용</th></tr><tr><td>새봄시</td><td>30초</td><td>정상 통신</td></tr><tr><td>겨울시</td><td>10초</td><td>별도 사업</td></tr></table>`,
  );
  await page.pdf({
    path: `${target}/columns-table.pdf`,
    format: "A4",
    printBackground: true,
  });
  await page.setContent(
    `${style}<h1>스캔 형식 개발 표본</h1><p>이 문장은 이미지에만 포함되어 있습니다.</p><p>통신이 끊기면 최신 값으로 표시하면 안 된다.</p>`,
  );
  const image = await page.screenshot();
  await page.setContent(
    `<style>body{margin:0}img{width:100%}</style><img alt="" src="data:image/png;base64,${image.toString("base64")}" />`,
  );
  await page.pdf({
    path: `${target}/scan-only.pdf`,
    format: "A4",
    printBackground: true,
  });
  writeFileSync(`${target}/broken.pdf`, "%PDF-1.7\ninvalid body\n%%EOF");
  console.log("개발 PDF 표본 4개 생성 완료");
} finally {
  await browser.close();
}
