import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const password = randomBytes(24).toString("hex");
const content = `DATABASE_URL=postgresql://domain_wiki:${password}@127.0.0.1:55433/domain_wiki
TEST_DATABASE_URL=postgresql://domain_wiki:${password}@127.0.0.1:55433/domain_wiki_test
POSTGRES_PASSWORD=${randomBytes(24).toString("hex")}
APP_DB_PASSWORD=${password}
DB_PORT=55433
BETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}
BETTER_AUTH_URL=http://localhost:3010
AI_TRANSPORT=claude-code
AI_BASE_URL=
AI_MODEL=sonnet
AI_API_KEY=
ORIGINALS_DIR=.local/originals
JOB_LEASE_SECONDS=120
`;
try {
  writeFileSync(".env.local", content, { flag: "wx", mode: 0o600 });
  console.log(".env.local 생성 완료. 비밀 값은 화면에 출력하지 않습니다.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("기존 .env.local을 유지했습니다.");
}
