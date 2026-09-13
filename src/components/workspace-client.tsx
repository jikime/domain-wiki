"use client";

import { createContext, useContext, useState } from "react";

const WorkspaceClientContext = createContext<{
  userId: string;
  conversationSearch: { q: string; page: number };
  setConversationSearch: (value: { q: string; page: number }) => void;
} | null>(null);

export function WorkspaceClient({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const [conversationSearch, setConversationSearch] = useState({
    q: "",
    page: 1,
  });
  return (
    <WorkspaceClientContext
      value={{ userId, conversationSearch, setConversationSearch }}
    >
      {children}
    </WorkspaceClientContext>
  );
}
export function useWorkspaceClient() {
  const context = useContext(WorkspaceClientContext);
  if (!context) throw new Error("작업공간을 다시 열어주세요.");
  return context;
}
