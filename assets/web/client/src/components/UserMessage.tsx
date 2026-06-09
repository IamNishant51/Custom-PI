export default function UserMessage({
  content,
  attachments,
  onBubbleClick
}: {
  content: string;
  attachments?: any[];
  onBubbleClick?: () => void;
}) {
  return (
    <div
      className={`msg msg-user stagger-item ${onBubbleClick ? "clickable-bubble" : ""}`}
      onClick={onBubbleClick}
      style={{ cursor: onBubbleClick ? "pointer" : "default" }}
    >
      <div className="msg-label">You</div>
      {attachments && attachments.length > 0 && (
        <div className="msg-user-attachments">
          {attachments.map((att, i) => (
            <div key={i} className="msg-user-attachment-chip">
              {att.previewUrl ? (
                <img src={att.previewUrl} className="msg-user-attachment-img" />
              ) : (
                <span className="msg-user-attachment-file">📄 {att.name}</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="msg-content">{content}</div>
    </div>
  );
}
