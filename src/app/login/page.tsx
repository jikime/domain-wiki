import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { LoginForm } from "@/components/auth-controls";
export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="brand">우리 업무 위키</div>
        <div>
          <span className="eyebrow">팀의 지식을, 다음 업무로</span>
          <h1>
            함께 쌓은 경험이
            <br />
            일의 출발점이 되도록.
          </h1>
          <p>
            업무 자료와 실무 경험을 한곳에 모으고,
            <br />
            필요한 순간에 근거를 확인하는 우리 팀의 공간입니다.
          </p>
        </div>
        <div className="login-foot">
          <span>자료에서 지식으로</span>
          <ArrowUpRight size={20} />
          <span>지식에서 다음 질문으로</span>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">우리 팀의 업무 공간</span>
          <h2>다시 만나 반가워요</h2>
          <p className="muted">관리자가 제공한 계정으로 로그인해 주세요.</p>
          <LoginForm />
          <Link className="back-link" href="/forgot-password">
            비밀번호를 잊으셨나요?
          </Link>
          <p className="login-help">
            처음 방문하셨거나 로그인이 어려우시면
            <br />
            작업공간 관리자에게 문의해 주세요.
          </p>
        </div>
      </section>
    </main>
  );
}
