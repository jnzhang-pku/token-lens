const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tokenLensWidget", {
  getUsageSummary: () => ipcRenderer.invoke("token-lens:get-usage-summary"),
  onOpenState: (callback) => {
    const listener = (_event, open) => callback(Boolean(open));
    ipcRenderer.on("token-lens:open-state", listener);
    return () => ipcRenderer.removeListener("token-lens:open-state", listener);
  },
  platform: process.platform
});
