const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tokenfettiWidget", {
  getUsageSummary: () => ipcRenderer.invoke("tokenfetti:get-usage-summary"),
  onOpenState: (callback) => {
    const listener = (_event, open) => callback(Boolean(open));
    ipcRenderer.on("tokenfetti:open-state", listener);
    return () => ipcRenderer.removeListener("tokenfetti:open-state", listener);
  },
  platform: process.platform
});
