import { apiResult, readJson } from "@/server/http";
import { resetRecoveredPassword } from "@/server/services/account";

export async function POST(request: Request) {
  return apiResult(async () =>
    resetRecoveredPassword(await readJson(request, 2048)),
  );
}
