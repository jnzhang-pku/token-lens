const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { buildSummary } = require("./usageData");

app.setName("Token Lens");

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 190;

let widgetWindow = null;

function getTopCenterBounds() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const screenCenterX = bounds.x + bounds.width / 2;

  return {
    x: Math.round(screenCenterX - WINDOW_WIDTH / 2),
    y: bounds.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT
  };
}

function createMainWindow() {
  widgetWindow = new BrowserWindow({
    ...getTopCenterBounds(),
    title: "Token Lens",
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    roundedCorners: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: false
    }
  });

  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.setAlwaysOnTop(true, "screen-saver", 1);
  widgetWindow.setWindowButtonVisibility(false);
  widgetWindow.loadFile(path.join(__dirname, "..", "src", "index.html"));

  widgetWindow.once("ready-to-show", () => {
    widgetWindow.showInactive();
  });

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.hide();
    app.setActivationPolicy("accessory");
  }

  createMainWindow();

  ipcMain.handle("token-lens:get-usage-summary", async () => buildSummary());

  app.on("activate", () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
