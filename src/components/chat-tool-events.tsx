import { type AgentToolEvent, agentToolLabels } from "@/lib/chat-agent";

export function ChatToolEvents({ events }: { events: AgentToolEvent[] }) {
  const steps = [
    ...new Map(events.map((event) => [event.step, event])).values(),
  ];
  if (!steps.length) return null;
  return (
    <details className="chat-tool-events">
      <summary>자료 탐색 {steps.length}단계</summary>
      <ol>
        {steps.map((event) => (
          <li key={event.step}>
            <strong>{agentToolLabels[event.tool] ?? "자료 탐색"}</strong>
            <span>
              {event.status === "started" ? "확인 중…" : event.detail}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}
