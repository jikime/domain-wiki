"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { safeMarkdownImageSrc } from "@/lib/markdown-image";

export function MarkdownImage({
  src,
  alt = "",
}: {
  src?: string;
  alt?: string;
}) {
  const url = src ? safeMarkdownImageSrc(src) : "";
  const [failed, setFailed] = useState(false);
  if (!url)
    return (
      <span className="markdown-image-error">이미지 주소를 확인해 주세요.</span>
    );
  return (
    <span className="markdown-image">
      <Dialog>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="markdown-image-button"
            aria-label={`${alt || "문서 이미지"} 확대`}
          >
            {/* biome-ignore lint/performance/noImgElement: Source images use protected URLs and must preserve the original bitmap. */}
            <img
              src={url}
              alt={alt}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
            />
          </Button>
        </DialogTrigger>
        <DialogContent className="markdown-media-dialog">
          <DialogHeader>
            <DialogTitle>{alt || "문서 이미지"}</DialogTitle>
            <DialogDescription>
              원본 크기의 이미지를 확인합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="markdown-image-expanded">
            {/* biome-ignore lint/performance/noImgElement: Display the original protected image without transformation. */}
            <img src={url} alt={alt} referrerPolicy="no-referrer" />
          </div>
        </DialogContent>
      </Dialog>
      {failed && (
        <span className="markdown-image-error">
          이미지를 불러오지 못했습니다.
        </span>
      )}
    </span>
  );
}

// Adapted from llm_wiki components/mermaid-diagram.tsx: visibility-triggered
// rendering, strict Mermaid mode, cache, error card and zoom preview.
const diagrams = new Map<string, string>();
let renderQueue: Promise<unknown> = Promise.resolve();
export function MermaidDiagram({ code }: { code: string }) {
  const host = useRef<HTMLDivElement>(null),
    id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [visible, setVisible] = useState(false),
    [svg, setSvg] = useState(""),
    [error, setError] = useState("");
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setError("");
    setSvg("");
    const render = async () => {
      if (cancelled) return;
      if (diagrams.has(code)) {
        setSvg(diagrams.get(code) as string);
        return;
      }
      const renderHost = document.createElement("div");
      renderHost.className = "mermaid-render-host";
      host.current?.appendChild(renderHost);
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "strict",
          suppressErrorRendering: true,
          maxTextSize: 100000,
        });
        mermaid.setParseErrorHandler(() => {});
        const { svg: result } = await mermaid.render(
          `mermaid-${id}`,
          code,
          renderHost,
        );
        if (!cancelled) {
          if (diagrams.size >= 40)
            diagrams.delete(diagrams.keys().next().value as string);
          diagrams.set(code, result);
          setSvg(result);
        }
      } catch {
        if (!cancelled) setError("다이어그램 문법을 확인해 주세요.");
      } finally {
        renderHost.remove();
      }
    };
    renderQueue = renderQueue.then(render, render);
    return () => {
      cancelled = true;
    };
  }, [visible, code, id]);
  return (
    <div className="markdown-diagram" ref={host}>
      {error ? (
        <div className="notice-box">
          <output>{error}</output>
          <details>
            <summary>다이어그램 코드 보기</summary>
            <pre>{code}</pre>
          </details>
        </div>
      ) : svg ? (
        <>
          <div
            className="mermaid-svg"
            role="img"
            aria-label="Mermaid 다이어그램"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid strict mode sanitizes this SVG.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <Dialog onOpenChange={() => setScale(1)}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                다이어그램 확대
              </Button>
            </DialogTrigger>
            <DialogContent className="markdown-media-dialog">
              <DialogHeader>
                <DialogTitle>다이어그램</DialogTitle>
                <DialogDescription>
                  확대하거나 축소해 내용을 확인하세요.
                </DialogDescription>
              </DialogHeader>
              <div className="form-actions">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScale((s) => Math.max(0.3, s - 0.25))}
                >
                  축소
                </Button>
                <output>{Math.round(scale * 100)}%</output>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setScale((s) => Math.min(5, s + 0.25))}
                >
                  확대
                </Button>
              </div>
              <div className="markdown-diagram-expanded">
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                  }}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid strict mode sanitizes this SVG.
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <output>다이어그램을 준비하고 있습니다…</output>
      )}
    </div>
  );
}
