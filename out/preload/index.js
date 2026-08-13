"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const api = {
  setIgnoreMouseEvents: (ignore, options) => {
    electron.ipcRenderer.send("set-ignore-mouse-events", ignore, options);
  },
  setWakeRegions: (rects) => electron.ipcRenderer.send("set-wake-regions", rects),
  minimizeWindow: () => electron.ipcRenderer.send("window.minimize"),
  maximizeWindow: () => electron.ipcRenderer.send("window.maximize"),
  closeWindow: () => electron.ipcRenderer.send("window.close"),
  getWorkspaces: () => electron.ipcRenderer.invoke("db.getWorkspaces"),
  createWorkspace: (id, name) => electron.ipcRenderer.invoke("db.createWorkspace", id, name),
  updateWorkspace: (id, name) => electron.ipcRenderer.invoke("db.updateWorkspace", id, name),
  deleteWorkspace: (id) => electron.ipcRenderer.invoke("db.deleteWorkspace", id),
  setWorkspaceDefaultProfile: (id, profileId) => electron.ipcRenderer.invoke("db.setWorkspaceDefaultProfile", id, profileId),
  setTabDefaultProfile: (id, profileId) => electron.ipcRenderer.invoke("db.setTabDefaultProfile", id, profileId),
  updatePaneProfilesForWorkspace: (workspaceId, profileId) => electron.ipcRenderer.invoke(
    "db.updatePaneProfilesForWorkspace",
    workspaceId,
    profileId
  ),
  updatePaneProfilesForTab: (tabId, profileId) => electron.ipcRenderer.invoke("db.updatePaneProfilesForTab", tabId, profileId),
  getTabs: (workspaceId) => electron.ipcRenderer.invoke("db.getTabs", workspaceId),
  createTab: (id, workspaceId, name) => electron.ipcRenderer.invoke("db.createTab", id, workspaceId, name),
  onAuthDetected: (callback) => electron.ipcRenderer.on("pane.auth-detected", callback),
  onWorkspaceDeepLink: (callback) => electron.ipcRenderer.on("app.deep-link.workspace", callback),
  updateTab: (id, name) => electron.ipcRenderer.invoke("db.updateTab", id, name),
  deleteTab: (id) => electron.ipcRenderer.invoke("db.deleteTab", id),
  moveNodeToTab: (nodeId, targetTabId) => electron.ipcRenderer.invoke("db.moveNodeToTab", nodeId, targetTabId),
  onOpenInNewPane: (callback) => electron.ipcRenderer.on("open-in-new-pane", callback),
  getProfiles: () => electron.ipcRenderer.invoke("db.getProfiles"),
  createProfile: (id, name, color, is_ephemeral, proxy_server, user_agent) => electron.ipcRenderer.invoke(
    "db.createProfile",
    id,
    name,
    color,
    is_ephemeral,
    proxy_server,
    user_agent
  ),
  updateProfile: (id, name, color, is_ephemeral, proxy_server, user_agent) => electron.ipcRenderer.invoke(
    "db.updateProfile",
    id,
    name,
    color,
    is_ephemeral,
    proxy_server,
    user_agent
  ),
  deleteProfile: (id) => electron.ipcRenderer.invoke("db.deleteProfile", id),
  getNodes: (tabId) => electron.ipcRenderer.invoke("db.getNodes", tabId),
  saveNode: (node) => electron.ipcRenderer.send("db.saveNode", node),
  deleteNode: (id) => electron.ipcRenderer.send("db.deleteNode", id),
  saveTabLayout: (tabId, layoutState) => electron.ipcRenderer.send("db.saveTabLayout", tabId, layoutState),
  // ViewManager APIs (Single-Window webview mode)
  viewCreate: (paneId, url, profileId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && url && el.src !== url) {
      el.src = url;
    }
  },
  viewUpdateProfile: (paneId, profileId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      el.setAttribute(
        "partition",
        profileId === "main" ? "persist:main" : `persist:${profileId}`
      );
    }
  },
  viewDestroy: (paneId) => {
  },
  viewSetBounds: (_paneId, _bounds) => {
  },
  viewBatchSetBounds: (_boundsMap) => {
  },
  viewOpenDevTools: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      try {
        el.openDevTools();
      } catch (e) {
        console.error("Failed to open webview devtools:", e);
      }
    }
  },
  viewCloseDevTools: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      try {
        el.closeDevTools();
      } catch (e) {
        console.error("Failed to close webview devtools:", e);
      }
    }
  },
  openInternalDevTools: () => electron.ipcRenderer.send("app.openInternalDevTools"),
  closeInternalDevTools: () => electron.ipcRenderer.send("app.closeInternalDevTools"),
  focusMainWindow: () => {
  },
  focusOverlayWindow: () => {
  },
  viewHideDevTools: () => {
    const webviews = document.querySelectorAll("webview");
    webviews.forEach((wv) => {
      try {
        wv.closeDevTools();
      } catch {
      }
    });
  },
  viewReload: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      try {
        el.reload();
      } catch (e) {
        console.error("Failed to reload webview:", e);
      }
    }
  },
  viewScreenshot: (paneId) => {
    electron.ipcRenderer.send("view.screenshot", paneId);
  },
  viewFocus: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      try {
        el.focus();
      } catch {
      }
    }
  },
  viewLoadURL: (paneId, url, options) => {
    const el = document.getElementById("webview-" + paneId);
    if (el) {
      if (options?.clearHistory) {
        try {
          el.clearHistory();
        } catch {
        }
      }
      el.src = url;
    }
  },
  viewGoBack: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.canGoBack === "function" && el.canGoBack()) {
      el.goBack();
    }
  },
  viewGoForward: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.canGoForward === "function" && el.canGoForward()) {
      el.goForward();
    }
  },
  viewToggleMute: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.isAudioMuted === "function") {
      el.setAudioMuted(!el.isAudioMuted());
    }
  },
  viewZoomIn: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.getZoomLevel === "function") {
      el.setZoomLevel(el.getZoomLevel() + 0.5);
    }
  },
  viewZoomOut: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.getZoomLevel === "function") {
      el.setZoomLevel(el.getZoomLevel() - 0.5);
    }
  },
  viewZoomReset: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.setZoomLevel === "function") {
      el.setZoomLevel(0);
    }
  },
  onViewNavigated: (callback) => {
    window.addEventListener("app:webview-navigated", (e) => {
      callback(e, e.detail);
    });
  },
  onViewLoaded: (callback) => {
    window.addEventListener("app:webview-loaded", (e) => {
      callback(e, e.detail);
    });
  },
  onViewConsoleMessage: (callback) => {
    window.addEventListener("app:webview-console-message", (e) => {
      callback(e, e.detail);
    });
  },
  onViewNetworkError: (callback) => {
    window.addEventListener("app:webview-network-error", (e) => {
      callback(e, e.detail);
    });
  },
  onPaneFocused: (callback) => {
    window.addEventListener("app:webview-focused", (e) => {
      callback(e, e.detail);
    });
  },
  onToast: (callback) => {
    window.addEventListener("app:webview-toast", (e) => {
      callback(e, e.detail);
    });
    electron.ipcRenderer.on("app:toast", callback);
  },
  onPaneContextMenu: (callback) => {
    window.addEventListener("app:webview-context-menu", (e) => {
      callback(e, e.detail);
    });
  },
  viewSleep: (paneId) => {
    const el = document.getElementById("webview-" + paneId);
    if (el && typeof el.setAudioMuted === "function") {
      try {
        el.setAudioMuted(true);
      } catch {
      }
    }
  },
  viewCapture: (_paneId) => {
    return Promise.resolve(
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E"
    );
  },
  viewCaptureAllActive: () => {
    return Promise.resolve({});
  },
  viewHibernateAllActive: () => {
    return Promise.resolve({});
  },
  viewHibernate: (_paneId) => {
    return Promise.resolve(
      "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E"
    );
  },
  viewRespawn: (_paneId) => {
    return Promise.resolve("");
  },
  viewHideAll: () => {
  },
  viewRestoreAll: () => {
  },
  getMemoryInfo: () => electron.ipcRenderer.invoke("metrics.memory"),
  getSearchSuggestions: (query) => electron.ipcRenderer.invoke("view.getSearchSuggestions", query),
  // Licensing APIs
  activateLicenseKey: (key) => electron.ipcRenderer.invoke("licensing.activate", key),
  validateLicenseKey: (key) => electron.ipcRenderer.invoke("licensing.validate", key),
  getLicenseKey: () => electron.ipcRenderer.invoke("licensing.getKey"),
  getLicenseState: () => electron.ipcRenderer.invoke("licensing.getState"),
  checkPremiumStatus: () => electron.ipcRenderer.invoke("licensing.checkPremium"),
  isDev: () => electron.ipcRenderer.invoke("licensing.isDev"),
  checkForUpdates: () => electron.ipcRenderer.invoke("updater.check"),
  // Tearing APIs
  updateTearWindow: (paneId, x, y) => electron.ipcRenderer.send("tear-update", paneId, x, y),
  hideTearWindow: (paneId) => electron.ipcRenderer.send("tear-hide", paneId),
  commitTearWindow: (paneId) => electron.ipcRenderer.send("tear-commit", paneId),
  onNavigated: (callback) => {
    electron.ipcRenderer.on("view.navigated", callback);
    return () => electron.ipcRenderer.removeListener("view.navigated", callback);
  },
  onMediaStatus: (callback) => {
    electron.ipcRenderer.on("view.media-status", callback);
    return () => electron.ipcRenderer.removeListener("view.media-status", callback);
  },
  onViewCrashed: (callback) => {
    electron.ipcRenderer.on("view.crashed", callback);
    return () => electron.ipcRenderer.removeListener("view.crashed", callback);
  },
  onForwardedKey: (callback) => {
    electron.ipcRenderer.on("forwarded-key", callback);
    return () => electron.ipcRenderer.removeListener("forwarded-key", callback);
  },
  onDevToolsClosed: (callback) => {
    electron.ipcRenderer.on("view.devtools-closed", callback);
    return () => electron.ipcRenderer.removeListener("view.devtools-closed", callback);
  }
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = preload.electronAPI;
  window.api = api;
}
