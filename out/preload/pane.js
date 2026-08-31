"use strict";
const electron = require("electron");
function initMediaContinuity() {
  let lastMediaSyncAt = 0;
  let lastRestoredUrl = "";
  let hasRestoredMedia = false;
  const isEligibleMedia = (media) => {
    if (!(media instanceof HTMLMediaElement)) return false;
    const dur = media.duration;
    return isFinite(dur) && dur > 15 && dur < 86400;
  };
  const getMediaStorageKey = () => `apposition:last-media-time:${window.location.pathname}${window.location.search}`;
  const syncMediaTimestamp = (force = false) => {
    const now = Date.now();
    if (!force && now - lastMediaSyncAt < 3e3) return;
    lastMediaSyncAt = now;
    const mediaList = Array.from(
      document.querySelectorAll("video, audio")
    );
    const primary = mediaList.find((m) => !m.paused && isEligibleMedia(m)) || mediaList.find((m) => isEligibleMedia(m));
    if (primary && isFinite(primary.duration) && primary.duration > 0) {
      const t = primary.currentTime;
      const dur = primary.duration;
      const validTime = t >= 5 && t <= dur - 5 ? t : 0;
      try {
        if (validTime > 0) {
          sessionStorage.setItem(getMediaStorageKey(), String(validTime));
        } else {
          sessionStorage.removeItem(getMediaStorageKey());
        }
      } catch {
      }
      const payload = {
        currentTime: validTime,
        duration: dur,
        url: window.location.href
      };
      try {
        electron.ipcRenderer.sendToHost("pane.media-timestamp", payload);
      } catch {
      }
      try {
        electron.ipcRenderer.send("pane.media-timestamp", payload);
      } catch {
      }
    }
  };
  const tryRestoreMedia = () => {
    const currentHref = window.location.href;
    if (lastRestoredUrl !== currentHref) {
      lastRestoredUrl = currentHref;
      hasRestoredMedia = false;
    }
    if (hasRestoredMedia) return;
    if (/[?&#]t=\d+/.test(currentHref)) {
      hasRestoredMedia = true;
      return;
    }
    let savedTime = 0;
    try {
      const stored = sessionStorage.getItem(getMediaStorageKey());
      if (stored) savedTime = parseFloat(stored);
    } catch {
    }
    if (savedTime < 5) return;
    const mediaList = Array.from(
      document.querySelectorAll("video, audio")
    );
    const primary = mediaList.find((m) => isEligibleMedia(m));
    if (primary && primary.currentTime < 3 && isFinite(primary.duration)) {
      if (savedTime <= primary.duration - 5) {
        try {
          primary.currentTime = savedTime;
          hasRestoredMedia = true;
        } catch {
        }
      }
    }
  };
  window.addEventListener(
    "play",
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        electron.ipcRenderer.send("pane.media-playing", true);
        tryRestoreMedia();
        syncMediaTimestamp(true);
      }
    },
    true
  );
  window.addEventListener(
    "pause",
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        const anyPlaying = Array.from(
          document.querySelectorAll("video, audio")
        ).some(
          (m) => !m.paused && !m.ended && m.currentTime > 0 && !m.muted
        );
        electron.ipcRenderer.send("pane.media-playing", anyPlaying);
        syncMediaTimestamp(true);
      }
    },
    true
  );
  window.addEventListener(
    "ended",
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        const anyPlaying = Array.from(
          document.querySelectorAll("video, audio")
        ).some(
          (m) => !m.paused && !m.ended && m.currentTime > 0 && !m.muted
        );
        electron.ipcRenderer.send("pane.media-playing", anyPlaying);
        syncMediaTimestamp(true);
      }
    },
    true
  );
  window.addEventListener("loadedmetadata", tryRestoreMedia, true);
  window.addEventListener("canplay", tryRestoreMedia, true);
  window.addEventListener(
    "timeupdate",
    (e) => {
      if (e.target instanceof HTMLMediaElement && isEligibleMedia(e.target)) {
        syncMediaTimestamp(false);
      }
    },
    { passive: true, capture: true }
  );
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncMediaTimestamp(true);
  });
  window.addEventListener("pagehide", () => syncMediaTimestamp(true));
  window.addEventListener("beforeunload", () => syncMediaTimestamp(true));
}
function initScrollContinuity() {
  let lastScrollSyncAt = 0;
  let hasRestoredScroll = false;
  let lastRestoredUrl = "";
  const getScrollStorageKey = () => `apposition:last-scroll-y:${window.location.pathname}${window.location.search}`;
  const syncScrollPosition = (force = false) => {
    const now = Date.now();
    if (!force && now - lastScrollSyncAt < 2e3) return;
    lastScrollSyncAt = now;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    try {
      if (scrollY > 0) {
        sessionStorage.setItem(getScrollStorageKey(), String(scrollY));
      }
    } catch {
    }
    const payload = { scrollY, url: window.location.href };
    try {
      electron.ipcRenderer.sendToHost("pane.scroll-position", payload);
    } catch {
    }
    try {
      electron.ipcRenderer.send("pane.scroll-position", payload);
    } catch {
    }
  };
  const tryRestoreScroll = () => {
    const currentHref = window.location.href;
    if (lastRestoredUrl !== currentHref) {
      lastRestoredUrl = currentHref;
      hasRestoredScroll = false;
    }
    if (hasRestoredScroll) return;
    let savedScrollY = 0;
    try {
      const stored = sessionStorage.getItem(getScrollStorageKey());
      if (stored) savedScrollY = parseFloat(stored);
    } catch {
    }
    if (savedScrollY > 10) {
      window.scrollTo({ top: savedScrollY, behavior: "instant" });
      hasRestoredScroll = true;
      setTimeout(() => {
        if (window.scrollY < 10) {
          window.scrollTo({ top: savedScrollY, behavior: "instant" });
        }
      }, 300);
    }
  };
  window.addEventListener("scroll", () => syncScrollPosition(false), { passive: true });
  window.addEventListener("DOMContentLoaded", tryRestoreScroll);
  window.addEventListener("load", tryRestoreScroll);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") syncScrollPosition(true);
  });
  window.addEventListener("pagehide", () => syncScrollPosition(true));
  window.addEventListener("beforeunload", () => syncScrollPosition(true));
}
try {
  electron.webFrame.executeJavaScript(`(function() {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
        configurable: true,
        enumerable: true
      });
    } catch {}

    try {
      if (!navigator.plugins || navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: 'Native Client Executable' }
          ],
          configurable: true,
          enumerable: true
        });
      }
    } catch {}

    try {
      if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
          configurable: true,
          enumerable: true
        });
      }
    } catch {}

    try {
      if (!window.chrome) (window).chrome = {};
      if (!window.chrome.runtime) (window).chrome.runtime = {};
      if (!window.chrome.csi) {
        window.chrome.csi = function() {
          return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 };
        };
      }
      if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = function() {
          return {
            commitLoadTime: Date.now() / 1000,
            connectionInfo: 'h2',
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: Date.now() / 1000 - 0.16,
            startLoadTime: Date.now() / 1000 - 0.3,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true
          };
        };
      }
    } catch {}

    try {
      if (window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
        PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
      }
    } catch {}
  })();`);
} catch {
}
try {
  let isInputFocused = false;
  window.addEventListener(
    "focusin",
    (e) => {
      const target = e.target;
      if (target) {
        const tag = target.tagName;
        const isContentEditable = target.isContentEditable || target.getAttribute("contenteditable") === "true";
        isInputFocused = tag === "INPUT" || tag === "TEXTAREA" || isContentEditable;
        electron.ipcRenderer.send("pane.focus-change", isInputFocused);
      }
    },
    { passive: true }
  );
  window.addEventListener(
    "focusout",
    () => {
      isInputFocused = false;
      electron.ipcRenderer.send("pane.focus-change", false);
    },
    { passive: true }
  );
  window.addEventListener(
    "mousedown",
    () => {
      electron.ipcRenderer.send("pane.clicked");
    },
    { passive: true }
  );
  initMediaContinuity();
  initScrollContinuity();
  try {
    class ProxiedNotification extends EventTarget {
      static permission = "granted";
      static requestPermission(callback) {
        if (callback) callback("granted");
        return Promise.resolve("granted");
      }
      title;
      body;
      icon;
      constructor(title, options = {}) {
        super();
        this.title = title;
        this.body = options.body || "";
        this.icon = options.icon || "";
        electron.ipcRenderer.send("pane.notification-posted", {
          title,
          body: options.body || "",
          icon: options.icon || ""
        });
      }
      close() {
      }
    }
    window.Notification = ProxiedNotification;
  } catch {
  }
} catch {
}
