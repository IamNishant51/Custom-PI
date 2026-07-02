interface ElectronAPI {
  getAppInfo: () => Promise<{ version: string; platform: string; electronMode: boolean }>;
  platform: string;
  isElectron: boolean;
  onNotification: (callback: (title: string, body: string) => void) => void;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
