import Link from "next/link";
export default function ForgotPasswordPage() {
  return (
    <main className="login-panel account-recovery">
      <div className="login-card">
        <span className="eyebrow">계정 복구 안내</span>
        <h1>비밀번호를 잊으셨나요?</h1>
        <p>
          작업공간 관리자에게 본인 확인 후 일회용 복구 링크를 요청해 주세요.
        </p>
        <ol className="form-stack">
          <li>
            관리자는 ‘관리 → 직원 계정 → 비밀번호 분실 복구’에서 링크를
            발급합니다.
          </li>
          <li>받은 링크를 15분 안에 열고 새 비밀번호를 설정하세요.</li>
          <li>
            새 비밀번호로 다시 로그인하세요. 기존 기기의 로그인은 해제됩니다.
          </li>
        </ol>
        <p className="field-help">
          링크가 만료되었거나 이미 사용되었다면 새 링크를 요청해 주세요.
        </p>
        <Link className="action-link" href="/login">
          로그인으로 돌아가기 →
        </Link>
      </div>
    </main>
  );
}
