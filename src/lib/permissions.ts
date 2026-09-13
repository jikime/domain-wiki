export type WorkRole = "reader" | "writer" | "reviewer";
export function effectiveRole(role: WorkRole, isAdmin: boolean): WorkRole {
  return isAdmin ? "reviewer" : role;
}
export function includedRoles(role: WorkRole, isAdmin = false): WorkRole[] {
  const effective = effectiveRole(role, isAdmin);
  return effective === "reviewer"
    ? ["reader", "writer", "reviewer"]
    : effective === "writer"
      ? ["reader", "writer"]
      : ["reader"];
}
export function highestRole(roles: WorkRole[]): WorkRole {
  return roles.includes("reviewer")
    ? "reviewer"
    : roles.includes("writer")
      ? "writer"
      : "reader";
}
