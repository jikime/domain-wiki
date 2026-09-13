import { WorkspaceClient } from "@/components/workspace-client";
import { WorkspaceHeader } from "@/components/workspace-header";
import { pageContext } from "@/server/page-access";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await pageContext(workspaceId);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 바로 가기
      </a>
      <WorkspaceHeader
        workspaceId={workspaceId}
        workspaceName={context.workspaceName}
        userName={context.user.name}
        role={context.role}
        isAdmin={context.isAdmin}
      />
      <main id="main-content" className="workspace-main" tabIndex={-1}>
        <WorkspaceClient
          key={`${workspaceId}:${context.user.id}`}
          userId={context.user.id}
        >
          {children}
        </WorkspaceClient>
      </main>
      <footer className="app-footer">
        <span className="footer-brand">우리 업무 위키</span>
        <p>함께 기록하고, 근거를 확인하고, 다음 업무에 활용합니다.</p>
      </footer>
    </div>
  );
}
