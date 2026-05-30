import { useMemo } from "react";
import { marked } from "marked";

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const renderer = new marked.Renderer();

renderer.code = function (tokenOrCode: any, langOrInfostring?: string) {
  let text = "";
  let lang = "";
  if (typeof tokenOrCode === "object" && tokenOrCode !== null) {
    text = tokenOrCode.text;
    lang = tokenOrCode.lang || "";
  } else {
    text = tokenOrCode;
    lang = langOrInfostring || "";
  }

  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  // Detect if it's a diff or if lang is explicitly 'diff'
  const isDiff = lang === "diff" || text.startsWith("---") || text.includes("\n+ ") || text.includes("\n- ");

  if (isDiff) {
    const formattedLines = lines.map((line, idx) => {
      let lineClass = "";
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineClass = "diff-line-added";
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        lineClass = "diff-line-removed";
      } else if (line.startsWith("@@")) {
        lineClass = "diff-line-info";
      }
      return `<div class="diff-line ${lineClass}"><span class="line-number">${idx + 1}</span><span class="line-content">${escapeHtml(line)}</span></div>`;
    }).join("");

    return `
      <div class="code-block-container diff-block-container">
        <div class="code-block-header">
          <span class="code-block-lang">diff</span>
          <button class="copy-btn">Copy</button>
        </div>
        <div class="code-block-scroll">
          <pre class="diff-pre"><code>${formattedLines}</code></pre>
        </div>
      </div>
    `;
  } else {
    const formattedLines = lines.map((line, idx) => {
      return `<div class="code-line"><span class="line-number">${idx + 1}</span><span class="line-content">${escapeHtml(line)}</span></div>`;
    }).join("");

    return `
      <div class="code-block-container">
        <div class="code-block-header">
          <span class="code-block-lang">${lang || "code"}</span>
          <button class="copy-btn">Copy</button>
        </div>
        <div class="code-block-scroll">
          <pre><code>${formattedLines}</code></pre>
        </div>
      </div>
    `;
  }
};

marked.use({ renderer });

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
