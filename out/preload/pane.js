"use strict";
const electron = require("electron");
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
  window.addEventListener(
    "play",
    (e) => {
      if (e.target instanceof HTMLMediaElement) {
        electron.ipcRenderer.send("pane.media-playing", true);
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
      }
    },
    true
  );
  electron.webFrame.insertCSS(`
    html, body {
      -webkit-font-smoothing: antialiased !important;
    }
    ::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }
  `);
} catch {
}
