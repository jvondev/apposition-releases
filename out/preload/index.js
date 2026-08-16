"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const path = require("path");
const IPC_CHANNELS = {
  DB: {
    GET_INITIAL_STATE: "db.getInitialAppState",
    GET_WORKSPACES: "db.getWorkspaces",
    CREATE_WORKSPACE: "db.createWorkspace",
    UPDATE_WORKSPACE: "db.updateWorkspace",
    DELETE_WORKSPACE: "db.deleteWorkspace",
    SET_WORKSPACE_DEFAULT_PROFILE: "db.setWorkspaceDefaultProfile",
    SET_TAB_DEFAULT_PROFILE: "db.setTabDefaultProfile",
    UPDATE_PANE_PROFILES_FOR_WORKSPACE: "db.updatePaneProfilesForWorkspace",
    UPDATE_PANE_PROFILES_FOR_TAB: "db.updatePaneProfilesForTab",
    GET_TABS: "db.getTabs",
    CREATE_TAB: "db.createTab",
    UPDATE_TAB: "db.updateTab",
    DELETE_TAB: "db.deleteTab",
    MOVE_NODE_TO_TAB: "db.moveNodeToTab",
    GET_PROFILES: "db.getProfiles",
    CREATE_PROFILE: "db.createProfile",
    UPDATE_PROFILE: "db.updateProfile",
    DELETE_PROFILE: "db.deleteProfile",
    GET_NODES: "db.getNodes",
    SAVE_NODE: "db.saveNode",
    DELETE_NODE: "db.deleteNode",
    SAVE_TAB_LAYOUT: "db.saveTabLayout"
  },
  WINDOW: {
    MINIMIZE: "window.minimize",
    MAXIMIZE: "window.maximize",
    CLOSE: "window.close",
    OPEN_EXTERNAL: "window.openExternal",
    SET_IGNORE_MOUSE_EVENTS: "set-ignore-mouse-events",
    SET_WAKE_REGIONS: "set-wake-regions",
    OPEN_INTERNAL_DEVTOOLS: "app.openInternalDevTools",
    CLOSE_INTERNAL_DEVTOOLS: "app.closeInternalDevTools"
  },
  VIEW: {
    RELOAD: "view.reload",
    SCREENSHOT: "view.screenshot",
    GET_SEARCH_SUGGESTIONS: "view.getSearchSuggestions",
    REGISTER_WEB_CONTENTS: "view.registerWebContents"
  },
  LICENSING: {
    ACTIVATE: "licensing.activate",
    VALIDATE: "licensing.validate",
    GET_KEY: "licensing.getKey",
    GET_STATE: "licensing.getState",
    CHECK_PREMIUM: "licensing.checkPremium",
    IS_DEV: "licensing.isDev",
    CHECK_FOR_UPDATES: "updater.check"
  },
  AUTH: {
    CLEAR_SITE_DATA: "auth.clearSiteData",
    START_RELAY: "auth.startRelay",
    OPEN_GOOGLE_AUTH: "auth.openGoogleAuth",
    EXPORT_VAULT: "vault.exportSession",
    IMPORT_VAULT: "vault.importSession"
  },
  METRICS: {
    MEMORY: "metrics.memory",
    PREFETCH: "net.prefetch"
  },
  TEARING: {
    UPDATE: "tear-update",
    HIDE: "tear-hide",
    COMMIT: "tear-commit"
  },
  EVENTS: {
    DEEP_LINK_WORKSPACE: "app.deep-link.workspace",
    OPEN_IN_NEW_PANE: "open-in-new-pane",
    TOAST: "app:toast",
    VIEW_NAVIGATED: "view.navigated",
    VIEW_MEDIA_STATUS: "view.media-status",
    VIEW_CRASHED: "view.crashed",
    FORWARDED_KEY: "forwarded-key",
    DEVTOOLS_CLOSED: "view.devtools-closed",
    AUTH_COMPLETED: "app.auth-completed",
    CONTEXT_MENU_NATIVE: "view.context-menu-native",
    VIEW_FOCUS_WC: "view.focus-wc",
    SPLIT_PANE_WC: "app:split-pane-wc",
    MAXIMIZE_PANE_WC: "app:maximize-pane-wc",
    CLOSE_PANE_WC: "app:close-pane-wc",
    PANE_RELOADED_WC: "pane.reloaded-wc"
  }
};
function createIpcClient(ipcRenderer) {
  return {
    db: {
      getInitialAppState: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_INITIAL_STATE),
      getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_WORKSPACES),
      createWorkspace: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.DB.CREATE_WORKSPACE, id, name),
      updateWorkspace: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.DB.UPDATE_WORKSPACE, id, name),
      deleteWorkspace: (id) => ipcRenderer.invoke(IPC_CHANNELS.DB.DELETE_WORKSPACE, id),
      setWorkspaceDefaultProfile: (id, profileId) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.SET_WORKSPACE_DEFAULT_PROFILE,
        id,
        profileId
      ),
      setTabDefaultProfile: (id, profileId) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.SET_TAB_DEFAULT_PROFILE,
        id,
        profileId
      ),
      updatePaneProfilesForWorkspace: (workspaceId, profileId) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_WORKSPACE,
        workspaceId,
        profileId
      ),
      updatePaneProfilesForTab: (tabId, profileId) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.UPDATE_PANE_PROFILES_FOR_TAB,
        tabId,
        profileId
      ),
      getTabs: (workspaceId) => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_TABS, workspaceId),
      createTab: (id, workspaceId, name) => ipcRenderer.invoke(IPC_CHANNELS.DB.CREATE_TAB, id, workspaceId, name),
      updateTab: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.DB.UPDATE_TAB, id, name),
      deleteTab: (id) => ipcRenderer.invoke(IPC_CHANNELS.DB.DELETE_TAB, id),
      moveNodeToTab: (nodeId, targetTabId) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.MOVE_NODE_TO_TAB,
        nodeId,
        targetTabId
      ),
      getProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_PROFILES),
      createProfile: (id, name, color, is_ephemeral, proxy_server, user_agent) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.CREATE_PROFILE,
        id,
        name,
        color,
        is_ephemeral,
        proxy_server,
        user_agent
      ),
      updateProfile: (id, name, color, is_ephemeral, proxy_server, user_agent) => ipcRenderer.invoke(
        IPC_CHANNELS.DB.UPDATE_PROFILE,
        id,
        name,
        color,
        is_ephemeral,
        proxy_server,
        user_agent
      ),
      deleteProfile: (id) => ipcRenderer.invoke(IPC_CHANNELS.DB.DELETE_PROFILE, id),
      getNodes: (tabId) => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_NODES, tabId),
      saveNode: (node) => ipcRenderer.send(IPC_CHANNELS.DB.SAVE_NODE, node),
      deleteNode: (id) => ipcRenderer.send(IPC_CHANNELS.DB.DELETE_NODE, id),
      saveTabLayout: (tabId, layoutState) => ipcRenderer.send(IPC_CHANNELS.DB.SAVE_TAB_LAYOUT, tabId, layoutState)
    },
    window: {
      minimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW.MINIMIZE),
      maximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW.MAXIMIZE),
      close: () => ipcRenderer.send(IPC_CHANNELS.WINDOW.CLOSE),
      openExternal: (url) => ipcRenderer.send(IPC_CHANNELS.WINDOW.OPEN_EXTERNAL, url),
      setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send(
        IPC_CHANNELS.WINDOW.SET_IGNORE_MOUSE_EVENTS,
        ignore,
        options
      ),
      setWakeRegions: (rects) => ipcRenderer.send(IPC_CHANNELS.WINDOW.SET_WAKE_REGIONS, rects),
      openInternalDevTools: () => ipcRenderer.send(IPC_CHANNELS.WINDOW.OPEN_INTERNAL_DEVTOOLS),
      closeInternalDevTools: () => ipcRenderer.send(IPC_CHANNELS.WINDOW.CLOSE_INTERNAL_DEVTOOLS)
    },
    view: {
      reload: (paneId, hard) => ipcRenderer.send(IPC_CHANNELS.VIEW.RELOAD, paneId, hard),
      screenshot: (paneId) => ipcRenderer.send(IPC_CHANNELS.VIEW.SCREENSHOT, paneId),
      getSearchSuggestions: (query) => ipcRenderer.invoke(IPC_CHANNELS.VIEW.GET_SEARCH_SUGGESTIONS, query),
      registerWebContents: (paneId, wcId) => ipcRenderer.send(
        IPC_CHANNELS.VIEW.REGISTER_WEB_CONTENTS,
        paneId,
        wcId
      )
    },
    licensing: {
      activate: (key) => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.ACTIVATE, key),
      validate: (key) => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.VALIDATE, key),
      getKey: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.GET_KEY),
      getState: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.GET_STATE),
      checkPremium: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.CHECK_PREMIUM),
      isDev: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.IS_DEV),
      checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.LICENSING.CHECK_FOR_UPDATES)
    },
    auth: {
      clearSiteData: (origin, profileId) => ipcRenderer.invoke(
        IPC_CHANNELS.AUTH.CLEAR_SITE_DATA,
        origin,
        profileId
      ),
      startRelay: (targetUrl, profileId, paneId) => ipcRenderer.invoke(
        IPC_CHANNELS.AUTH.START_RELAY,
        targetUrl,
        profileId,
        paneId
      ),
      openGoogleAuth: (options) => ipcRenderer.invoke(IPC_CHANNELS.AUTH.OPEN_GOOGLE_AUTH, options),
      exportVault: (profileId, secretKey) => ipcRenderer.invoke(
        IPC_CHANNELS.AUTH.EXPORT_VAULT,
        profileId,
        secretKey
      ),
      importVault: (encryptedPayload, secretKey) => ipcRenderer.invoke(
        IPC_CHANNELS.AUTH.IMPORT_VAULT,
        encryptedPayload,
        secretKey
      )
    },
    metrics: {
      memory: () => ipcRenderer.invoke(IPC_CHANNELS.METRICS.MEMORY),
      prefetch: (url) => ipcRenderer.send(IPC_CHANNELS.METRICS.PREFETCH, url)
    },
    tearing: {
      update: (paneId, x, y) => ipcRenderer.send(IPC_CHANNELS.TEARING.UPDATE, paneId, x, y),
      hide: (paneId) => ipcRenderer.send(IPC_CHANNELS.TEARING.HIDE, paneId),
      commit: (paneId) => ipcRenderer.send(IPC_CHANNELS.TEARING.COMMIT, paneId)
    }
  };
}
function createIpcEvents(ipcRenderer) {
  return {
    onViewNavigated: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_NAVIGATED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.VIEW_NAVIGATED, handler);
    },
    onViewMediaStatus: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.VIEW_MEDIA_STATUS,
        handler
      );
    },
    onViewCrashed: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_CRASHED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.VIEW_CRASHED, handler);
    },
    onToast: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.TOAST, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.TOAST, handler);
    },
    onForwardedKey: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.FORWARDED_KEY, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.FORWARDED_KEY, handler);
    },
    onAuthCompleted: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.AUTH_COMPLETED, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.AUTH_COMPLETED,
        handler
      );
    },
    onNativeContextMenu: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.CONTEXT_MENU_NATIVE, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.CONTEXT_MENU_NATIVE,
        handler
      );
    },
    onViewFocusWc: (callback) => {
      const handler = (_, wcId) => callback(wcId);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_FOCUS_WC, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.VIEW_FOCUS_WC, handler);
    },
    onSplitPaneWc: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.SPLIT_PANE_WC, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.SPLIT_PANE_WC, handler);
    },
    onMaximizePaneWc: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.MAXIMIZE_PANE_WC, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.MAXIMIZE_PANE_WC,
        handler
      );
    },
    onClosePaneWc: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.CLOSE_PANE_WC, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.CLOSE_PANE_WC, handler);
    },
    onPaneReloadedWc: (callback) => {
      const handler = (_, wcId) => callback(wcId);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.PANE_RELOADED_WC, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.PANE_RELOADED_WC,
        handler
      );
    },
    onDevToolsClosed: (callback) => {
      const handler = (_, paneId) => callback(paneId);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.DEVTOOLS_CLOSED, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.DEVTOOLS_CLOSED,
        handler
      );
    },
    onWorkspaceDeepLink: (callback) => {
      const handler = (_, workspaceId) => callback(workspaceId);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.DEEP_LINK_WORKSPACE, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.DEEP_LINK_WORKSPACE,
        handler
      );
    },
    onOpenInNewPane: (callback) => {
      const handler = (_, url) => callback(url);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.OPEN_IN_NEW_PANE, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.OPEN_IN_NEW_PANE,
        handler
      );
    }
  };
}
function getWebview(paneId) {
  return document.getElementById("webview-" + paneId);
}
const webviewHelpers = {
  viewCreate: (paneId, url) => {
    const el = getWebview(paneId);
    if (el && url && el.src !== url) {
      el.src = url;
    }
  },
  viewUpdateProfile: (paneId, profileId) => {
    const el = getWebview(paneId);
    if (el) {
      el.setAttribute(
        "partition",
        profileId === "main" ? "persist:main" : `persist:${profileId}`
      );
    }
  },
  viewOpenDevTools: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      try {
        el.openDevTools();
      } catch (e) {
        console.error("Failed to open webview devtools:", e);
      }
    }
  },
  viewCloseDevTools: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      try {
        el.closeDevTools();
      } catch (e) {
        console.error("Failed to close webview devtools:", e);
      }
    }
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
  viewFocus: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      try {
        el.focus();
      } catch {
      }
    }
  },
  viewLoadURL: (paneId, url, options) => {
    const el = getWebview(paneId);
    if (el) {
      if (options?.clearHistory) {
        try {
          el.clearHistory();
        } catch {
        }
      }
      if (typeof el.loadURL === "function") {
        try {
          el.loadURL(url);
          return;
        } catch {
        }
      }
      el.src = url;
    }
  },
  viewGoBack: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      if (typeof el.canGoBack === "function" && el.canGoBack()) {
        try {
          el.goBack();
          return;
        } catch {
        }
      }
      try {
        el.executeJavaScript("window.history.back()").catch(() => {
        });
      } catch {
      }
    }
  },
  viewGoForward: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      if (typeof el.canGoForward === "function" && el.canGoForward()) {
        try {
          el.goForward();
          return;
        } catch {
        }
      }
      try {
        el.executeJavaScript("window.history.forward()").catch(() => {
        });
      } catch {
      }
    }
  },
  viewToggleMute: (paneId) => {
    const el = getWebview(paneId);
    if (el && typeof el.isAudioMuted === "function") {
      el.setAudioMuted(!el.isAudioMuted());
    }
  },
  viewZoomIn: (paneId) => {
    const el = getWebview(paneId);
    if (el && typeof el.getZoomLevel === "function") {
      el.setZoomLevel(el.getZoomLevel() + 0.5);
    }
  },
  viewZoomOut: (paneId) => {
    const el = getWebview(paneId);
    if (el && typeof el.getZoomLevel === "function") {
      el.setZoomLevel(el.getZoomLevel() - 0.5);
    }
  },
  viewZoomReset: (paneId) => {
    const el = getWebview(paneId);
    if (el && typeof el.setZoomLevel === "function") {
      el.setZoomLevel(0);
    }
  },
  viewSleep: (paneId) => {
    const el = getWebview(paneId);
    if (el && typeof el.setAudioMuted === "function") {
      try {
        el.setAudioMuted(true);
      } catch {
      }
    }
  }
};
const panePreloadUrl = `file://${path.join(__dirname, "pane.js").replace(/\\/g, "/")}`;
const chromeVersion = process.versions.chrome && Number(process.versions.chrome.split(".")[0]) >= 144 ? process.versions.chrome : "144.0.7550.80";
const defaultUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
const client = createIpcClient(electron.ipcRenderer);
const events = createIpcEvents(electron.ipcRenderer);
const api = {
  panePreloadUrl,
  defaultUserAgent,
  // Flat DB access
  getInitialAppState: client.db.getInitialAppState,
  getWorkspaces: client.db.getWorkspaces,
  createWorkspace: client.db.createWorkspace,
  updateWorkspace: client.db.updateWorkspace,
  deleteWorkspace: client.db.deleteWorkspace,
  setWorkspaceDefaultProfile: client.db.setWorkspaceDefaultProfile,
  setTabDefaultProfile: client.db.setTabDefaultProfile,
  updatePaneProfilesForWorkspace: client.db.updatePaneProfilesForWorkspace,
  updatePaneProfilesForTab: client.db.updatePaneProfilesForTab,
  getTabs: client.db.getTabs,
  createTab: client.db.createTab,
  updateTab: client.db.updateTab,
  deleteTab: client.db.deleteTab,
  moveNodeToTab: client.db.moveNodeToTab,
  getProfiles: client.db.getProfiles,
  createProfile: client.db.createProfile,
  updateProfile: client.db.updateProfile,
  deleteProfile: client.db.deleteProfile,
  getNodes: client.db.getNodes,
  saveNode: client.db.saveNode,
  deleteNode: client.db.deleteNode,
  saveTabLayout: client.db.saveTabLayout,
  // Window Controls
  setIgnoreMouseEvents: client.window.setIgnoreMouseEvents,
  setWakeRegions: client.window.setWakeRegions,
  minimizeWindow: client.window.minimize,
  maximizeWindow: client.window.maximize,
  closeWindow: client.window.close,
  openInternalDevTools: client.window.openInternalDevTools,
  closeInternalDevTools: client.window.closeInternalDevTools,
  focusMainWindow: () => {
  },
  focusOverlayWindow: () => {
  },
  // Licensing & Updates
  activateLicenseKey: client.licensing.activate,
  validateLicenseKey: client.licensing.validate,
  getLicenseKey: client.licensing.getKey,
  getLicenseState: client.licensing.getState,
  checkPremiumStatus: client.licensing.checkPremium,
  isDev: client.licensing.isDev,
  checkForUpdates: client.licensing.checkForUpdates,
  // Auth & Session
  clearSiteData: client.auth.clearSiteData,
  startAuthRelay: client.auth.startRelay,
  openGoogleAuth: client.auth.openGoogleAuth,
  exportSessionVault: client.auth.exportVault,
  importSessionVault: client.auth.importVault,
  // Metrics & Network
  getMemoryInfo: client.metrics.memory,
  prefetchHost: client.metrics.prefetch,
  getSearchSuggestions: client.view.getSearchSuggestions,
  // Tearing
  updateTearWindow: client.tearing.update,
  hideTearWindow: client.tearing.hide,
  commitTearWindow: client.tearing.commit,
  // Webview Lifecycle & DOM Helpers
  ...webviewHelpers,
  viewDestroy: (_paneId) => {
  },
  viewSetBounds: (_paneId, _bounds) => {
  },
  viewBatchSetBounds: (_boundsMap) => {
  },
  viewHideAll: () => {
  },
  viewRestoreAll: () => {
  },
  viewWake: (_paneId, _bounds) => {
  },
  viewCapture: () => Promise.resolve(
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E"
  ),
  viewCaptureAllActive: () => Promise.resolve({}),
  viewHibernateAllActive: () => Promise.resolve({}),
  viewHibernate: () => Promise.resolve(
    "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%25%22%20height%3D%22100%25%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23F7F7F5%22%2F%3E%3C%2Fsvg%3E"
  ),
  viewRespawn: () => Promise.resolve(""),
  viewReload: (paneId, hard = false) => {
    const el = getWebview(paneId);
    if (el) {
      try {
        if (hard && typeof el.reloadIgnoringCache === "function") {
          el.reloadIgnoringCache();
        } else if (typeof el.reload === "function") {
          el.reload();
        } else if (typeof el.loadURL === "function") {
          const current = typeof el.getURL === "function" ? el.getURL() : el.src;
          if (current) el.loadURL(current);
        } else if (el.src) {
          el.src = el.src;
        }
      } catch (e) {
        console.error("Failed to reload webview:", e);
      }
    }
    client.view.reload(paneId, hard);
  },
  viewScreenshot: (paneId) => client.view.screenshot(paneId),
  registerWebContents: (paneId, wcId) => client.view.registerWebContents(paneId, wcId),
  // Push Event Subscriptions
  onNavigated: events.onViewNavigated,
  onMediaStatus: events.onViewMediaStatus,
  onViewCrashed: events.onViewCrashed,
  onForwardedKey: events.onForwardedKey,
  onDevToolsClosed: events.onDevToolsClosed,
  onAuthCompleted: events.onAuthCompleted,
  onNativeContextMenu: events.onNativeContextMenu,
  onViewFocusWc: events.onViewFocusWc,
  onSplitPaneWc: events.onSplitPaneWc,
  onMaximizePaneWc: events.onMaximizePaneWc,
  onClosePaneWc: events.onClosePaneWc,
  onPaneReloadedWc: events.onPaneReloadedWc,
  onWorkspaceDeepLink: events.onWorkspaceDeepLink,
  onOpenInNewPane: events.onOpenInNewPane,
  onAuthDetected: (callback) => electron.ipcRenderer.on("pane.auth-detected", callback),
  // DOM Event Bridges
  onViewNavigated: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-navigated", handler);
    return () => window.removeEventListener("app:webview-navigated", handler);
  },
  onViewLoaded: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-loaded", handler);
    return () => window.removeEventListener("app:webview-loaded", handler);
  },
  onViewConsoleMessage: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-console-message", handler);
    return () => window.removeEventListener("app:webview-console-message", handler);
  },
  onViewNetworkError: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-network-error", handler);
    return () => window.removeEventListener("app:webview-network-error", handler);
  },
  onPaneFocused: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-focused", handler);
    return () => window.removeEventListener("app:webview-focused", handler);
  },
  onToast: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-toast", handler);
    const unToast = events.onToast((t) => callback(t));
    return () => {
      window.removeEventListener("app:webview-toast", handler);
      unToast();
    };
  },
  onPaneContextMenu: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-context-menu", handler);
    return () => window.removeEventListener("app:webview-context-menu", handler);
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
