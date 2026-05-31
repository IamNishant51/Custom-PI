import { useState, useEffect, useCallback } from "react";

interface Question {
  id: string;
  question: string;
  options?: string[];
}

interface QuestionModalProps {
  ws: WebSocket | null;
  onQuestionResolved?: () => void;
}

export default function QuestionModal({ ws, onQuestionResolved }: QuestionModalProps) {
  const [question, setQuestion] = useState<Question | null>(null);
  const [answer, setAnswer] = useState("");
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!ws) return;
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "user_question") {
          setQuestion({ id: data.id, question: data.question, options: data.options });
          setAnswer("");
          setAnswered(false);
        }
        if (data.type === "user_question_resolved") {
          if (question?.id === data.id) {
            setAnswered(true);
            setTimeout(() => setQuestion(null), 1500);
            onQuestionResolved?.();
          }
        }
      } catch {}
    };
    ws.addEventListener("message", handler);
    return () => ws.removeEventListener("message", handler);
  }, [ws, question?.id, onQuestionResolved]);

  const submit = useCallback(() => {
    if (!answer.trim() || !question || !ws) return;
    ws.send(JSON.stringify({ type: "user_answer", questionId: question.id, answer: answer.trim() }));
  }, [answer, question, ws]);

  const selectOption = useCallback((opt: string) => {
    if (!question || !ws) return;
    ws.send(JSON.stringify({ type: "user_answer", questionId: question.id, answer: opt }));
  }, [question, ws]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && question) {
      ws?.send(JSON.stringify({ type: "user_answer", questionId: question.id, answer: "(user dismissed)" }));
    }
  }, [submit, question, ws]);

  if (!question) return null;

  return (
    <div className="question-modal-overlay">
      <div className="question-modal" style={{
        background: "#1a1a2e",
        border: "1px solid rgba(124,58,237,0.3)",
        borderRadius: 8,
        padding: 20,
        maxWidth: 480,
        width: "90%",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        animation: "slideUp 0.2s ease",
      }}>
        <div className="question-modal-header" style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          fontSize: 11,
          fontFamily: "'Geist Mono', monospace",
          color: "#5ab0b0",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          <span style={{ fontSize: 14 }}>💭</span>
          <span>Agent Asks</span>
        </div>

        <div className="question-text" style={{
          fontSize: 14,
          color: "#e4e4e4",
          lineHeight: 1.5,
          marginBottom: 16,
          whiteSpace: "pre-wrap",
        }}>
          {question.question}
        </div>

        {question.options && question.options.length > 0 ? (
          <div className="question-options" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {question.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => selectOption(opt)}
                disabled={answered}
                style={{
                  padding: "8px 14px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 6,
                  color: "#e4e4e4",
                  cursor: "pointer",
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 12,
                  textAlign: "left",
                  transition: "all 0.15s",
                  opacity: answered ? 0.5 : 1,
                }}
                onMouseEnter={e => { if (!answered) e.currentTarget.style.background = "rgba(124,58,237,0.15)"; }}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <div className="question-input-row" style={{ display: "flex", gap: 8 }}>
            <textarea
              className="question-input"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your answer..."
              disabled={answered}
              autoFocus
              rows={2}
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#e4e4e4",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                resize: "none",
                outline: "none",
              }}
            />
            <button
              onClick={submit}
              disabled={!answer.trim() || answered}
              style={{
                padding: "8px 16px",
                background: answered ? "rgba(48,209,88,0.2)" : "rgba(124,58,237,0.8)",
                border: "none",
                borderRadius: 6,
                color: "#fff",
                cursor: "pointer",
                fontFamily: "'Geist Mono', monospace",
                fontSize: 12,
                fontWeight: 600,
                opacity: !answer.trim() || answered ? 0.5 : 1,
              }}
            >
              {answered ? "Sent ✓" : "Send"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
