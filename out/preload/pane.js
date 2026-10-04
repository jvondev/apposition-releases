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
  const getMediaStorageKey = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("t");
      return `apposition:last-media-time:${url.pathname}${url.search}`;
    } catch {
      return `apposition:last-media-time:${window.location.pathname}${window.location.search}`;
    }
  };
  const getStoredTime = () => {
    try {
      const key = getMediaStorageKey();
      const val = localStorage.getItem(key) || sessionStorage.getItem(key);
      return val ? parseFloat(val) : 0;
    } catch {
      return 0;
    }
  };
  const setStoredTime = (time) => {
    try {
      const key = getMediaStorageKey();
      if (time > 0) {
        localStorage.setItem(key, String(time));
        sessionStorage.setItem(key, String(time));
      } else {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      }
    } catch {
    }
  };
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
      if (t < 5 && !hasRestoredMedia) {
        return;
      }
      const isEnd = t >= dur - 5;
      const validTime = !isEnd && t >= 5 ? t : 0;
      if (isEnd) {
        setStoredTime(0);
      } else if (validTime > 0) {
        setStoredTime(validTime);
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
    const savedTime = getStoredTime();
    if (savedTime < 5) return;
    const isYouTube = window.location.hostname.includes("youtube.com");
    if (isYouTube) {
      const moviePlayer = document.getElementById("movie_player") || window.moviePlayer;
      if (moviePlayer && typeof moviePlayer.seekTo === "function" && typeof moviePlayer.getCurrentTime === "function") {
        if (moviePlayer.getCurrentTime() < 3) {
          try {
            moviePlayer.seekTo(savedTime, true);
            hasRestoredMedia = true;
            return;
          } catch {
          }
        }
      }
    }
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
  window.addEventListener("yt-navigate-finish", () => {
    lastRestoredUrl = "";
    hasRestoredMedia = false;
    setTimeout(tryRestoreMedia, 500);
    setTimeout(tryRestoreMedia, 1500);
  });
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
  const handleMediaStop = (e) => {
    if (e.target instanceof HTMLMediaElement) {
      const anyPlaying = Array.from(document.querySelectorAll("video, audio")).some(
        (m) => !m.paused && !m.ended && m.currentTime > 0 && !m.muted
      );
      electron.ipcRenderer.send("pane.media-playing", anyPlaying);
      syncMediaTimestamp(true);
    }
  };
  window.addEventListener("pause", handleMediaStop, true);
  window.addEventListener("ended", handleMediaStop, true);
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
let lastReportedState = null;
let reportTimer = null;
let activeAudioContexts = 0;
let activePeerConnections = 0;
let activeStreamTracks = 0;
function evaluateMediaStatus() {
  try {
    const mediaElements = Array.from(
      document.querySelectorAll("video, audio")
    );
    const hasMedia = mediaElements.length > 0;
    const mediaPlaying = mediaElements.some(
      (m) => !m.paused && !m.ended && m.readyState > 1
    );
    const mediaAudible = mediaElements.some(
      (m) => !m.paused && !m.ended && !m.muted && m.volume > 0.01
    );
    const isPlaying = hasMedia ? mediaPlaying : activeAudioContexts > 0;
    const isAudible = hasMedia ? mediaAudible : activeAudioContexts > 0;
    const hasLiveStream = mediaElements.some(
      (m) => !m.paused && (!isFinite(m.duration) || m.duration <= 0 || m.duration > 86400)
    );
    const hasWebRtc = activePeerConnections > 0 || activeStreamTracks > 0;
    return {
      isPlaying,
      isAudible,
      hasLiveStream,
      hasWebRtc
    };
  } catch {
    return {
      isPlaying: false,
      isAudible: false,
      hasLiveStream: false,
      hasWebRtc: false
    };
  }
}
function scheduleReport(immediate = false) {
  const checkAndEmit = () => {
    reportTimer = null;
    const current = evaluateMediaStatus();
    const hasChanged = !lastReportedState || lastReportedState.isPlaying !== current.isPlaying || lastReportedState.isAudible !== current.isAudible || lastReportedState.hasLiveStream !== current.hasLiveStream || lastReportedState.hasWebRtc !== current.hasWebRtc;
    if (hasChanged) {
      lastReportedState = current;
      try {
        electron.ipcRenderer.send("pane.dynamic-media-status", current);
      } catch {
      }
    }
  };
  if (immediate) {
    if (reportTimer) clearTimeout(reportTimer);
    checkAndEmit();
  } else if (!reportTimer) {
    reportTimer = setTimeout(checkAndEmit, 200);
  }
}
function initMediaSensor() {
  if (typeof window === "undefined") return;
  if (window.self !== window.top) return;
  const immediateEvents = ["play", "playing", "pause", "ended", "volumechange"];
  const throttledEvents = ["timeupdate", "waiting", "canplay"];
  immediateEvents.forEach((ev) => {
    window.addEventListener(ev, () => scheduleReport(true), true);
  });
  throttledEvents.forEach((ev) => {
    window.addEventListener(ev, () => scheduleReport(false), true);
  });
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx && AudioCtx.prototype) {
      const origResume = AudioCtx.prototype.resume;
      const origSuspend = AudioCtx.prototype.suspend;
      const origClose = AudioCtx.prototype.close;
      AudioCtx.prototype.resume = function() {
        if (this.state !== "running") {
          activeAudioContexts = Math.max(1, activeAudioContexts + 1);
          scheduleReport(true);
        }
        return origResume.call(this);
      };
      AudioCtx.prototype.suspend = function() {
        activeAudioContexts = Math.max(0, activeAudioContexts - 1);
        scheduleReport(false);
        return origSuspend.call(this);
      };
      AudioCtx.prototype.close = function() {
        activeAudioContexts = Math.max(0, activeAudioContexts - 1);
        scheduleReport(false);
        return origClose.call(this);
      };
    }
  } catch {
  }
  try {
    const OrigPeerConn = window.RTCPeerConnection || window.webkitRTCPeerConnection;
    if (OrigPeerConn) {
      const PatchedPeerConn = function(...args) {
        const pc = new OrigPeerConn(...args);
        activePeerConnections++;
        scheduleReport(true);
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "closed" || pc.connectionState === "failed") {
            activePeerConnections = Math.max(0, activePeerConnections - 1);
            scheduleReport(true);
          }
        });
        return pc;
      };
      PatchedPeerConn.prototype = OrigPeerConn.prototype;
      const origClose = OrigPeerConn.prototype.close;
      OrigPeerConn.prototype.close = function() {
        activePeerConnections = Math.max(0, activePeerConnections - 1);
        scheduleReport(true);
        return origClose.call(this);
      };
      window.RTCPeerConnection = PatchedPeerConn;
      if (window.webkitRTCPeerConnection) {
        window.webkitRTCPeerConnection = PatchedPeerConn;
      }
    }
  } catch {
  }
  try {
    const md = navigator?.mediaDevices;
    if (md) {
      const trackStream = (stream) => {
        stream.getTracks().forEach((track) => {
          activeStreamTracks++;
          scheduleReport(true);
          track.addEventListener("ended", () => {
            activeStreamTracks = Math.max(0, activeStreamTracks - 1);
            scheduleReport(true);
          }, { once: true });
        });
      };
      if (md.getUserMedia) {
        const origGUM = md.getUserMedia.bind(md);
        md.getUserMedia = async (...args) => {
          const stream = await origGUM(...args);
          trackStream(stream);
          return stream;
        };
      }
      if (md.getDisplayMedia) {
        const origGDM = md.getDisplayMedia.bind(md);
        md.getDisplayMedia = async (...args) => {
          const stream = await origGDM(...args);
          trackStream(stream);
          return stream;
        };
      }
    }
  } catch {
  }
  scheduleReport(true);
}
function initManifestHarvester() {
  try {
    const harvest = () => {
      const url = window.location.href;
      if (!url || !url.startsWith("http")) return;
      let iconUrl = "";
      const appleIcon = document.querySelector(
        'link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]'
      );
      if (appleIcon?.href) {
        iconUrl = appleIcon.href;
      } else {
        const icon = document.querySelector(
          'link[rel="icon"][sizes="192x192"], link[rel="icon"][sizes="512x512"], link[rel="icon"]'
        );
        if (icon?.href) iconUrl = icon.href;
      }
      const ogImage = document.querySelector(
        'meta[property="og:image"]'
      );
      if (!iconUrl && ogImage?.content) {
        iconUrl = ogImage.content;
      }
      const themeColor = document.querySelector(
        'meta[name="theme-color"]'
      )?.content;
      const title = document.querySelector('meta[property="og:site_name"]')?.content || document.title;
      electron.ipcRenderer.send("pane.manifest-harvested", {
        url,
        title,
        iconUrl,
        themeColor
      });
    };
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(harvest, 1500);
    } else {
      window.addEventListener("DOMContentLoaded", () => {
        setTimeout(harvest, 1500);
      });
    }
  } catch (err) {
  }
}
const EMAIL_REGEX = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
function extractGoogleIdentity() {
  const host = window.location.hostname.toLowerCase();
  if (!host.includes("google.") && !host.includes("youtube.com")) return null;
  let email;
  let displayName;
  let avatarUrl;
  try {
    const globals = window.GLOBALS;
    if (Array.isArray(globals)) {
      for (const item of globals) {
        if (typeof item === "string") {
          const m = item.match(EMAIL_REGEX);
          if (m && !m[1].endsWith("@google.com")) {
            email = m[1];
            break;
          }
        }
      }
    }
  } catch {
  }
  if (!email && host.includes("youtube.com")) {
    try {
      const ytcfg = window.ytcfg;
      if (ytcfg && typeof ytcfg.get === "function") {
        const u = ytcfg.get("USER_DISPLAY_NAME") || ytcfg.get("LOGGED_IN_USER");
        if (typeof u === "string" && u.trim()) displayName = u.trim();
      }
      const handleEl = document.querySelector("#channel-handle, ytd-channel-name #text");
      if (handleEl?.textContent?.trim()) {
        const t = handleEl.textContent.trim();
        if (t.startsWith("@")) displayName = t;
      }
    } catch {
    }
  }
  if (!email) {
    const el = document.querySelector(
      'a[aria-label*="@"], div[aria-label*="@"], a[href*="SignOutOptions"], [data-email], #profileIdentifier, div[data-profile-identifier]'
    );
    if (el) {
      const text = el.getAttribute("data-email") || el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "";
      const m = text.match(EMAIL_REGEX);
      if (m && !m[1].endsWith("@google.com")) email = m[1];
    }
  }
  if (!email) {
    const input = document.querySelector('input[type="email"]');
    if (input && input.value && EMAIL_REGEX.test(input.value)) {
      email = input.value.trim();
    }
  }
  const avatarEl = document.querySelector(
    'a[href*="SignOutOptions"] img, img.gb_k, button#avatar-btn img, img[alt*="Google Account"]'
  );
  if (avatarEl?.src) avatarUrl = avatarEl.src;
  if (email || displayName) {
    return {
      providerId: "google",
      email,
      displayName: displayName || email,
      avatarUrl
    };
  }
  return null;
}
function extractGithubIdentity() {
  if (!window.location.hostname.includes("github.com")) return null;
  const meta = document.querySelector('meta[name="user-login"]')?.getAttribute("content") || document.querySelector('meta[name="octolytics-actor-login"]')?.getAttribute("content");
  if (meta && meta.trim()) {
    const handle = `@${meta.trim().replace(/^@/, "")}`;
    const avatar = document.querySelector("img.avatar-user")?.src;
    return {
      providerId: "github",
      handle,
      email: handle,
      displayName: meta.trim(),
      avatarUrl: avatar
    };
  }
  return null;
}
function extractMicrosoftIdentity() {
  const host = window.location.hostname.toLowerCase();
  if (!host.includes("microsoft") && !host.includes("live.com") && !host.includes("office.com")) return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (k.includes("msal") || k.includes("account")) {
        const item = localStorage.getItem(k) || "";
        const m = item.match(EMAIL_REGEX);
        if (m) return { providerId: "microsoft", email: m[1], displayName: m[1] };
      }
    }
  } catch {
  }
  const el = document.querySelector('#mectrl_currentAccount_secondary, [data-test-id="user-email"]');
  if (el) {
    const m = (el.textContent || "").match(EMAIL_REGEX);
    if (m) return { providerId: "microsoft", email: m[1], displayName: m[1] };
  }
  return null;
}
function extractGenericIdentity() {
  return extractGoogleIdentity() || extractGithubIdentity() || extractMicrosoftIdentity();
}
function initIdentityHarvester() {
  try {
    let lastDispatched = "";
    const scanAndDispatch = () => {
      const identity = extractGenericIdentity();
      if (!identity) return;
      const key = `${identity.providerId}:${identity.email || ""}:${identity.handle || ""}`;
      if (key === lastDispatched) return;
      lastDispatched = key;
      electron.ipcRenderer.send("pane.identity-harvested", identity);
    };
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(scanAndDispatch, 1e3);
    } else {
      window.addEventListener("DOMContentLoaded", () => setTimeout(scanAndDispatch, 1e3), { once: true });
    }
    window.addEventListener("load", () => setTimeout(scanAndDispatch, 1500), { once: true });
  } catch {
  }
}
const GENERIC_NOISE = /* @__PURE__ */ new Set([
  "home",
  "dashboard",
  "overview",
  "welcome",
  "log in",
  "login",
  "sign in",
  "signin",
  "sign up",
  "signup",
  "app",
  "menu",
  "navigation",
  "back",
  "cancel",
  "search",
  "loading",
  "untitled",
  "new tab"
]);
function cleanCandidate(text) {
  if (!text) return "";
  const unreadCleaned = text.replace(/^\s*(\(\d+[\d,.]*\)|\[\d+[\d,.]*\]|[•*🔴])\s*/, "");
  const collapsed = unreadCleaned.replace(/\s+/g, " ").trim();
  if (collapsed.length < 2 || collapsed.length > 70) return "";
  if (GENERIC_NOISE.has(collapsed.toLowerCase())) return "";
  if (/^\d+$/.test(collapsed)) return "";
  if (/^[a-f0-9-]{8,}$/i.test(collapsed)) return "";
  return collapsed;
}
function probeActiveNavigation() {
  const selectors = [
    'nav [aria-current="page"]',
    'aside [aria-current="page"]',
    '[role="navigation"] [aria-current="page"]',
    '[aria-current="page"]',
    '[aria-current="location"]',
    'nav [aria-selected="true"]',
    'aside [aria-selected="true"]',
    '[role="tree"] [aria-selected="true"]',
    'aside [class*="selected"]',
    'aside [class*="active"]',
    'nav [class*="selected"]',
    'nav [class*="active"]',
    '[class*="sidebar"] [class*="selected"]',
    '[class*="sidebar"] [class*="active"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = cleanCandidate(el.innerText || el.textContent || "");
      if (text && text.length >= 2 && text.length <= 40) return text;
    }
  }
  return "";
}
function probeDocumentTitleInput() {
  const inputSelectors = [
    "#docs-title-widget input",
    'input[aria-label*="Document title" i]',
    'input[aria-label*="Board title" i]',
    'input[aria-label*="Board name" i]',
    'input[aria-label*="File name" i]',
    'input[data-testid*="title" i]',
    'input[data-testid*="board-title" i]',
    'input[data-testid*="file-title" i]',
    '[contenteditable][role="heading"]',
    'h1[contenteditable="true"]',
    '[data-content-editable-leaf="true"]'
  ];
  for (const sel of inputSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const val = el instanceof HTMLInputElement ? el.value : el.innerText || el.textContent || "";
      const text = cleanCandidate(val);
      if (text) return text;
    }
  }
  return "";
}
function probeHeading() {
  const headingSelectors = [
    'h1:not([aria-hidden="true"])',
    '[role="heading"][aria-level="1"]:not([aria-hidden="true"])',
    "h2.hP",
    '[data-testid="issue-title"]'
  ];
  for (const sel of headingSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = cleanCandidate(el.innerText || el.textContent || "");
      if (text) return text;
    }
  }
  return "";
}
function harvestSemanticTitle() {
  try {
    const docTitle = probeDocumentTitleInput();
    if (docTitle) return docTitle;
    const navItem = probeActiveNavigation();
    if (navItem) return navItem;
    const heading = probeHeading();
    if (heading) return heading;
    const docTitleEl = cleanCandidate(document.title);
    if (docTitleEl) return docTitleEl;
  } catch {
  }
  return "";
}
function initSemanticTitleHarvester() {
  try {
    let lastDispatched = "";
    const scanAndDispatch = () => {
      const title = harvestSemanticTitle();
      if (!title || title === lastDispatched) return;
      lastDispatched = title;
      electron.ipcRenderer.send("pane.semantic-title", { title, confidence: 1 });
    };
    if (document.readyState === "complete" || document.readyState === "interactive") {
      setTimeout(scanAndDispatch, 600);
      setTimeout(scanAndDispatch, 1800);
    } else {
      window.addEventListener("DOMContentLoaded", () => setTimeout(scanAndDispatch, 600), {
        once: true
      });
      window.addEventListener("load", () => setTimeout(scanAndDispatch, 1500), { once: true });
    }
    let debounceTimer = null;
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanAndDispatch, 400);
    });
    const titleEl = document.querySelector("title");
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    } else if (document.head) {
      observer.observe(document.head, { childList: true, subtree: true });
    }
    window.addEventListener("popstate", () => setTimeout(scanAndDispatch, 400), { passive: true });
    window.addEventListener("hashchange", () => setTimeout(scanAndDispatch, 400), {
      passive: true
    });
  } catch {
  }
}
const APP_MENU_SELECTORS = [
  ":popover-open",
  "dialog[open]",
  "[role='menu']",
  "[role='listbox']",
  "[role='dialog']",
  "[data-radix-popper-content-wrapper]",
  ".goog-menu",
  ".docs-material-menu",
  ".monaco-menu-container",
  ".ytp-contextmenu",
  ".ytp-popup",
  ".vjs-contextmenu",
  ".figma-menu",
  ".context-menu",
  ".contextMenu",
  ".dropdown-menu",
  "[data-menu-container]"
].join(",");
function isAnyMenuVisible() {
  try {
    const list = document.querySelectorAll(APP_MENU_SELECTORS);
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const visible = typeof el.checkVisibility === "function" ? el.checkVisibility() : el.offsetParent !== null || el.offsetWidth > 0;
      if (visible) return true;
    }
  } catch {
  }
  return false;
}
let probeInstalled = false;
function initPaneContextMenuProbe() {
  if (probeInstalled) return;
  probeInstalled = true;
  window.addEventListener(
    "contextmenu",
    (ev) => {
      const shiftKey = ev.shiftKey;
      const path = typeof ev.composedPath === "function" ? ev.composedPath() : [];
      const target = path[0] || ev.target;
      let linkEl = null;
      let imgEl = null;
      let isVideoOrPlayer = false;
      let isCanvas = false;
      let isAppSurface = false;
      let isEditable = false;
      let clickedInsideMenu = false;
      for (const node of path) {
        if (!(node instanceof HTMLElement || node instanceof SVGElement)) continue;
        if (!linkEl && node instanceof HTMLAnchorElement && node.href) linkEl = node;
        if (!imgEl && node instanceof HTMLImageElement && node.src) imgEl = node;
        if (!isVideoOrPlayer && (node instanceof HTMLVideoElement || node instanceof HTMLAudioElement || node.matches?.(
          "video, audio, .html5-video-player, ytd-player, .ytp-player-content, .ytp-cued-thumbnail-overlay, [data-player], .vjs-tech, .plyr"
        ))) {
          isVideoOrPlayer = true;
        }
        if (!isCanvas && (node instanceof HTMLCanvasElement || node.matches?.("canvas, .figma-canvas, [data-canvas]"))) {
          isCanvas = true;
        }
        if (!isAppSurface && node.matches?.(
          "[role='application'], .docs-editor, .kix-appview, .kix-canvas-tile-content, .monaco-editor, [data-lexical-editor], .notion-page-content"
        )) {
          isAppSurface = true;
        }
        if (!clickedInsideMenu && node.matches?.(
          "[role='menu'], [role='menuitem'], .ytp-contextmenu, .ytp-popup, .figma-menu, .context-menu, .dropdown-menu, dialog[open]"
        )) {
          clickedInsideMenu = true;
        }
        if (!isEditable && node instanceof HTMLElement && (node.isContentEditable || node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
          isEditable = true;
        }
      }
      const selection = window.getSelection()?.toString().trim() || "";
      const menuAlreadyOpen = clickedInsideMenu || isAnyMenuVisible();
      queueMicrotask(() => {
        const isPrevented = ev.defaultPrevented;
        if (shiftKey) {
          electron.ipcRenderer.send("guest:context-probe", {
            classification: "FORCE_OVERRIDE",
            linkURL: linkEl?.href || "",
            srcURL: imgEl?.src || "",
            selectionText: selection,
            targetTag: target?.tagName || "",
            isCanvas,
            isVideoOrPlayer,
            isAppSurface,
            isEditable
          });
          return;
        }
        const menuNowOpen = isAnyMenuVisible();
        const hasActiveMenu = menuAlreadyOpen || menuNowOpen;
        const isInteractiveApp = isCanvas || isVideoOrPlayer || isAppSurface || hasActiveMenu || isPrevented;
        const classification = isInteractiveApp ? "APP_ACTIVE" : "STANDARD";
        electron.ipcRenderer.send("guest:context-probe", {
          classification,
          linkURL: linkEl?.href || "",
          srcURL: imgEl?.src || "",
          selectionText: selection,
          targetTag: target?.tagName || "",
          isCanvas,
          isVideoOrPlayer,
          isAppSurface,
          hasAriaMenu: hasActiveMenu,
          isMenuAlreadyOpen: menuAlreadyOpen,
          isEditable
        });
      });
    },
    { capture: true, passive: false }
  );
}
function resolveAnchor(e) {
  const target = e.target;
  if (!target) return null;
  const directAnchor = target.closest?.("a[href]");
  if (directAnchor?.href) return directAnchor;
  if (typeof e.composedPath === "function") {
    const path = e.composedPath();
    for (const node of path) {
      if (node?.tagName === "A" && node?.href) {
        return node;
      }
    }
  }
  return null;
}
function isValidWebUrl(href) {
  if (!href) return false;
  const lower = href.trim().toLowerCase();
  if (lower.startsWith("javascript:") || lower === "#" || lower.startsWith("about:blank") || lower.startsWith("data:") || lower.startsWith("file:") || lower.startsWith("blob:")) {
    return false;
  }
  const currentBase = window.location.href.split("#")[0];
  if (href.startsWith(currentBase + "#")) {
    return false;
  }
  return true;
}
function initPaneLinkIntentProbe() {
  const handlePointerIntent = (e) => {
    const isModifierLeftClick = e.button === 0 && (e.ctrlKey || e.metaKey);
    const isMiddleClick = e.button === 1;
    if (!isModifierLeftClick && !isMiddleClick) return;
    const anchor = resolveAnchor(e);
    if (!anchor || !isValidWebUrl(anchor.href)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    electron.ipcRenderer.send("pane:link-intent", {
      url: anchor.href,
      isBackground: !e.shiftKey,
      disposition: "split-or-tab"
    });
  };
  window.addEventListener("click", handlePointerIntent, {
    capture: true,
    passive: false
  });
  window.addEventListener("auxclick", handlePointerIntent, {
    capture: true,
    passive: false
  });
}
const SENSITIVE_KEYWORDS = /password|passcode|token|pin|secret|cvv|cvc|cardnumber|ssn/i;
const SENSITIVE_AUTOCOMPLETE = ["current-password", "new-password", "cc-number", "cc-csc", "one-time-code"];
function isSensitiveField(type, name, autocomplete, placeholder, ariaLabel) {
  if (type === "password") return true;
  if (name && SENSITIVE_KEYWORDS.test(name)) return true;
  if (placeholder && SENSITIVE_KEYWORDS.test(placeholder)) return true;
  if (ariaLabel && SENSITIVE_KEYWORDS.test(ariaLabel)) return true;
  if (autocomplete && SENSITIVE_AUTOCOMPLETE.includes(autocomplete.toLowerCase())) return true;
  return false;
}
function safeCssEscape(str) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(str);
  }
  return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}
function getElementSelector(el) {
  if (el.id) return `#${safeCssEscape(el.id)}`;
  const name = el.getAttribute("name");
  if (name) return `${el.tagName.toLowerCase()}[name="${safeCssEscape(name)}"]`;
  let path = el.tagName.toLowerCase();
  let parent = el.parentElement;
  let current = el;
  while (parent && parent !== document.body && parent !== document.documentElement) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
    if (siblings.length > 1) {
      const idx = siblings.indexOf(current) + 1;
      path = `${parent.tagName.toLowerCase()} > ${current.tagName.toLowerCase()}:nth-of-type(${idx})`;
    } else {
      path = `${parent.tagName.toLowerCase()} > ${current.tagName.toLowerCase()}`;
    }
    current = parent;
    parent = parent.parentElement;
    if (path.length > 80) break;
  }
  return path;
}
function serializeShadowState(doc = document, win = window, observedScrollers) {
  const forms = [];
  const scrollContainers = [];
  const elements = doc.querySelectorAll(
    "input, textarea, select, [contenteditable='true']"
  );
  elements.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.type?.toLowerCase() || tag;
    const name = el.getAttribute("name") || void 0;
    const autocomplete = el.getAttribute("autocomplete") || void 0;
    const placeholder = el.getAttribute("placeholder") || void 0;
    const ariaLabel = el.getAttribute("aria-label") || void 0;
    if (isSensitiveField(type, name, autocomplete, placeholder, ariaLabel)) return;
    if (type === "hidden" || type === "button" || type === "submit" || type === "file") return;
    const selector = getElementSelector(el);
    if (tag === "input") {
      const input = el;
      if (type === "checkbox" || type === "radio") {
        forms.push({ selector, name, id: el.id || void 0, type, value: input.value, checked: input.checked });
      } else {
        if (input.value) {
          forms.push({ selector, name, id: el.id || void 0, type, value: input.value });
        }
      }
    } else if (tag === "textarea") {
      const textarea = el;
      if (textarea.value) {
        forms.push({ selector, name, id: el.id || void 0, type: "textarea", value: textarea.value });
      }
    } else if (tag === "select") {
      const select = el;
      forms.push({ selector, name, id: el.id || void 0, type: "select", value: select.value });
    } else if (el.getAttribute("contenteditable") === "true") {
      const html = el.innerHTML;
      if (html && html.trim().length > 0) {
        forms.push({ selector, id: el.id || void 0, type: "contenteditable", value: html });
      }
    }
  });
  const scrollers = observedScrollers ? Array.from(observedScrollers) : Array.from(doc.querySelectorAll("main, article, [role='main'], [style*='overflow'], [class*='overflow']"));
  scrollers.forEach((el) => {
    if (el.scrollTop > 5 || el.scrollLeft > 5) {
      scrollContainers.push({
        selector: getElementSelector(el),
        scrollLeft: Math.round(el.scrollLeft),
        scrollTop: Math.round(el.scrollTop)
      });
    }
  });
  let activeElement;
  const active = doc.activeElement;
  if (active && active !== doc.body && active !== doc.documentElement) {
    const selector = getElementSelector(active);
    let selectionStart;
    let selectionEnd;
    if ("selectionStart" in active && typeof active.selectionStart === "number") {
      selectionStart = active.selectionStart ?? void 0;
      selectionEnd = active.selectionEnd ?? void 0;
    }
    activeElement = { selector, selectionStart, selectionEnd };
  }
  return {
    url: win.location.href,
    title: doc.title,
    timestamp: Date.now(),
    windowScroll: {
      x: Math.round(win.scrollX || doc.documentElement.scrollLeft || 0),
      y: Math.round(win.scrollY || doc.documentElement.scrollTop || 0)
    },
    forms,
    scrollContainers,
    activeElement
  };
}
function findElement(form, doc) {
  if (form.id) {
    const el = doc.getElementById(form.id);
    if (el) return el;
  }
  if (form.name) {
    const el = doc.querySelector(`[name="${safeCssEscape(form.name)}"]`);
    if (el) return el;
  }
  if (form.selector) {
    try {
      const el = doc.querySelector(form.selector);
      if (el) return el;
    } catch {
    }
  }
  return null;
}
function dispatchInputEvents(el) {
  try {
    el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  } catch {
  }
}
function rehydrateShadowState(snapshot, doc = document, win = window) {
  if (!snapshot) return false;
  for (const form of snapshot.forms) {
    const el = findElement(form, doc);
    if (!el) continue;
    if (form.type === "checkbox" || form.type === "radio") {
      const input = el;
      if (typeof form.checked === "boolean") {
        input.checked = form.checked;
        dispatchInputEvents(input);
      }
    } else if (form.type === "textarea" || form.type === "select" || el.tagName === "INPUT") {
      const input = el;
      if (form.value !== void 0) {
        input.value = form.value;
        dispatchInputEvents(input);
      }
    } else if (form.type === "contenteditable") {
      if (form.value && typeof form.value === "string") {
        el.innerHTML = form.value;
        dispatchInputEvents(el);
      }
    }
  }
  for (const sc of snapshot.scrollContainers) {
    try {
      const el = doc.querySelector(sc.selector);
      if (el) {
        el.scrollLeft = sc.scrollLeft;
        el.scrollTop = sc.scrollTop;
      }
    } catch {
    }
  }
  if (snapshot.windowScroll && (snapshot.windowScroll.x > 0 || snapshot.windowScroll.y > 0)) {
    try {
      win.scrollTo({
        left: snapshot.windowScroll.x,
        top: snapshot.windowScroll.y,
        behavior: "instant"
      });
    } catch {
    }
  }
  if (snapshot.activeElement) {
    try {
      const el = doc.querySelector(snapshot.activeElement.selector);
      if (el && typeof el.focus === "function") {
        el.focus();
        if ("setSelectionRange" in el && typeof snapshot.activeElement.selectionStart === "number" && typeof snapshot.activeElement.selectionEnd === "number") {
          el.setSelectionRange(
            snapshot.activeElement.selectionStart,
            snapshot.activeElement.selectionEnd
          );
        }
      }
    } catch {
    }
  }
  return true;
}
function initShadowStateVault() {
  let hasRestored = false;
  let saveTimer = null;
  const scrolledElements = /* @__PURE__ */ new Set();
  window.addEventListener(
    "scroll",
    (e) => {
      const target = e.target;
      if (target && target instanceof HTMLElement && target !== document.body && target !== document.documentElement) {
        scrolledElements.add(target);
      }
    },
    { passive: true, capture: true }
  );
  const saveCurrentShadowState = () => {
    try {
      const snapshot = serializeShadowState(document, window, scrolledElements);
      electron.ipcRenderer.send("vault:save-shadow-state", snapshot);
    } catch {
    }
  };
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveCurrentShadowState();
    }, 1e3);
  };
  const tryRestoreShadowState = async () => {
    if (hasRestored) return;
    try {
      const snapshot = await electron.ipcRenderer.invoke("vault:get-shadow-state");
      if (snapshot && snapshot.url === window.location.href) {
        rehydrateShadowState(snapshot, document, window);
        hasRestored = true;
      }
    } catch {
    }
  };
  window.addEventListener("input", debouncedSave, { passive: true });
  window.addEventListener("change", debouncedSave, { passive: true });
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveCurrentShadowState();
  });
  window.addEventListener("pagehide", saveCurrentShadowState);
  window.addEventListener("beforeunload", saveCurrentShadowState);
  if (document.readyState === "complete" || document.readyState === "interactive") {
    tryRestoreShadowState();
  } else {
    window.addEventListener("DOMContentLoaded", tryRestoreShadowState, { once: true });
    window.addEventListener("load", tryRestoreShadowState, { once: true });
  }
  electron.ipcRenderer.on("vault:capture-state", (_event, replyChannel) => {
    try {
      const snapshot = serializeShadowState(document, window);
      electron.ipcRenderer.send(replyChannel || "vault:capture-state-reply", snapshot);
    } catch {
    }
  });
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

    try {
      Document.prototype.hasFocus = function() {
        return true;
      };
      window.addEventListener(
        "blur",
        function(e) {
          if (e.target === window) {
            e.stopImmediatePropagation();
          }
        },
        true
      );
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
  initMediaSensor();
  initShadowStateVault();
  initManifestHarvester();
  initIdentityHarvester();
  initSemanticTitleHarvester();
  initPaneContextMenuProbe();
  initPaneLinkIntentProbe();
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
