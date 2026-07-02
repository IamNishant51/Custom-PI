import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { ChildProcess, spawn } from "child_process";
import { createTray } from "./tray";

const DEV_SERVER_URL = "http://localhost:4321";
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let apiServer: ChildProcess | null = null;

function getServerPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "..", "assets", "web", "web-server.mjs");
  }
  return path.join(process.resourcesPath, "assets", "web", "web-server.mjs");
}

function getClientDistPath(): string {
  if (isDev) {
    return path.join(__dirname, "..", "..", "assets", "web", "client", "dist");
  }
  return path.join(process.resourcesPath, "assets", "web", "client", "dist");
}

function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Server did not start within ${timeoutMs}ms`));
      }
      setTimeout(check, 300);
    };
    check();
  });
}

async function startApiServer(): Promise<void> {
  const serverPath = getServerPath();
  const clientDist = getClientDistPath();

  // Build web client if needed
  if (!fs.existsSync(path.join(clientDist, "index.html"))) {
    console.log("[Desktop] Building web client...");
    const clientDir = path.join(__dirname, "..", "..", "assets", "web", "client");
    spawn("npm", ["install"], { cwd: clientDir, stdio: "inherit", shell: true });
    spawn("npm", ["run", "build"], { cwd: clientDir, stdio: "inherit", shell: true });
  }

  apiServer = spawn("node", [serverPath], {
    env: {
      ...process.env,
      WEB_PORT: "4321",
      ELECTRON_MODE: "true",
      CLIENT_DIST: clientDist,
    },
    stdio: ["ignore", "inherit", "inherit"],
    shell: process.platform === "win32",
  });

  apiServer.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[Desktop] API server exited with code ${code}`);
    }
  });

  await waitForServer(`${DEV_SERVER_URL}/api/health`);
  console.log("[Desktop] API server ready");
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Custom-PI",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  mainWindow.loadURL(DEV_SERVER_URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await startApiServer();
  } catch (err) {
    console.error("[Desktop] Failed to start API server:", err);
    app.quit();
    return;
  }

  createMainWindow();
  createTray(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (apiServer) {
    apiServer.kill("SIGTERM");
    apiServer = null;
  }
});

ipcMain.handle("get-app-info", () => ({
  version: app.getVersion(),
  platform: process.platform,
  electronMode: true,
}));
