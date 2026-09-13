import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { deployment, literal } from "./lib/deployment.mjs";

const [command, profile, ...args] = process.argv.slice(2);
try {
  if (command === "setup") {
    if (!/^wiki-[a-z0-9][a-z0-9-]{1,40}$/.test(profile ?? ""))
      throw new Error("wiki-로 시작하는 배포 프로필이 필요합니다.");
    const [portText, origin, email, image, workspaceName] = args;
    const port = Number(portText);
    if (
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      !origin ||
      !email?.includes("@") ||
      !image ||
      !workspaceName
    )
      throw new Error(
        "사용법: setup 프로필 포트 서비스주소 관리자메일 이미지 작업공간이름",
      );
    const url = new URL(origin);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)
        )) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error(
        "서비스 기본 주소를 확인하세요. 운영 주소는 HTTPS가 필요합니다.",
      );
    const folder = resolve(".local/deploy", profile);
    const file = resolve(folder, "runtime.env");
    if (existsSync(file))
      throw new Error("기존 설정을 유지합니다. 다른 프로필을 사용하세요.");
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const password = randomBytes(32).toString("hex");
    const values = {
      HTTP_PORT: String(port),
      APP_IMAGE: image,
      POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
      APP_DB_PASSWORD: password,
      DATABASE_URL: `postgresql://domain_wiki:${password}@db:5432/domain_wiki`,
      BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
      BETTER_AUTH_URL: url.origin,
      AI_BASE_URL: "",
      AI_MODEL: "",
      AI_API_KEY: "",
      AI_CHAT_BASE_URL: "",
      AI_CHAT_MODEL: "",
      AI_CHAT_API_KEY: "",
      AI_KNOWLEDGE_BASE_URL: "",
      AI_KNOWLEDGE_MODEL: "",
      AI_KNOWLEDGE_API_KEY: "",
      AI_CHAT_CONTEXT_CHARS: "120000",
      AI_KNOWLEDGE_CONTEXT_CHARS: "48000",
      AI_TASK_LEASE_SECONDS: "30",
      JOB_LEASE_SECONDS: "120",
      AI_INCLUDE_USAGE: "true",
      AI_EMBEDDING_MODEL: "",
      AI_EMBEDDING_BASE_URL: "",
      AI_EMBEDDING_API_KEY: "",
      AI_TIMEOUT_SECONDS: "90",
      AI_MAX_CONCURRENT: "3",
    };
    for (const value of Object.values(values))
      if (/[\r\n'"$#]/.test(value))
        throw new Error("환경 변수에 지원하지 않는 문자가 있습니다.");
    writeFileSync(
      file,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { mode: 0o600, flag: "wx" },
    );
    writeFileSync(
      resolve(folder, "initial-admin.json"),
      JSON.stringify(
        {
          email,
          password: randomBytes(24).toString("base64url"),
          name: "초기 관리자",
          workspaceName,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      `배포 설정과 초기 관리자 정보 저장: .local/deploy/${profile}/ (비밀값은 출력하지 않습니다.)`,
    );
  } else {
    const target = deployment(profile);
    const { compose, sql, env } = target;
    if (command === "init") {
      compose(["up", "-d", "--wait", "db"]);
      if (
        sql(
          "SELECT count(*) FROM pg_roles WHERE rolname='domain_wiki'",
          "postgres",
        ) === "0"
      )
        sql(
          `CREATE ROLE domain_wiki LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${literal(env.APP_DB_PASSWORD)}`,
          "postgres",
        );
      if (
        sql(
          "SELECT count(*) FROM pg_database WHERE datname='domain_wiki'",
          "postgres",
        ) === "0"
      )
        sql("CREATE DATABASE domain_wiki OWNER domain_wiki", "postgres");
      sql("CREATE EXTENSION IF NOT EXISTS vector");
      compose(["run", "--rm", "--no-deps", "-T", "maintenance"]);
      console.log("전용 DB·일반 접속 계정·스키마 준비 완료");
    } else if (command === "bootstrap") {
      const result = compose(
        [
          "run",
          "--rm",
          "--no-deps",
          "-T",
          "maintenance",
          "node",
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/bootstrap-production.ts",
        ],
        { input: readFileSync(resolve(target.folder, "initial-admin.json")) },
      );
      writeFileSync(resolve(target.folder, "workspace.json"), result, {
        mode: 0o600,
        flag: "wx",
      });
      console.log("초기 관리자와 작업공간 생성 완료");
    } else if (command === "up") {
      compose(["up", "-d", "--wait", "web", "worker"]);
      console.log(`서비스 시작 완료: ${env.BETTER_AUTH_URL}`);
    } else if (command === "stop") {
      compose(["stop", "web", "worker"]);
      console.log("웹과 작업자를 중지했습니다. DB와 저장소는 유지합니다.");
    } else if (command === "status") {
      console.log(compose(["ps", "--format", "table"]));
    } else if (command === "image") {
      const image = args[0];
      if (!image || /[\s'"$#]/.test(image))
        throw new Error("사용할 고정 이미지 태그나 digest가 필요합니다.");
      const before = readFileSync(target.file, "utf8");
      writeFileSync(
        resolve(target.folder, `runtime-${Date.now()}.env`),
        before,
        { mode: 0o600, flag: "wx" },
      );
      writeFileSync(
        target.file,
        before.replace(/^APP_IMAGE=.*$/m, `APP_IMAGE=${image}`),
      );
      chmodSync(target.file, 0o600);
      console.log(
        "배포 이미지를 변경했습니다. 스키마 호환성을 확인한 후 up을 실행하세요.",
      );
    } else
      throw new Error(
        "사용법: node scripts/deploy.mjs setup|init|bootstrap|up|stop|status|image wiki-프로필 ...",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
