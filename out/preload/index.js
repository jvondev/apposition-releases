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
  // ViewManager APIs
  viewCreate: (paneId, url, profileId) => electron.ipcRenderer.send("view.create", paneId, url, profileId),
  viewUpdateProfile: (paneId, profileId) => electron.ipcRenderer.send(`view.updateProfile.${paneId}`, profileId),
  viewDestroy: (paneId) => electron.ipcRenderer.send("view.destroy", paneId),
  viewSetBounds: (paneId, bounds) => electron.ipcRenderer.send("view.setBounds", paneId, bounds),
  viewBatchSetBounds: (boundsMap) => electron.ipcRenderer.send("view.batchSetBounds", boundsMap),
  viewOpenDevTools: (paneId) => electron.ipcRenderer.send("view.openDevTools", paneId),
  viewCloseDevTools: (paneId) => electron.ipcRenderer.send("view.closeDevTools", paneId),
  openInternalDevTools: () => electron.ipcRenderer.send("app.openInternalDevTools"),
  closeInternalDevTools: () => electron.ipcRenderer.send("app.closeInternalDevTools"),
  focusMainWindow: () => electron.ipcRenderer.send("window.focus-main"),
  focusOverlayWindow: () => electron.ipcRenderer.send("window.focus-overlay"),
  viewHideDevTools: () => electron.ipcRenderer.send("view.hideDevTools"),
  viewReload: (paneId) => electron.ipcRenderer.send("view.reload", paneId),
  viewScreenshot: (paneId) => electron.ipcRenderer.send("view.screenshot", paneId),
  viewFocus: (paneId) => electron.ipcRenderer.send("view.focus", paneId),
  viewLoadURL: (paneId, url, options) => electron.ipcRenderer.send("view.loadURL", paneId, url, options),
  viewGoBack: (paneId) => electron.ipcRenderer.send("view.goBack", paneId),
  viewGoForward: (paneId) => electron.ipcRenderer.send("view.goForward", paneId),
  viewToggleMute: (paneId) => electron.ipcRenderer.send("view.toggleMute", paneId),
  viewZoomIn: (paneId) => electron.ipcRenderer.send("view.zoomIn", paneId),
  viewZoomOut: (paneId) => electron.ipcRenderer.send("view.zoomOut", paneId),
  viewZoomReset: (paneId) => electron.ipcRenderer.send("view.zoomReset", paneId),
  onViewNavigated: (callback) => {
    electron.ipcRenderer.on("view.navigated", callback);
  },
  onViewLoaded: (callback) => {
    electron.ipcRenderer.on("view.loaded", callback);
  },
  onViewConsoleMessage: (callback) => {
    electron.ipcRenderer.on("view.console-message", callback);
  },
  onViewNetworkError: (callback) => {
    electron.ipcRenderer.on("view.network-error", callback);
  },
  onPaneFocused: (callback) => {
    electron.ipcRenderer.on("pane.focused", callback);
  },
  onToast: (callback) => {
    electron.ipcRenderer.on("app:toast", callback);
  },
  onPaneContextMenu: (callback) => {
    electron.ipcRenderer.on("pane.context-menu", callback);
  },
  viewSleep: (paneId) => electron.ipcRenderer.send("view.sleep", paneId),
  viewCapture: (paneId) => electron.ipcRenderer.invoke("view.capture", paneId),
  viewCaptureAllActive: () => electron.ipcRenderer.invoke("view.captureAllActive"),
  viewHibernateAllActive: () => electron.ipcRenderer.invoke("view.hibernateAllActive"),
  viewHibernate: (paneId) => electron.ipcRenderer.invoke("view.hibernate", paneId),
  viewRespawn: (paneId) => electron.ipcRenderer.invoke("view.respawn", paneId),
  viewHideAll: () => electron.ipcRenderer.send("view.hideAll"),
  viewRestoreAll: () => electron.ipcRenderer.send("view.restoreAll"),
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
