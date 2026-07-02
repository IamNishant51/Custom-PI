import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  platform: process.platform,
  isElectron: true,

  onNotification: (callback: (title: string, body: string) => void) => {
    ipcRenderer.on("native-notification", (_event, title, body) => {
      callback(title, body);
    });
  },

  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
});
