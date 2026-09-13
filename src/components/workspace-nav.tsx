"use client";
import {
  BookOpen,
  BriefcaseBusiness,
  ClipboardCheck,
  FolderOpen,
  House,
  MessagesSquare,
  Network,
  NotebookPen,
  Settings2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function WorkspaceNav({
  workspaceId,
  role,
  isAdmin,
  onNavigate,
}: {
  workspaceId: string;
  role: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const base = `/w/${workspaceId}`;
  const items = [
    { name: "홈", path: "", icon: House, allowed: true },
    { name: "채팅", path: "/chat", icon: MessagesSquare, allowed: true },
    { name: "위키", path: "/wiki", icon: BookOpen, allowed: true },
    { name: "지식 그래프", path: "/graph", icon: Network, allowed: true },
    { name: "자료실", path: "/sources", icon: FolderOpen, allowed: true },
    { name: "실무 기록", path: "/records", icon: NotebookPen, allowed: true },
    {
      name: "업무 도구",
      path: "/tools",
      icon: BriefcaseBusiness,
      allowed: true,
    },
    {
      name: "검토함",
      path: "/reviews",
      icon: ClipboardCheck,
      allowed: role === "reviewer" || isAdmin,
    },
    { name: "관리", path: "/admin", icon: Settings2, allowed: isAdmin },
  ];
  return (
    <nav aria-label="주 메뉴" className="workspace-nav">
      {items
        .filter((item) => item.allowed)
        .map((item) => (
          <Link
            key={item.name}
            href={`${base}${item.path}`}
            onClick={onNavigate}
            aria-current={
              (
                item.path
                  ? pathname.startsWith(`${base}${item.path}`)
                  : pathname === base
              )
                ? "page"
                : undefined
            }
          >
            <item.icon size={18} />
            <span>{item.name}</span>
          </Link>
        ))}
    </nav>
  );
}
