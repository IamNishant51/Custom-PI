import { THEME } from "../theme/theme";
import { hexToRgb, rgbToHex } from "../utils/color";
import { fg } from "../theme/colorize";

const BANNER = [
  "  ██████╗ ██╗   ██╗ ██████╗ ████████╗ ██████╗ ███╗   ███╗      ██████╗ ██╗",
  " ██╔════╝ ██║   ██║██╔════╝ ╚══██╔══╝██╔═══██╗████╗ ████║      ██╔══██╗██║",
  " ██║      ██║   ██║╚██████╗    ██║   ██║   ██║██╔████╔██║█████╗██████╔╝██║",
  " ██║      ██║   ██║ ╚═══██║    ██║   ██║   ██║██║╚██╔╝██║╚════╝██╔═══╝ ██║",
  " ╚██████╗ ╚██████╔╝██████╔╝    ██║   ╚██████╔╝██║ ╚═╝ ██║      ██║     ██║",
  "  ╚═════╝  ╚═════╝ ╚═════╝     ╚═╝    ╚═════╝ ╚═╝     ╚═╝      ╚═╝     ╚═╝",
];

function interpolateColors(colors: string[], steps: number): string[] {
  if (colors.length >= steps) return colors.slice(0, steps);
  const result: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps > 1 ? i / (steps - 1) : 0;
    const segIdx = Math.min(Math.floor(t * (colors.length - 1)), colors.length - 2);
    const segT = (t * (colors.length - 1)) - segIdx;
    const c1 = hexToRgb(colors[segIdx]);
    const c2 = hexToRgb(colors[Math.min(segIdx + 1, colors.length - 1)]);
    const mixed: [number, number, number] = [
      Math.round(c1[0] + (c2[0] - c1[0]) * segT),
      Math.round(c1[1] + (c2[1] - c1[1]) * segT),
      Math.round(c1[2] + (c2[2] - c1[2]) * segT),
    ];
    result.push(rgbToHex(...mixed));
  }
  return result;
}

export class BannerHeader {
  private _disposed = false;

  render(width: number): string[] {
    if (this._disposed) return [];
    const lines: string[] = [];
    if (width < 60) {
      lines.push("\u2756 Custom-PI  \u2500\u2500  terminal agent");
      return lines;
    }

    const bannerColors = interpolateColors(THEME.banner, BANNER.length);
    for (let i = 0; i < BANNER.length; i++) {
      const color = bannerColors[i] || bannerColors[bannerColors.length - 1];
      lines.push(fg(color, BANNER[i]));
    }

    const frame = Math.floor(Date.now() / 100);
    if (frame > 0) {
      const shimmerT = (Math.sin(frame * 0.05) * 0.5 + 0.5);
      const shimmerX = Math.floor(shimmerT * (BANNER[0].length - 10));
      for (let i = 0; i < BANNER.length; i++) {
        const ch = BANNER[i][shimmerX];
        if (ch && ch !== " ") {
          const line = lines[i];
          const colored = `\x1b[38;2;255;255;255m${ch}\x1b[0m`;
          lines[i] = line.slice(0, shimmerX) + colored + line.slice(shimmerX + 1);
        }
      }
    }

    return lines;
  }

  invalidate(): void {}
  dispose(): void { this._disposed = true; }
}
