const path = require("path");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { buildSummary } = require("./usageData");

app.setName("Token Lens");

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 190;
const HANDLE_HEIGHT = 10;
const HANDLE_WIDTH = 126;
const HOVER_PADDING = 6;
const PANEL_TOP = 18;
const PANEL_HEIGHT = 168;
const CLOSE_DELAY_MS = 350;
const CURSOR_POLL_MS = 50;

let widgetWindow = null;
let panelOpen = false;
let closeTimer = null;
let cursorPollTimer = null;
let mouseEventsIgnored = false;

function getTopCenterBounds() {
  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const workArea = display.workArea;
  const screenCenterX = bounds.x + bounds.width / 2;
  const menuBarHeight = Math.max(0, workArea.y - bounds.y);
  const centeredMenuBarY =
    menuBarHeight > HANDLE_HEIGHT ? bounds.y + Math.round((menuBarHeight - HANDLE_HEIGHT) / 2) : workArea.y;

  return {
    x: Math.round(screenCenterX - WINDOW_WIDTH / 2),
    y: centeredMenuBarY,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT
  };
}

function pointInRect(point, rect) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function getHandleRect(bounds) {
  return {
    x: bounds.x + Math.round((WINDOW_WIDTH - HANDLE_WIDTH) / 2) - HOVER_PADDING,
    y: bounds.y - HOVER_PADDING,
    width: HANDLE_WIDTH + HOVER_PADDING * 2,
    height: HANDLE_HEIGHT + HOVER_PADDING * 2
  };
}

function getPanelRect(bounds) {
  return {
    x: bounds.x,
    y: bounds.y + PANEL_TOP,
    width: WINDOW_WIDTH,
    height: PANEL_HEIGHT
  };
}

function setMouseEventsIgnored(nextIgnored) {
  if (!widgetWindow || widgetWindow.isDestroyed() || mouseEventsIgnored === nextIgnored) return;
  mouseEventsIgnored = nextIgnored;
  widgetWindow.setIgnoreMouseEvents(nextIgnored, { forward: true });
}

function sendOpenState(nextOpen) {
  if (!widgetWindow || widgetWindow.isDestroyed() || panelOpen === nextOpen) return;
  panelOpen = nextOpen;
  widgetWindow.webContents.send("token-lens:open-state", nextOpen);
}

function scheduleClose() {
  if (closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    sendOpenState(false);
  }, CLOSE_DELAY_MS);
}

function cancelClose() {
  if (!closeTimer) return;
  clearTimeout(closeTimer);
  closeTimer = null;
}

function updatePointerState() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;

  const point = screen.getCursorScreenPoint();
  const bounds = widgetWindow.getBounds();
  const overHandle = pointInRect(point, getHandleRect(bounds));
  const overPanel = pointInRect(point, getPanelRect(bounds));
  const shouldOwnMouse = panelOpen ? overPanel || overHandle : overHandle;

  setMouseEventsIgnored(!shouldOwnMouse);

  if (overHandle || (panelOpen && overPanel)) {
    cancelClose();
    sendOpenState(true);
    return;
  }

  if (panelOpen) {
    scheduleClose();
  }
}

function startCursorPolling() {
  if (cursorPollTimer) return;
  cursorPollTimer = setInterval(updatePointerState, CURSOR_POLL_MS);
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
    setMouseEventsIgnored(true);
    startCursorPolling();
    widgetWindow.showInactive();
  });

  widgetWindow.on("closed", () => {
    if (closeTimer) clearTimeout(closeTimer);
    if (cursorPollTimer) clearInterval(cursorPollTimer);
    closeTimer = null;
    cursorPollTimer = null;
    panelOpen = false;
    mouseEventsIgnored = false;
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
