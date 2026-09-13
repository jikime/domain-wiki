"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="standalone panel">
      <h1>잠시 연결이 원활하지 않아요</h1>
      <p>저장된 데이터는 유지됩니다. 잠시 후 다시 시도해 주세요.</p>
      <Button onClick={reset}>다시 시도</Button>
    </main>
  );
}
