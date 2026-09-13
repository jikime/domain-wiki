import { PasswordForm } from "@/components/account-controls";
import { pageContext } from "@/server/page-access";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>내 계정</h1>
          <p>
            {context.user.name} · {context.user.email}
          </p>
        </div>
      </div>
      <section className="panel">
        <h2 className="content-subtitle">비밀번호 변경</h2>
        <p className="field-help">
          현재 비밀번호를 확인한 뒤 변경합니다. 다른 기기의 로그인은 해제됩니다.
        </p>
        <PasswordForm />
      </section>
    </>
  );
}
