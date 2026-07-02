import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";

let tray: Tray | null = null;

function getIconPath(): string {
  const isDev = !app.isPackaged;
  if (isDev) {
    const p = path.join(__dirname, "..", "assets", "tray-icon.png");
    if (fs.existsSync(p)) return p;
  }
  const p = path.join(process.resourcesPath, "assets", "tray-icon.png");
  if (fs.existsSync(p)) return p;
  return "";
}

export function createTray(mainWindow: BrowserWindow | null): void {
  const iconPath = getIconPath();
  const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip("Custom-PI");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Custom-PI",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Launch TUI",
      click: () => {
        const cliPath = path.join(__dirname, "..", "..", "bin", "cli.js");
        spawn(process.execPath, [cliPath], {
          stdio: "inherit",
          shell: process.platform === "win32",
          detached: true,
        });
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
