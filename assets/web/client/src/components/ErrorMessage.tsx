export default function ErrorMessage({ content }: { content: string }) {
  return (
    <div className="msg msg-error stagger-item">
      <div className="msg-label">Error</div>
      <div className="msg-content">{content}</div>
    </div>
  );
}
