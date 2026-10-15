import Link from "next/link";
export default function WorkbookNotFound() {
  return (
    <main id="workbook-main" className="wb-contents">
      <p className="wb-kicker">문서를 찾을 수 없습니다</p>
      <h1>워크북 목차에서 다시 찾아볼까요?</h1>
      <p>주소가 바뀌었거나 등록되지 않은 문서입니다.</p>
      <Link href="/workbook">워크북 전체 목차로 →</Link>
    </main>
  );
}
