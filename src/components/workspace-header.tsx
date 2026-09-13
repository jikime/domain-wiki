"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useActivitySummary } from "@/components/activity-controls";
import { LogoutButton } from "@/components/auth-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceNav } from "@/components/workspace-nav";
import { roleLabels } from "@/lib/validation";

export function WorkspaceHeader({
  workspaceId,
  workspaceName,
  userName,
  role,
  isAdmin,
}: {
  workspaceId: string;
  workspaceName: string;
  userName: string;
  role: keyof typeof roleLabels;
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const activity = useActivitySummary(workspaceId);
  const base = `/w/${workspaceId}`;
  const roleName = `${isAdmin ? "관리자 · " : ""}${roleLabels[role]}`;
  return (
    <header className="site-header">
      <div className="header-main">
        <div className="header-start">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="전체 메뉴 열기">
                <Menu size={20} />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="navigation-sheet">
              <SheetHeader>
                <SheetTitle>우리 업무 위키</SheetTitle>
                <SheetDescription>{workspaceName}</SheetDescription>
              </SheetHeader>
              <WorkspaceNav
                workspaceId={workspaceId}
                role={role}
                isAdmin={isAdmin}
                onNavigate={() => setOpen(false)}
              />
              <div className="menu-profile">
                <strong>{userName}</strong>
                <span>{roleName}</span>
                <Link href={`${base}/activity`} onClick={() => setOpen(false)}>
                  내 활동
                  {activity?.unread ? ` · 미확인 ${activity.unread}건` : ""} →
                </Link>
                <Link href={`${base}/projects`} onClick={() => setOpen(false)}>
                  프로젝트 →
                </Link>
                <Link href={`${base}/account`} onClick={() => setOpen(false)}>
                  내 계정·비밀번호 변경 →
                </Link>
                <LogoutButton />
              </div>
            </SheetContent>
          </Sheet>
          <Link
            className="header-search"
            href={`${base}/sources`}
            aria-label="자료 검색"
          >
            <Search size={18} />
            <span>자료 검색</span>
          </Link>
        </div>
        <Link className="brand header-brand" href={base}>
          우리 업무 위키
        </Link>
        <div className="header-end">
          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogTrigger asChild>
              <Button
                variant="ghost"
                className="account-name"
                aria-label={`내 계정 메뉴${activity?.unread ? ` · 미확인 ${activity.unread}건` : ""}`}
              >
                <span>
                  {userName}
                  {activity?.unread ? (
                    <span className="activity-badge">{activity.unread}</span>
                  ) : null}
                </span>
                <span className="account-role">{roleName}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>내 계정 메뉴</DialogTitle>
                <DialogDescription>
                  {userName} · {roleName}
                </DialogDescription>
              </DialogHeader>
              <nav className="account-menu-links" aria-label="계정 바로가기">
                <Link
                  href={`${base}/activity`}
                  onClick={() => setAccountOpen(false)}
                >
                  내 활동
                  {activity?.unread ? ` · 미확인 ${activity.unread}건` : ""} →
                </Link>
                <Link
                  href={`${base}/account`}
                  onClick={() => setAccountOpen(false)}
                >
                  계정·비밀번호 변경 →
                </Link>
                <Link
                  href={`${base}/projects`}
                  onClick={() => setAccountOpen(false)}
                >
                  프로젝트 →
                </Link>
                {role === "reviewer" && (
                  <Link
                    href={`${base}/reviews/desk?filter=mine`}
                    onClick={() => setAccountOpen(false)}
                  >
                    내 담당 검토 {activity?.reviews.assigned ?? 0}건 →
                  </Link>
                )}
              </nav>
            </DialogContent>
          </Dialog>
          <LogoutButton />
          <Link
            className="header-search mobile-search"
            href={`${base}/sources`}
            aria-label="자료 검색"
          >
            <Search size={19} />
          </Link>
        </div>
      </div>
      <div className="desktop-nav">
        <WorkspaceNav workspaceId={workspaceId} role={role} isAdmin={isAdmin} />
      </div>
    </header>
  );
}
