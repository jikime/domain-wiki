import Link from "next/link";
export default function NotFound() {
  return (
    <main className="standalone panel">
      <span className="eyebrow">페이지를 열 수 없어요</span>
      <h1>접근 가능한 페이지를 확인해 주세요</h1>
      <p>주소가 바뀌었거나 이 작업공간을 이용할 권한이 없을 수 있습니다.</p>
      <Link className="space-link" href="/">
        내 작업공간으로 →
      </Link>
    </main>
  );
}
