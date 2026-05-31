interface AsciiProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function AsciiChat({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[+]</span>;
}

export function AsciiDashboard({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[#]</span>;
}

export function AsciiVault({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[@]</span>;
}

export function AsciiBudget({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[$]</span>;
}

export function AsciiMemory({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[M]</span>;
}

export function AsciiWorkProducts({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[F]</span>;
}

export function AsciiAgents({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[A]</span>;
}

export function AsciiMCP({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[P]</span>;
}

export function AsciiSettings({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[*]</span>;
}

export function AsciiMenu({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 14 }}>[=]</span>;
}

export function AsciiLightning({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[!]</span>;
}

export function AsciiArrowRight({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>{">"}</span>;
}

export function AsciiSend({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 12 }}>{">"}</span>;
}

export function AsciiPlay({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>{">"}</span>;
}

export function AsciiCheck({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[x]</span>;
}

export function AsciiX({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[-]</span>;
}

export function AsciiPlus({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[+]</span>;
}

export function AsciiTrash({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[D]</span>;
}

export function AsciiEye({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[.]</span>;
}

export function AsciiRefresh({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[R]</span>;
}

export function AsciiTeams({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[T]</span>;
}

export function AsciiUsers({ className }: AsciiProps) {
  return <span className={className} style={{ fontFamily: "inherit", fontSize: 11 }}>[U]</span>;
}
