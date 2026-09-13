import type { Metadata } from "next";
import { RecoveryEntry } from "@/components/account-controls";
export const metadata: Metadata = { referrer: "no-referrer" };
export default function ResetPasswordPage() {
  return (
    <main className="login-panel account-recovery">
      <div className="login-card">
        <span className="eyebrow">계정 복구</span>
        <h1>새 비밀번호 설정</h1>
        <p>복구가 완료되면 기존 기기의 로그인이 모두 해제됩니다.</p>
        <RecoveryEntry />
      </div>
    </main>
  );
}
