"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sourceCategories } from "@/lib/content";
import { DEFAULT_SOURCE_WATCH_CONFIG } from "@/lib/reference/source-watch-config";
import type { SourceWatchConfig } from "@/lib/reference/source-watch-types";
import {
  SOURCE_ACCEPT,
  SOURCE_FORMATS,
  safeRelativePath,
} from "@/lib/source-formats";
import {
  isImportImage,
  isPathAllowedForImport,
} from "@/lib/source-import-files";

type Collection = {
  id: string;
  label: string;
  mode: "upload" | "watch";
  rootKey: string | null;
  domainId: string;
  projectId: string | null;
  category: string;
  enabled: boolean;
  intervalMinutes: number;
  config: SourceWatchConfig;
  state: string;
  errorMessage: string | null;
  lastScanAt: string | null;
};
type ImportedFile = {
  relativePath: string;
  sourceId: string;
  versionId: string;
  missing: boolean;
};
export function SourceImportWorkspace({
  workspaceId,
  domains,
  projects,
}: {
  workspaceId: string;
  domains: { id: string; name: string }[];
  projects: { id: string; name: string; domainId: string }[];
}) {
  const id = useId(),
    base = `/api/workspaces/${workspaceId}`;
  const [items, setItems] = useState<Collection[]>([]),
    [roots, setRoots] = useState<{ key: string; label: string }[]>([]);
  const [selected, setSelected] = useState<Collection | null>(null),
    [records, setRecords] = useState<ImportedFile[]>([]);
  const [mode, setMode] = useState<"upload" | "watch">("upload"),
    [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  const [results, setResults] = useState<
    { path: string; message: string; sourceId?: string }[]
  >([]);
  const [webUrls, setWebUrls] = useState("");
  const stop = useRef(false);
  async function json(path: string, init?: RequestInit) {
    const response = await fetch(path, init);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }
  async function refresh() {
    const data = await json(`${base}/source-imports`);
    setItems(data.items);
    setRoots(data.roots);
  }
  async function select(value: string) {
    if (value === "new") {
      setSelected(null);
      setRecords([]);
      setFiles([]);
      return;
    }
    try {
      const data = await json(`${base}/source-imports/${value}`);
      setSelected(data.item);
      setRecords(data.files);
      setMode(data.item.mode);
      setDomainId(data.item.domainId);
      setFiles([]);
      setResults([]);
    } catch (error) {
      setMessage((error as Error).message);
    }
  }
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`${base}/source-imports`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) {
          setItems(data.items);
          setRoots(data.roots);
        }
      } catch (e) {
        if (active) setMessage((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base]);
  const current = items.find((item) => item.id === selected?.id) ?? selected;
  return (
    <div className="form-stack">
      <Field>
        <FieldLabel htmlFor={`${id}-existing`}>가져오기 기록</FieldLabel>
        <Select
          value={selected?.id ?? "new"}
          onValueChange={select}
          disabled={pending}
        >
          <SelectTrigger id={`${id}-existing`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">새 가져오기</SelectItem>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.label} ·{" "}
                {item.mode === "watch" ? "서버 폴더" : "파일·폴더"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <form
        key={selected?.id ?? "new"}
        className="form-stack panel"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          stop.current = false;
          setPending(true);
          setMessage("");
          setResults([]);
          try {
            const split = (key: string) =>
              String(data.get(key) ?? "")
                .split(/[,\n]/)
                .map((p) => p.trim())
                .filter(Boolean);
            const config = {
              includeExtensions: split("includeExtensions"),
              excludeExtensions: split("excludeExtensions"),
              excludeDirs: split("excludeDirs"),
              excludeGlobs: split("excludeGlobs"),
              maxFileSizeMb: Number(data.get("maxFileSizeMb")),
            };
            const collection = await json(`${base}/source-imports`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(selected ? { id: selected.id } : {}),
                label: data.get("label"),
                domainId,
                projectId:
                  data.get("projectId") === "common"
                    ? null
                    : data.get("projectId"),
                category: data.get("category"),
                mode,
                rootKey: mode === "watch" ? data.get("rootKey") : null,
                enabled: data.get("enabled") === "on",
                intervalMinutes: Number(data.get("intervalMinutes") ?? 5),
                config,
              }),
            });
            setSelected(collection);
            if (mode === "upload")
              for (const file of [...files].sort(
                (a, b) =>
                  Number(isImportImage(b.name)) - Number(isImportImage(a.name)),
              )) {
                if (stop.current) break;
                const path = safeRelativePath(
                  file.webkitRelativePath || file.name,
                );
                if (
                  !path ||
                  !SOURCE_FORMATS[
                    file.name.split(".").at(-1)?.toLowerCase() ?? ""
                  ] ||
                  !isPathAllowedForImport(path, collection.config) ||
                  file.size > config.maxFileSizeMb * 1024 * 1024
                ) {
                  setResults((old) => [
                    ...old,
                    {
                      path: path ?? file.name,
                      message: "형식·제외 규칙·크기 설정에 따라 건너뜀",
                    },
                  ]);
                  continue;
                }
                const form = new FormData();
                form.set("file", file);
                form.set("relativePath", path);
                form.set("importId", collection.id);
                form.set(
                  "title",
                  file.name.replace(/\.[^.]+$/, "").slice(0, 160) || file.name,
                );
                form.set("domainId", collection.domainId);
                form.set("projectId", collection.projectId ?? "");
                form.set("category", collection.category);
                try {
                  const result = await json(`${base}/sources`, {
                    method: "POST",
                    body: form,
                  });
                  setResults((old) => [
                    ...old,
                    {
                      path,
                      message: result.duplicate
                        ? "내용이 같아 기존 버전 유지"
                        : "새 버전 등록 · 처리 대기",
                      sourceId: result.sourceId,
                    },
                  ]);
                } catch (error) {
                  setResults((old) => [
                    ...old,
                    { path, message: (error as Error).message },
                  ]);
                }
              }
            if (mode === "upload")
              for (const url of Array.from(
                new Set(
                  webUrls
                    .split(/\n/)
                    .map((u) => u.trim())
                    .filter(Boolean),
                ),
              )) {
                if (stop.current) break;
                try {
                  const result = await json(`${base}/web-imports`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ importId: collection.id, url }),
                  });
                  setResults((old) => [
                    ...old,
                    {
                      path: url,
                      message: result.duplicate
                        ? "내용이 같아 기존 버전 유지"
                        : "웹 원문 등록 · 처리 대기",
                      sourceId: result.sourceId,
                    },
                  ]);
                } catch (error) {
                  setResults((old) => [
                    ...old,
                    { path: url, message: (error as Error).message },
                  ]);
                }
              }
            const detail = await json(
              `${base}/source-imports/${collection.id}`,
            );
            setRecords(detail.files);
            setMessage(
              stop.current
                ? "다음 파일부터 등록을 중지했습니다. 완료한 파일은 기록에 남아 있습니다."
                : mode === "watch"
                  ? "폴더 연결 설정을 저장했습니다."
                  : "선택한 파일의 등록 결과를 확인해 주세요.",
            );
            await refresh();
          } catch (error) {
            setMessage((error as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <FieldSet disabled={pending} inert={pending}>
          <div className="field-grid">
            <Field>
              <FieldLabel htmlFor={`${id}-label`}>가져오기 이름</FieldLabel>
              <Input
                id={`${id}-label`}
                name="label"
                required
                maxLength={120}
                defaultValue={selected?.label}
                placeholder="예: 운영팀 공유 자료"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-mode`}>가져오기 방식</FieldLabel>
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as typeof mode)}
                disabled={!!selected}
              >
                <SelectTrigger id={`${id}-mode`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="upload">내 컴퓨터의 파일·폴더</SelectItem>
                  <SelectItem value="watch">
                    서버에 연결한 폴더 정기 감지
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="field-grid">
            <Field>
              <FieldLabel htmlFor={`${id}-domain`}>업무 도메인</FieldLabel>
              <Select
                name="domainId"
                value={domainId}
                onValueChange={setDomainId}
                disabled={!!selected}
              >
                <SelectTrigger id={`${id}-domain`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {domains.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-project`}>프로젝트</FieldLabel>
              <Select
                key={domainId}
                name="projectId"
                defaultValue={selected?.projectId ?? "common"}
                disabled={!!selected}
              >
                <SelectTrigger id={`${id}-project`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="common">도메인 공통</SelectItem>
                  {projects
                    .filter((p) => p.domainId === domainId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-category`}>자료 분류</FieldLabel>
              <Select
                name="category"
                defaultValue={selected?.category ?? "reference"}
                disabled={!!selected}
              >
                <SelectTrigger id={`${id}-category`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(sourceCategories)
                    .filter(([key]) => key !== "testimony")
                    .map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {selected && (
            <>
              <Input
                type="hidden"
                name="projectId"
                value={selected.projectId ?? "common"}
              />
              <Input type="hidden" name="category" value={selected.category} />
            </>
          )}
          {mode === "watch" ? (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-root`}>연결된 서버 폴더</FieldLabel>
                <Select
                  name="rootKey"
                  defaultValue={selected?.rootKey ?? roots[0]?.key}
                  disabled={!!selected}
                >
                  <SelectTrigger id={`${id}-root`}>
                    <SelectValue placeholder="연결된 폴더가 없습니다" />
                  </SelectTrigger>
                  <SelectContent>
                    {roots.map((root) => (
                      <SelectItem key={root.key} value={root.key}>
                        {root.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selected?.rootKey && (
                  <Input
                    type="hidden"
                    name="rootKey"
                    value={selected.rootKey}
                  />
                )}
                <FieldDescription>
                  관리자가 이 작업공간에 연결한 폴더만 표시합니다. 브라우저를
                  닫아도 감지는 계속됩니다.
                </FieldDescription>
              </Field>
              <div className="field-grid">
                <Field>
                  <FieldLabel htmlFor={`${id}-interval`}>
                    감지 주기 (분)
                  </FieldLabel>
                  <Input
                    id={`${id}-interval`}
                    name="intervalMinutes"
                    type="number"
                    min={1}
                    max={1440}
                    defaultValue={selected?.intervalMinutes ?? 5}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id={`${id}-enabled`}
                    name="enabled"
                    defaultChecked={selected?.enabled ?? true}
                  />
                  <FieldLabel htmlFor={`${id}-enabled`}>
                    정기 감지 사용
                  </FieldLabel>
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-files`}>여러 파일 선택</FieldLabel>
                <Input
                  id={`${id}-files`}
                  type="file"
                  multiple
                  accept={SOURCE_ACCEPT}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-folder`}>폴더 선택</FieldLabel>
                <Input
                  id={`${id}-folder`}
                  type="file"
                  multiple
                  ref={(node) => {
                    node?.setAttribute("webkitdirectory", "");
                  }}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
                <FieldDescription>
                  하위 폴더 경로를 보존합니다. 같은 기록에서 폴더를 다시
                  선택하면 변경된 파일만 새 버전으로 등록합니다.
                </FieldDescription>
              </Field>
              <output>선택한 파일 {files.length}개</output>
              <Field>
                <FieldLabel htmlFor={`${id}-urls`}>웹 주소 여러 개</FieldLabel>
                <Textarea
                  id={`${id}-urls`}
                  rows={4}
                  value={webUrls}
                  onChange={(e) => setWebUrls(e.target.value)}
                  placeholder="https://example.org/guide
https://example.org/report.pdf"
                />
                <FieldDescription>
                  공개 웹 주소를 한 줄에 하나씩 입력해 주세요. 각 주소의 원본과
                  수집 위치를 보관하며, 실패한 주소는 결과에서 확인할 수
                  있습니다.
                </FieldDescription>
              </Field>
            </>
          )}
          <details>
            <summary>파일 포함·제외 규칙</summary>
            <div className="form-stack">
              {(
                [
                  ["includeExtensions", "포함 확장자 (비우면 지원 형식 전체)"],
                  ["excludeExtensions", "제외 확장자"],
                  ["excludeDirs", "제외 폴더"],
                  ["excludeGlobs", "제외 파일 패턴 (*, ?)"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                  <Textarea
                    id={`${id}-${key}`}
                    name={key}
                    rows={2}
                    defaultValue={(
                      selected?.config[key] ?? DEFAULT_SOURCE_WATCH_CONFIG[key]
                    ).join(", ")}
                  />
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor={`${id}-max`}>
                  파일당 최대 크기 (MiB)
                </FieldLabel>
                <Input
                  id={`${id}-max`}
                  name="maxFileSizeMb"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={selected?.config.maxFileSizeMb ?? 100}
                />
              </Field>
            </div>
          </details>
          <p className="field-help">
            원문을 보관하고 내용을 추출한 뒤 공개 검토를 기다립니다. 새 버전
            승인 후 위키 자동 생성은 도메인의 자동 수집 설정을 따릅니다.
          </p>
          <Button
            type="submit"
            disabled={!domains.length || (mode === "watch" && !roots.length)}
          >
            {pending
              ? "등록 중…"
              : mode === "watch"
                ? "폴더 연결 저장"
                : files.length || webUrls.trim()
                  ? webUrls.trim()
                    ? "자료 등록 시작"
                    : "파일 등록 시작"
                  : "가져오기 기록 저장"}
          </Button>
        </FieldSet>
        {pending && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop.current = true;
            }}
          >
            현재 파일 이후 중지
          </Button>
        )}
      </form>
      {message && <output>{message}</output>}
      {current?.mode === "watch" && (
        <div className="panel form-stack">
          <p>
            감지 상태:{" "}
            {current.state === "scanning"
              ? "파일 확인 중"
              : current.enabled
                ? "다음 감지 대기"
                : "중지"}
            {current.lastScanAt
              ? ` · 최근 감지 ${new Date(current.lastScanAt).toLocaleString("ko-KR")}`
              : ""}
          </p>
          {current.errorMessage && (
            <p role="alert" className="form-error">
              {current.errorMessage}
            </p>
          )}
          <div className="form-actions">
            {[
              ["scan", "지금 감지"],
              [
                current.enabled ? "pause" : "resume",
                current.enabled ? "감지 중지" : "감지 재개",
              ],
            ].map(([action, label]) => (
              <Button
                type="button"
                variant="outline"
                key={action}
                disabled={pending}
                onClick={async () => {
                  try {
                    await json(`${base}/source-imports/${current.id}/action`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action }),
                    });
                    await refresh();
                    const detail = await json(
                      `${base}/source-imports/${current.id}`,
                    );
                    setRecords(detail.files);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {!!results.length && (
        <div className="content-list">
          {results.map((result, i) => (
            <div className="panel" key={`${i}:${result.path}`}>
              <p>{result.path}</p>
              <p>
                {result.message}
                {result.sourceId && (
                  <>
                    {" "}
                    ·{" "}
                    <Link href={`/w/${workspaceId}/sources/${result.sourceId}`}>
                      자료 열기
                    </Link>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      )}
      {!!records.length && (
        <div className="panel">
          <h2>가져온 파일 {records.length}개</h2>
          {records.map((record) => (
            <p key={record.relativePath}>
              <Link href={`/w/${workspaceId}/sources/${record.sourceId}`}>
                {record.relativePath}
              </Link>
              {record.missing && (
                <>
                  {" "}
                  · 폴더에서 삭제되거나 제외됨 ·{" "}
                  <Link
                    href={`/w/${workspaceId}/sources/${record.sourceId}/impact`}
                  >
                    삭제 영향 확인
                  </Link>
                </>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
