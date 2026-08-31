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
    CAPTURE_FULL_PAGE: "view.captureFullPage",
    CAPTURE_VIEWPORT: "view.captureViewport",
    GET_SEARCH_SUGGESTIONS: "view.getSearchSuggestions",
    REGISTER_WEB_CONTENTS: "view.registerWebContents",
    CREATE_PANE: "view.createPane",
    SET_BOUNDS: "view.setBounds",
    DESTROY_PANE: "view.destroyPane",
    NAVIGATE: "view.navigate",
    FOCUS: "view.focusPane",
    SET_AUDIO_MUTED: "view.setAudioMuted",
    SET_DEVICE_EMULATION: "view.setDeviceEmulation",
    SET_NETWORK_THROTTLE: "view.setNetworkThrottle",
    EXTRACT_READER_MODE: "view.extractReaderMode",
    PICK_COLOR: "view.pickColor"
  },
  SEARCH: {
    FIND_IN_ALL_PANES: "search.findInAllPanes",
    STOP_FIND: "search.stopFind"
  },
  MEMORY: {
    GET_STATS: "memory.getStats"
  },
  OVERLAY: {
    FORWARD_POINTER: "overlay.forwardPointer",
    CURSOR: "overlay.cursor"
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
    PANE_RELOADED_WC: "pane.reloaded-wc",
    VIEW_LOAD_START: "view.load-start",
    VIEW_LOADED: "view.loaded"
  }
};
function createIpcClient(ipcRenderer) {
  return {
    db: {
      getInitialAppState: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_INITIAL_STATE),
      getWorkspaces: () => ipcRenderer.invoke(IPC_CHANNELS.DB.GET_WORKSPACES),
      createWorkspace: (id, name, icon) => ipcRenderer.invoke(IPC_CHANNELS.DB.CREATE_WORKSPACE, id, name, icon),
      updateWorkspace: (id, name, icon) => ipcRenderer.invoke(IPC_CHANNELS.DB.UPDATE_WORKSPACE, id, name, icon),
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
      updateTab: (id, name, customName) => ipcRenderer.invoke(IPC_CHANNELS.DB.UPDATE_TAB, id, name, customName),
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
      ),
      createPane: (req) => ipcRenderer.send(IPC_CHANNELS.VIEW.CREATE_PANE, req),
      setBounds: (paneId, rect) => ipcRenderer.send(IPC_CHANNELS.VIEW.SET_BOUNDS, paneId, rect),
      destroyPane: (paneId) => ipcRenderer.send(IPC_CHANNELS.VIEW.DESTROY_PANE, paneId),
      navigate: (paneId, url) => ipcRenderer.send(IPC_CHANNELS.VIEW.NAVIGATE, paneId, url),
      focus: (paneId) => ipcRenderer.send(IPC_CHANNELS.VIEW.FOCUS, paneId),
      setAudioMuted: (paneId, muted) => ipcRenderer.send(IPC_CHANNELS.VIEW.SET_AUDIO_MUTED, paneId, muted)
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
    onViewFaviconUpdated: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on("view.favicon-updated", handler);
      return () => ipcRenderer.removeListener("view.favicon-updated", handler);
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
    },
    onViewLoadStart: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_LOAD_START, handler);
      return () => ipcRenderer.removeListener(
        IPC_CHANNELS.EVENTS.VIEW_LOAD_START,
        handler
      );
    },
    onViewLoaded: (callback) => {
      const handler = (_, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.EVENTS.VIEW_LOADED, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.EVENTS.VIEW_LOADED, handler);
    },
    onAccelerator: (callback) => {
      const handler = (_, accelerator) => callback(accelerator);
      ipcRenderer.on("app:accelerator", handler);
      return () => ipcRenderer.removeListener("app:accelerator", handler);
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
      try {
        const current = typeof el.getURL === "function" ? el.getURL() : el.src;
        if (current === url) return;
      } catch {
      }
      if (typeof el.loadURL === "function") {
        try {
          const p = el.loadURL(url);
          if (p && typeof p.catch === "function") {
            p.catch(() => {
            });
          }
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
    if (el) {
      try {
        if (typeof el.isAudioMuted === "function" && typeof el.setAudioMuted === "function") {
          const nextMuted = !el.isAudioMuted();
          el.setAudioMuted(nextMuted);
          window.dispatchEvent(
            new CustomEvent("app:media-status", {
              detail: { paneId, isPlaying: !nextMuted }
            })
          );
          return;
        }
      } catch {
      }
      try {
        el.executeJavaScript(`
          (function() {
            const medias = document.querySelectorAll('video, audio');
            const isAnyMuted = Array.from(medias).some(m => m.muted);
            medias.forEach(m => m.muted = !isAnyMuted);
          })()
        `).catch(() => {
        });
      } catch {
      }
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
const CURSOR_ALLOWLIST = {
  default: true,
  pointer: true,
  text: true,
  crosshair: true,
  wait: true,
  help: true,
  move: true,
  "e-resize": true,
  "n-resize": true,
  "ne-resize": true,
  "nw-resize": true,
  "s-resize": true,
  "se-resize": true,
  "sw-resize": true,
  "w-resize": true,
  "ns-resize": true,
  "ew-resize": true,
  "nesw-resize": true,
  "nwse-resize": true,
  "col-resize": true,
  "row-resize": true,
  grab: true,
  grabbing: true,
  "not-allowed": true,
  "zoom-in": true,
  "zoom-out": true,
  cell: true,
  copy: true,
  alias: true,
  "context-menu": true,
  none: true,
  progress: true
};
function modifiers(e) {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}
function isChrome(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  return !!el.closest("[data-overlay-chrome]");
}
function buildForwardMsg(type, e) {
  const x = e.clientX;
  const y = e.clientY;
  const mods = modifiers(e);
  if (type === "wheel") {
    const w = e;
    return {
      type,
      x,
      y,
      button: e.button,
      buttons: e.buttons,
      deltaX: w.deltaX,
      deltaY: w.deltaY,
      modifiers: mods
    };
  }
  return {
    type,
    x,
    y,
    button: e.button,
    buttons: e.buttons,
    clickCount: e.detail,
    modifiers: mods
  };
}
let gapInstalled = false;
let isDraggingGuest = false;
function installGapPointerForwarding() {
  if (gapInstalled) return;
  gapInstalled = true;
  window.addEventListener(
    "pointerdown",
    (ev) => {
      if (isChrome(ev.clientX, ev.clientY)) return;
      isDraggingGuest = true;
      ev.preventDefault();
      electron.ipcRenderer.send(
        IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
        buildForwardMsg("mousedown", ev)
      );
    },
    { capture: true, passive: false }
  );
  window.addEventListener(
    "pointermove",
    (ev) => {
      if (isDraggingGuest) {
        ev.preventDefault();
        electron.ipcRenderer.send(
          IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
          buildForwardMsg("mousemove", ev)
        );
        return;
      }
      if (isChrome(ev.clientX, ev.clientY)) {
        if (document.documentElement.style.cursor !== "default") {
          document.documentElement.style.cursor = "default";
        }
        return;
      }
      electron.ipcRenderer.send(
        IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
        buildForwardMsg("mousemove", ev)
      );
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "pointerup",
    (ev) => {
      if (isDraggingGuest) {
        isDraggingGuest = false;
        ev.preventDefault();
        electron.ipcRenderer.send(
          IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
          buildForwardMsg("mouseup", ev)
        );
        return;
      }
      if (isChrome(ev.clientX, ev.clientY)) return;
      electron.ipcRenderer.send(
        IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
        buildForwardMsg("mouseup", ev)
      );
    },
    { capture: true, passive: false }
  );
  window.addEventListener(
    "wheel",
    (ev) => {
      if (isChrome(ev.clientX, ev.clientY)) return;
      ev.preventDefault();
      electron.ipcRenderer.send(
        IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
        buildForwardMsg("wheel", ev)
      );
    },
    { capture: true, passive: false }
  );
  window.addEventListener(
    "contextmenu",
    (ev) => {
      if (isChrome(ev.clientX, ev.clientY)) return;
      ev.preventDefault();
      electron.ipcRenderer.send(
        IPC_CHANNELS.OVERLAY.FORWARD_POINTER,
        buildForwardMsg("mouseup", ev)
      );
    },
    { capture: true, passive: false }
  );
  window.addEventListener("blur", () => {
    isDraggingGuest = false;
  });
  window.addEventListener("pointercancel", () => {
    isDraggingGuest = false;
  });
}
let cursorInstalled = false;
function installCursorMirror() {
  if (cursorInstalled) return;
  cursorInstalled = true;
  electron.ipcRenderer.on(IPC_CHANNELS.OVERLAY.CURSOR, (_e, type) => {
    document.documentElement.style.cursor = CURSOR_ALLOWLIST[type] === true ? type : "default";
  });
}
electron.ipcRenderer.setMaxListeners(100);
const panePreloadUrl = `file://${path.join(__dirname, "pane.js").replace(/\\/g, "/")}`;
const chromeVersion = process.versions.chrome && Number(process.versions.chrome.split(".")[0]) >= 144 ? process.versions.chrome : "144.0.7550.80";
const defaultUserAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
const client = createIpcClient(electron.ipcRenderer);
const events = createIpcEvents(electron.ipcRenderer);
const api = {
  panePreloadUrl,
  defaultUserAgent,
  isNativeViews: true,
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
  viewDestroy: (paneId) => {
    const el = getWebview(paneId);
    if (el) {
      try {
        if (typeof el.executeJavaScript === "function") {
          el.executeJavaScript(
            "try { document.querySelectorAll('video, audio').forEach(m => { m.pause(); m.muted = true; m.src = ''; m.load(); }); } catch(e) {}"
          ).catch(() => {
          });
        }
        if (typeof el.stop === "function") el.stop();
        if (typeof el.loadURL === "function") el.loadURL("about:blank");
      } catch {
      }
    }
  },
  viewSetBounds: (paneId, bounds) => {
    electron.ipcRenderer.send(IPC_CHANNELS.VIEW.SET_BOUNDS, paneId, bounds);
  },
  viewBatchSetBounds: (boundsMap) => {
    if (boundsMap && typeof boundsMap === "object") {
      for (const [paneId, bounds] of Object.entries(boundsMap)) {
        electron.ipcRenderer.send(IPC_CHANNELS.VIEW.SET_BOUNDS, paneId, bounds);
      }
    }
  },
  viewHideAll: () => {
  },
  viewRestoreAll: () => {
  },
  viewWake: (_paneId, _bounds) => {
  },
  viewCapture: () => Promise.resolve(""),
  viewCaptureAllActive: () => Promise.resolve({}),
  viewHibernateAllActive: () => Promise.resolve({}),
  viewHibernate: () => Promise.resolve(""),
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
  viewToggleMute: webviewHelpers.viewToggleMute,
  viewUpdateProfile: (paneId, profileId) => {
    electron.ipcRenderer.send("view.updateProfile", paneId, profileId);
  },
  registerWebContents: (paneId, wcId) => client.view.registerWebContents(paneId, wcId),
  view: {
    createPane: (req) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.CREATE_PANE, req),
    setBounds: (paneId, bounds) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.SET_BOUNDS, paneId, bounds),
    destroyPane: (paneId) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.DESTROY_PANE, paneId),
    navigate: (paneId, url) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.NAVIGATE, paneId, url),
    focus: (paneId) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.FOCUS, paneId),
    setAudioMuted: (paneId, muted) => electron.ipcRenderer.send(IPC_CHANNELS.VIEW.SET_AUDIO_MUTED, paneId, muted),
    captureFullPage: (paneId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.CAPTURE_FULL_PAGE, paneId),
    captureViewport: (paneId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.CAPTURE_VIEWPORT, paneId),
    setDeviceEmulation: (paneId, device) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.SET_DEVICE_EMULATION, paneId, device),
    setNetworkThrottle: (paneId, profile) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.SET_NETWORK_THROTTLE, paneId, profile),
    extractReaderMode: (paneId) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.EXTRACT_READER_MODE, paneId),
    pickColor: (paneId, x, y) => electron.ipcRenderer.invoke(IPC_CHANNELS.VIEW.PICK_COLOR, paneId, x, y)
  },
  // Multi-Pane Cross-Split Search & Memory Optimizer
  findInAllPanes: (query, opts) => electron.ipcRenderer.send(IPC_CHANNELS.SEARCH.FIND_IN_ALL_PANES, query, opts),
  stopFind: (action) => electron.ipcRenderer.send(IPC_CHANNELS.SEARCH.STOP_FIND, action),
  getPaneMemoryStats: () => electron.ipcRenderer.invoke(IPC_CHANNELS.MEMORY.GET_STATS),
  showCommunicatorDrawer: (appId, rect, partition, url) => electron.ipcRenderer.send("communicator.showDrawer", appId, rect, partition, url),
  hideCommunicatorDrawer: () => electron.ipcRenderer.send("communicator.hideDrawer"),
  communicator: {
    getState: () => electron.ipcRenderer.invoke("communicator.getState"),
    createStack: (id, name, icon) => electron.ipcRenderer.invoke("communicator.createStack", id, name, icon),
    updateStack: (id, name, icon) => electron.ipcRenderer.invoke("communicator.updateStack", id, name, icon),
    deleteStack: (id) => electron.ipcRenderer.invoke("communicator.deleteStack", id),
    createApp: (id, stackId, profileId, name, url, icon) => electron.ipcRenderer.invoke("communicator.createApp", id, stackId, profileId, name, url, icon),
    updateApp: (id, updates) => electron.ipcRenderer.invoke("communicator.updateApp", id, updates),
    deleteApp: (id) => electron.ipcRenderer.invoke("communicator.deleteApp", id),
    saveProvider: (provider) => electron.ipcRenderer.invoke("communicator.saveProvider", provider),
    deleteProvider: (id) => electron.ipcRenderer.invoke("communicator.deleteProvider", id),
    captureSnapshot: (appId) => electron.ipcRenderer.invoke("communicator.captureSnapshot", appId),
    showDrawer: (appId, rect, partition, url) => electron.ipcRenderer.send("communicator.showDrawer", appId, rect, partition, url),
    hideDrawer: () => electron.ipcRenderer.send("communicator.hideDrawer"),
    destroyView: (appId) => electron.ipcRenderer.send("communicator.destroyView", appId)
  },
  // Push Event Subscriptions
  onNavigated: events.onViewNavigated,
  onFaviconUpdated: events.onViewFaviconUpdated,
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
  onAccelerator: events.onAccelerator,
  onWorkspaceDeepLink: events.onWorkspaceDeepLink,
  onOpenInNewPane: events.onOpenInNewPane,
  onViewLoadStart: events.onViewLoadStart,
  onAuthDetected: (callback) => electron.ipcRenderer.on("pane.auth-detected", callback),
  onPartitionCookieChanged: (callback) => {
    const handler = (_, data) => callback(data);
    electron.ipcRenderer.on("partition.cookie-changed", handler);
    return () => electron.ipcRenderer.removeListener("partition.cookie-changed", handler);
  },
  // DOM Event Bridges
  onViewNavigated: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-navigated", handler);
    const unsub = events.onViewNavigated(callback);
    return () => {
      window.removeEventListener("app:webview-navigated", handler);
      unsub();
    };
  },
  onViewLoaded: (callback) => {
    const handler = (e) => callback(e.detail);
    window.addEventListener("app:webview-loaded", handler);
    const unsub = events.onViewLoaded(callback);
    return () => {
      window.removeEventListener("app:webview-loaded", handler);
      unsub();
    };
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
    const ipcHandler = (_, id) => callback(id);
    electron.ipcRenderer.on("pane.focused", ipcHandler);
    return () => {
      window.removeEventListener("app:webview-focused", handler);
      electron.ipcRenderer.removeListener("pane.focused", ipcHandler);
    };
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
electron.ipcRenderer.on("app:env", (_e, env) => {
  api.isNativeViews = !!env.nativeViews;
  if (api.isNativeViews) {
    installGapPointerForwarding();
    installCursorMirror();
  }
});
electron.ipcRenderer.on("communicator.unread-updated", (_e, data) => {
  window.dispatchEvent(new CustomEvent("communicator.unread-updated", { detail: data }));
});
electron.ipcRenderer.on("pane.notification-posted", (_e, data) => {
  window.dispatchEvent(new CustomEvent("pane.notification-posted", { detail: data }));
});
electron.ipcRenderer.on("pane.unread-badge", (_e, data) => {
  window.dispatchEvent(new CustomEvent("pane.unread-badge", { detail: data }));
});
electron.ipcRenderer.on("pane.found-in-page", (_e, data) => {
  window.dispatchEvent(new CustomEvent("pane.found-in-page", { detail: data }));
});
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
if (api.isNativeViews === true) {
  installGapPointerForwarding();
  installCursorMirror();
}
