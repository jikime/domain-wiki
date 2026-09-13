import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/auth-controls";
import { AccessError, myWorkspaces } from "@/server/access";
export default async function IndexPage() {
  const spaces = await myWorkspaces(await headers()).catch((error) => {
    if (error instanceof AccessError && error.status === 401)
      redirect("/login");
    throw error;
  });
  if (spaces.length === 1) redirect(`/w/${spaces[0].id}`);
  return (
    <main className="standalone panel">
      <h1>작업공간 선택</h1>
      {spaces.length ? (
        spaces.map((space) => (
          <Link className="space-link" href={`/w/${space.id}`} key={space.id}>
            {space.name} →
          </Link>
        ))
      ) : (
        <p>이용 가능한 작업공간이 없습니다. 관리자에게 문의해 주세요.</p>
      )}
      <LogoutButton />
    </main>
  );
}
