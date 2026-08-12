"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("pane", {
  ping: () => electron.ipcRenderer.invoke("pane.ping")
});
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
console.error = (...args) => {
  electron.ipcRenderer.send("pane.log", "ERROR", ...args);
  originalConsoleError.apply(console, args);
};
console.warn = (...args) => {
  electron.ipcRenderer.send("pane.log", "WARN", ...args);
  originalConsoleWarn.apply(console, args);
};
let isInputFocused = false;
window.addEventListener("focusin", (e) => {
  const target = e.target;
  if (target) {
    const tag = target.tagName;
    const isContentEditable = target.isContentEditable || target.getAttribute("contenteditable") === "true";
    isInputFocused = tag === "INPUT" || tag === "TEXTAREA" || isContentEditable;
    electron.ipcRenderer.send("pane.focus-change", isInputFocused);
  }
});
window.addEventListener("focusout", () => {
  isInputFocused = false;
  electron.ipcRenderer.send("pane.focus-change", false);
});
window.addEventListener("mousedown", () => {
  electron.ipcRenderer.send("pane.clicked");
});
electron.webFrame.insertCSS(`
  :root { --app-bg-color: #F7F7F5; }
  @media (prefers-color-scheme: dark) { :root { --app-bg-color: #171717; } }
  html, body {
    -webkit-font-smoothing: antialiased !important;
    -webkit-text-stroke: 0.15px rgba(0, 0, 0, 0.2) !important;
  }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  html::after {
    content: "" !important;
    position: fixed !important;
    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    background-image: 
      radial-gradient(circle at 100% 100%, transparent 11.5px, var(--app-bg-color) 12px),
      radial-gradient(circle at 0% 100%, transparent 11.5px, var(--app-bg-color) 12px),
      radial-gradient(circle at 100% 0%, transparent 11.5px, var(--app-bg-color) 12px),
      radial-gradient(circle at 0% 0%, transparent 11.5px, var(--app-bg-color) 12px) !important;
    background-position: top left, top right, bottom left, bottom right !important;
    background-size: 12px 12px !important;
    background-repeat: no-repeat !important;
  }
`);
