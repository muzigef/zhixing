import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopEvent } from "../core/contracts.js";
const bridge: DesktopBridge = {
  invoke: (command) => ipcRenderer.invoke("zhixing:command", command),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DesktopEvent) =>
      callback(data);
    ipcRenderer.on("zhixing:event", listener);
    return () => {
      ipcRenderer.removeListener("zhixing:event", listener);
    };
  },
  platform: process.platform,
};
contextBridge.exposeInMainWorld("zhixing", Object.freeze(bridge));
