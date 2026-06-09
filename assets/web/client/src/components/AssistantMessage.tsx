import Markdown from "./Markdown";

export default function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="msg msg-assistant stagger-item">
      <div className="msg-label">Assistant</div>
      <Markdown content={content} />
    </div>
  );
}
