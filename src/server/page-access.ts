import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { AccessError, requireWorkspace } from "./access";
export async function pageContext(workspaceId: string, admin = false) {
  try {
    return await requireWorkspace(await headers(), workspaceId, admin);
  } catch (error) {
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/login");
      notFound();
    }
    throw error;
  }
}

export async function contentPage<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof z.ZodError) notFound();
    if (error instanceof AccessError) {
      if (error.status === 401) redirect("/login");
      if ([403, 404].includes(error.status)) notFound();
    }
    throw error;
  }
}
