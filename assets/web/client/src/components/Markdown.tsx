import { useMemo } from "react";
import { marked } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export default function Markdown({ content, className }: { content: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return marked.parse(content);
    } catch {
      return content;
    }
  }, [content]);

  return <div className={`markdown-content ${className || ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
