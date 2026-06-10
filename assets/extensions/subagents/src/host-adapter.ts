import { visibleWidth, CURSOR_MARKER } from "@earendil-works/pi-tui";

export interface HostTUIAdapter {
  visibleWidth(text: string): number;
  cursorMarker(): string;
}

let _adapter: HostTUIAdapter | null = null;

export function getHostAdapter(): HostTUIAdapter {
  if (!_adapter) {
    _adapter = new PiCodingAgentAdapter();
  }
  return _adapter;
}

export function setHostAdapter(adapter: HostTUIAdapter): void {
  _adapter = adapter;
}

export class PiCodingAgentAdapter implements HostTUIAdapter {
  visibleWidth(text: string): number {
    return visibleWidth(text);
  }

  cursorMarker(): string {
    return CURSOR_MARKER;
  }
}
