import { c as createSignal, i as insert, a as createComponent, S as Show, b as createRenderEffect, s as setAttribute, l as layoutStore, d as setLayoutStore, m as memo, t as template, e as delegateEvents, F as For, W as WorkspaceIcon, f as createEffect, A as AppIcon, g as getAppNameFromUrl, h as appDirectory, j as addEventListener, k as setStyleProperty, o as onMount, P as ProfileForm, n as activeShortcuts, p as className, q as saveShortcut, r as onCleanup, u as style, v as use, w as Portal } from "./index-C9c2TOTm.js";
var _tmpl$$6 = /* @__PURE__ */ template(`<img class="w-20 h-20 rounded-full border-4 border-white shadow-sm object-cover">`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class="absolute -bottom-2 -right-2 bg-neutral-900 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border-2 border-white shadow-sm flex items-center gap-1"><svg width=10 height=10 viewBox="0 0 24 24"fill=currentColor class=text-yellow-400><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>PRO`), _tmpl$3$6 = /* @__PURE__ */ template(`<span class="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm"><span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Active`), _tmpl$4$3 = /* @__PURE__ */ template(`<div class=space-y-2><div class="flex items-center justify-between"><span class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">License Key</span><div class="flex items-center gap-2"><button class="text-[10px] font-semibold text-neutral-400 hover:text-neutral-700 transition-colors">Refresh Status</button><span class=text-neutral-300>·</span><button class="text-[10px] font-semibold text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"></button></div></div><div class="flex items-center justify-between bg-white rounded-lg border border-neutral-200 p-3 shadow-sm"><span class="font-mono text-sm font-medium text-neutral-700"></span><button class="text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 px-3 py-1.5 rounded-md transition-colors">Copy`), _tmpl$5$2 = /* @__PURE__ */ template(`<div class="p-2.5 bg-amber-50/80 border border-amber-200/60 rounded-lg text-amber-800 text-[11px] flex items-center justify-between"><div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span><span>Offline Mode (7-Day Grace Lease)</span></div><span class="text-amber-700/80 text-[10px] font-mono">`), _tmpl$6$2 = /* @__PURE__ */ template(`<div class="pt-2 flex justify-between items-center text-sm"><span class=text-neutral-500>Renewal Date</span><span class="text-neutral-900 font-medium">`), _tmpl$7$2 = /* @__PURE__ */ template(`<div class="pt-4 text-center"><p class="text-sm text-neutral-500 mb-4">Upgrade to unlock unlimited workspaces, tabs, and incognito profiles.</p><button class="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg shadow-sm transition-colors">Upgrade to Pro`), _tmpl$8$2 = /* @__PURE__ */ template(`<div class="max-w-md mx-auto"><div class="flex flex-col items-center justify-center space-y-4 py-6"><div class=relative></div><div class=text-center><h3 class="text-lg font-semibold text-neutral-900"></h3><p class="text-sm text-neutral-500"></p></div></div><div class="mt-4 bg-neutral-50 border border-neutral-200/60 rounded-[16px] p-5 space-y-5"><div class="flex items-center justify-between pb-4 border-b border-neutral-200"><span class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Subscription</span></div></div><div class="mt-4 bg-neutral-50 border border-neutral-200/60 rounded-[16px] p-5 space-y-5"><div class="flex items-center justify-between"><span class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Application Updates</span><button class="text-xs font-medium text-neutral-600 bg-white border border-neutral-200 px-3 py-1.5 rounded-md shadow-sm hover:bg-neutral-50 transition-colors cursor-pointer">Check for Updates`), _tmpl$9$1 = /* @__PURE__ */ template(`<div class="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center border-4 border-white shadow-sm"><svg width=32 height=32 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 class=text-neutral-900><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx=12 cy=7 r=4>`), _tmpl$0 = /* @__PURE__ */ template(`<span class="text-xs font-medium text-neutral-600 bg-white border border-neutral-200 px-2.5 py-1 rounded-md shadow-sm">Free Plan`);
function AccountTab(props) {
  const [deactivating, setDeactivating] = createSignal(false);
  const handleDeactivate = async () => {
    if (!confirm("Deactivate license on this machine? This releases your seat for another device.")) return;
    setDeactivating(true);
    try {
      await window.api?.deactivateLicenseKey?.();
      setLayoutStore("isPremium", false);
      setLayoutStore("licenseState", null);
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "License seat released.",
          type: "success"
        }
      }));
    } catch {
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "Failed to deactivate license.",
          type: "error"
        }
      }));
    } finally {
      setDeactivating(false);
    }
  };
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium"
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };
  const handleCheckUpdates = async () => {
    window.dispatchEvent(new CustomEvent("app:toast", {
      detail: {
        message: "Checking for updates...",
        type: "success"
      }
    }));
    try {
      const res = await window.api?.checkForUpdates?.();
      if (res && !res.success) throw new Error();
    } catch {
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "Update check failed",
          type: "error"
        }
      }));
    }
  };
  return (() => {
    var _el$ = _tmpl$8$2(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$6 = _el$3.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$2.nextSibling, _el$0 = _el$9.firstChild;
    _el$0.firstChild;
    var _el$30 = _el$9.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.firstChild, _el$33 = _el$32.nextSibling;
    insert(_el$3, createComponent(Show, {
      get when() {
        return layoutStore.licenseState?.customer?.avatar_url;
      },
      get fallback() {
        return _tmpl$9$1();
      },
      get children() {
        var _el$4 = _tmpl$$6();
        createRenderEffect(() => setAttribute(_el$4, "src", layoutStore.licenseState?.customer?.avatar_url));
        return _el$4;
      }
    }), null);
    insert(_el$3, createComponent(Show, {
      get when() {
        return layoutStore.isPremium;
      },
      get children() {
        return _tmpl$2$6();
      }
    }), null);
    insert(_el$7, () => layoutStore.licenseState?.customer?.name || "Local Profile");
    insert(_el$8, () => layoutStore.licenseState?.customer?.email || "No connected email");
    insert(_el$0, createComponent(Show, {
      get when() {
        return layoutStore.isPremium;
      },
      get fallback() {
        return _tmpl$0();
      },
      get children() {
        return _tmpl$3$6();
      }
    }), null);
    insert(_el$9, createComponent(Show, {
      get when() {
        return layoutStore.licenseState?.key;
      },
      get children() {
        return [(() => {
          var _el$11 = _tmpl$4$3(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$16.nextSibling, _el$18 = _el$12.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling;
          _el$15.$$click = async () => {
            const key = layoutStore.licenseState?.key;
            if (key) {
              const res = await window.api?.validateLicenseKey(key);
              const isPrem = await window.api?.checkPremiumStatus?.();
              setLayoutStore("isPremium", Boolean(isPrem));
              const state = await window.api?.getLicenseState?.();
              setLayoutStore("licenseState", state);
              if (!res?.success) {
                window.dispatchEvent(new CustomEvent("app:toast", {
                  detail: {
                    message: res?.error || "License is inactive",
                    type: "error"
                  }
                }));
              } else {
                window.dispatchEvent(new CustomEvent("app:toast", {
                  detail: {
                    message: "License validated.",
                    type: "success"
                  }
                }));
              }
            }
          };
          _el$17.$$click = handleDeactivate;
          insert(_el$17, () => deactivating() ? "Releasing..." : "Deactivate Seat");
          insert(_el$19, () => (layoutStore.licenseState?.key || "").replace(/^(.{8}).*(.{4})$/, "$1-****-****-$2"));
          _el$20.$$click = () => {
            if (layoutStore.licenseState?.key) navigator.clipboard.writeText(layoutStore.licenseState.key);
          };
          createRenderEffect(() => _el$17.disabled = deactivating());
          return _el$11;
        })(), createComponent(Show, {
          get when() {
            return layoutStore.licenseState?.isGracePeriod;
          },
          get children() {
            var _el$21 = _tmpl$5$2(), _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling;
            insert(_el$23, (() => {
              var _c$ = memo(() => !!layoutStore.licenseState?.graceExpiresAt);
              return () => _c$() ? `${Math.max(1, Math.ceil((layoutStore.licenseState.graceExpiresAt - Date.now()) / 864e5))}d left` : "Active";
            })());
            return _el$21;
          }
        }), createComponent(Show, {
          get when() {
            return layoutStore.licenseState?.expiresAt;
          },
          get children() {
            var _el$24 = _tmpl$6$2(), _el$25 = _el$24.firstChild, _el$26 = _el$25.nextSibling;
            insert(_el$26, () => formatDate(layoutStore.licenseState?.expiresAt));
            return _el$24;
          }
        })];
      }
    }), null);
    insert(_el$9, createComponent(Show, {
      get when() {
        return !layoutStore.isPremium;
      },
      get children() {
        var _el$27 = _tmpl$7$2(), _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling;
        _el$29.$$click = () => {
          props.onClose();
          setLayoutStore("paywallReason", "workspace");
          setLayoutStore("showPaywall", true);
        };
        return _el$27;
      }
    }), null);
    _el$33.$$click = handleCheckUpdates;
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$5 = /* @__PURE__ */ template(`<div class="max-w-xl mx-auto"><p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Default Profiles</p><div class="bg-neutral-50 border border-neutral-200/60 rounded-[16px] overflow-hidden divide-y divide-neutral-200/60">`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors"><div class="flex items-center gap-3"><div class="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600"></div><div class="text-sm font-medium text-neutral-900"></div></div><select class="text-sm border border-neutral-200 rounded-lg py-2 px-3 bg-white text-neutral-700 focus:outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 cursor-pointer shadow-sm hover:border-neutral-300 transition-colors"><option value=main>Main (Default)`), _tmpl$3$5 = /* @__PURE__ */ template(`<option>`);
function WorkspacesTab(props) {
  return (() => {
    var _el$ = _tmpl$$5(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
    insert(_el$3, createComponent(For, {
      get each() {
        return props.ws.workspaces();
      },
      children: (workspace) => (() => {
        var _el$4 = _tmpl$2$5(), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$5.nextSibling;
        _el$8.firstChild;
        insert(_el$6, createComponent(WorkspaceIcon, {
          get icon() {
            return workspace.icon;
          },
          get name() {
            return workspace.name;
          },
          size: 16,
          strokeWidth: 1.75
        }));
        insert(_el$7, () => workspace.name);
        _el$8.addEventListener("change", async (e) => {
          const val = e.currentTarget.value;
          if (val) {
            await window.api?.setWorkspaceDefaultProfile?.(workspace.id, val === "main" ? null : val);
            window.dispatchEvent(new CustomEvent("app:prompt-cascade-profile", {
              detail: {
                targetType: "workspace",
                targetId: workspace.id,
                targetName: workspace.name,
                profileId: val === "main" ? null : val
              }
            }));
            const refreshed = await window.api?.getWorkspaces?.();
            if (refreshed) props.ws.setWorkspaces(refreshed);
          }
        });
        insert(_el$8, createComponent(For, {
          get each() {
            return layoutStore.profiles.filter((p) => p.id !== "main");
          },
          children: (profile) => (() => {
            var _el$0 = _tmpl$3$5();
            insert(_el$0, () => profile.name);
            createRenderEffect(() => _el$0.value = profile.id);
            return _el$0;
          })()
        }), null);
        createRenderEffect(() => _el$8.value = workspace.default_profile_id || "main");
        return _el$4;
      })()
    }));
    return _el$;
  })();
}
var _tmpl$$4 = /* @__PURE__ */ template(`<div class="space-y-3 mt-4 border-t border-neutral-100 pt-4"><div class=space-y-0.5><h4 class="text-xs font-semibold text-neutral-800 uppercase tracking-wider">Launchpad Shortcuts</h4><p class="text-[10px] text-neutral-500">Default bookmarks opened within this profile</p></div><div class="flex items-center gap-2"><input type=text class="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs text-neutral-800 outline-none focus:border-neutral-800 shadow-xs"placeholder="Website URL (e.g. app.slack.com)"><button class="text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg px-3.5 py-2 disabled:opacity-50 transition-colors cursor-pointer shadow-xs">Add</button></div><div class="border border-neutral-200/80 rounded-xl overflow-hidden divide-y divide-neutral-100 max-h-40 overflow-y-auto bg-neutral-50/50">`), _tmpl$2$4 = /* @__PURE__ */ template(`<div class="p-3 text-center text-xs text-neutral-400 italic">No shortcuts configured.`), _tmpl$3$4 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-2 hover:bg-white transition-colors"><div class="flex items-center gap-2 min-w-0"><div class="flex flex-col min-w-0"><span class="text-xs font-medium text-neutral-800 truncate"></span><span class="text-[9px] text-neutral-400 font-mono truncate"></span></div></div><div class="flex items-center gap-1"><button class="p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-30 cursor-pointer">▲</button><button class="p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-30 cursor-pointer">▼</button><button class="p-1 hover:bg-red-50 text-neutral-400 hover:text-red-600 rounded cursor-pointer">✕`);
function ProfileShortcutsManager(props) {
  const [apps, setApps] = createSignal([]);
  const [newUrl, setNewUrl] = createSignal("");
  const loadApps = () => {
    const key = `apposition:profile_apps:${props.profileId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setApps(JSON.parse(stored));
      } catch (e) {
        console.error(e);
      }
    } else {
      const defaults = appDirectory.slice(0, 7);
      setApps(defaults);
      localStorage.setItem(key, JSON.stringify(defaults));
    }
  };
  const saveApps = (list) => {
    const key = `apposition:profile_apps:${props.profileId}`;
    localStorage.setItem(key, JSON.stringify(list));
    setApps(list);
    window.dispatchEvent(new CustomEvent(`app:profile_apps_updated:${props.profileId}`, {
      detail: list
    }));
  };
  createEffect(() => {
    loadApps();
  });
  const handleAdd = () => {
    if (!newUrl().trim()) return;
    let formattedUrl = newUrl().trim();
    if (!formattedUrl.startsWith("http")) {
      formattedUrl = `https://${formattedUrl}`;
    }
    const name = getAppNameFromUrl(formattedUrl);
    let domain = "";
    try {
      domain = new URL(formattedUrl).hostname;
    } catch {
      domain = formattedUrl;
    }
    const newItem = {
      id: `custom_${Date.now()}`,
      name,
      domain,
      url: formattedUrl,
      category: "Tools"
    };
    const updated = [...apps(), newItem];
    saveApps(updated);
    setNewUrl("");
  };
  const handleDelete = (idx) => {
    if (confirm("Remove this shortcut?")) {
      const list = [...apps()];
      list.splice(idx, 1);
      saveApps(list);
    }
  };
  const handleMove = (idx, dir) => {
    const list = [...apps()];
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= list.length) return;
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;
    saveApps(list);
  };
  return (() => {
    var _el$ = _tmpl$$4(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling;
    _el$4.$$input = (e) => setNewUrl(e.currentTarget.value);
    _el$5.$$click = handleAdd;
    insert(_el$6, createComponent(Show, {
      get when() {
        return apps().length > 0;
      },
      get fallback() {
        return _tmpl$2$4();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return apps();
          },
          children: (app, idx) => (() => {
            var _el$8 = _tmpl$3$4(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$9.nextSibling, _el$12 = _el$11.firstChild, _el$13 = _el$12.nextSibling, _el$14 = _el$13.nextSibling;
            insert(_el$9, createComponent(AppIcon, {
              app,
              "class": "w-4 h-4"
            }), _el$0);
            insert(_el$1, () => app.name);
            insert(_el$10, () => app.domain);
            _el$12.$$click = () => handleMove(idx(), -1);
            _el$13.$$click = () => handleMove(idx(), 1);
            _el$14.$$click = () => handleDelete(idx());
            createRenderEffect((_p$) => {
              var _v$ = idx() === 0, _v$2 = idx() === apps().length - 1;
              _v$ !== _p$.e && (_el$12.disabled = _p$.e = _v$);
              _v$2 !== _p$.t && (_el$13.disabled = _p$.t = _v$2);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$8;
          })()
        });
      }
    }));
    createRenderEffect(() => _el$5.disabled = !newUrl().trim());
    createRenderEffect(() => _el$4.value = newUrl());
    return _el$;
  })();
}
delegateEvents(["input", "click"]);
var _tmpl$$3 = /* @__PURE__ */ template(`<span class="text-[11px] font-normal text-neutral-400">(Default)`), _tmpl$2$3 = /* @__PURE__ */ template(`<span class="text-[11px] font-normal text-neutral-400">(Incognito)`), _tmpl$3$3 = /* @__PURE__ */ template(`<span class="text-[10px] font-normal text-neutral-400">(+<!>)`), _tmpl$4$2 = /* @__PURE__ */ template(`<div class="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-neutral-50/90 hover:bg-white border border-neutral-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all cursor-pointer min-w-0 group/pill"><div class="w-4 h-4 rounded-full bg-white border border-neutral-200/60 flex items-center justify-center p-0.5 shrink-0 overflow-hidden"><img class="w-3.5 h-3.5 object-contain"></div><span class="text-xs font-normal text-neutral-800 truncate max-w-[190px]">`), _tmpl$5$1 = /* @__PURE__ */ template(`<div class="flex items-center justify-center w-5 h-5 rounded-full bg-neutral-100 ring-2 ring-white border border-neutral-200 text-[8px] font-medium text-neutral-500">+`), _tmpl$6$1 = /* @__PURE__ */ template(`<div class="flex items-center -space-x-1.5 cursor-pointer pl-0.5">`), _tmpl$7$1 = /* @__PURE__ */ template(`<div class="flex flex-col gap-3 p-4 bg-white rounded-2xl border border-neutral-200/80 shadow-xs hover:border-neutral-300 transition-all group"><div class="flex items-center justify-between"><div class="flex items-center gap-3 min-w-0"><div class="flex items-center justify-center w-8 h-8 rounded-xl text-white text-xs font-medium shadow-[inset_0_1px_1px_rgba(255,255,255,0.35)] shrink-0"></div><div class="flex flex-col min-w-0"><div class="flex items-center gap-1.5"><span class="text-sm font-medium text-neutral-900 truncate"></span></div></div></div><button class="px-3 py-1.5 text-xs font-normal text-neutral-600 hover:text-neutral-950 bg-neutral-100/80 hover:bg-neutral-200/70 rounded-lg transition-colors shrink-0 cursor-pointer border border-neutral-200/50 shadow-2xs">Configure</button></div><div class="flex items-center justify-between pt-2 border-t border-neutral-100 min-h-[34px]"><div class="flex items-center gap-2 overflow-hidden min-w-0">`), _tmpl$8$1 = /* @__PURE__ */ template(`<button type=button class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-neutral-200 text-xs font-normal text-neutral-400 hover:text-neutral-800 hover:border-neutral-400 transition-colors cursor-pointer"><span>+</span> Connect account`), _tmpl$9 = /* @__PURE__ */ template(`<div class="relative flex items-center justify-center w-5 h-5 rounded-full bg-white ring-2 ring-white border border-neutral-200/80 shadow-2xs overflow-hidden"><img class="w-3 h-3 object-contain">`);
const PROVIDER_PRIORITY = {
  google: 100,
  github: 90,
  microsoft: 80,
  apple: 70,
  slack: 60,
  x: 50,
  linear: 40,
  figma: 39,
  notion: 38,
  chatgpt: 37,
  canva: 36,
  vercel: 35,
  stripe: 34,
  atlassian: 33,
  discord: 30,
  gitlab: 29
};
function getProviderDomain(id) {
  switch (id) {
    case "google":
      return "google.com";
    case "github":
      return "github.com";
    case "microsoft":
      return "microsoft.com";
    case "apple":
      return "apple.com";
    case "slack":
      return "slack.com";
    case "x":
      return "x.com";
    case "linear":
      return "linear.app";
    case "notion":
      return "notion.so";
    case "chatgpt":
      return "chatgpt.com";
    case "canva":
      return "canva.com";
    case "atlassian":
      return "atlassian.com";
    default:
      return `${id}.com`;
  }
}
function ProfileCard(props) {
  const [copied, setCopied] = createSignal(false);
  const getIdentities = () => {
    try {
      return props.profile.identities_json ? JSON.parse(props.profile.identities_json) : {};
    } catch {
      return {};
    }
  };
  const activeIdentitiesList = () => {
    const ids = getIdentities();
    const list = Object.entries(ids).map(([providerId, data]) => ({
      providerId,
      ...data
    }));
    return list.sort((a, b) => {
      const aReal = Boolean(a.email?.includes("@") || a.handle?.startsWith("@") && !a.handle.includes("_user"));
      const bReal = Boolean(b.email?.includes("@") || b.handle?.startsWith("@") && !b.handle.includes("_user"));
      if (aReal && !bReal) return -1;
      if (!aReal && bReal) return 1;
      const pA = PROVIDER_PRIORITY[a.providerId] || 10;
      const pB = PROVIDER_PRIORITY[b.providerId] || 10;
      return pB - pA;
    });
  };
  const isDefault = () => props.profile.id === "main";
  const primaryIdentity = () => activeIdentitiesList()[0];
  const secondaryIdentities = () => activeIdentitiesList().slice(1);
  const handleCopyEmail = (e) => {
    e.stopPropagation();
    const text = primaryIdentity()?.email || primaryIdentity()?.handle;
    if (text) {
      navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (() => {
    var _el$ = _tmpl$7$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$0 = _el$3.nextSibling, _el$1 = _el$2.nextSibling, _el$10 = _el$1.firstChild;
    insert(_el$4, () => props.profile.name.charAt(0).toUpperCase());
    insert(_el$7, () => props.profile.name);
    insert(_el$6, createComponent(Show, {
      get when() {
        return isDefault();
      },
      get children() {
        return _tmpl$$3();
      }
    }), null);
    insert(_el$6, createComponent(Show, {
      get when() {
        return props.profile.is_ephemeral;
      },
      get children() {
        return _tmpl$2$3();
      }
    }), null);
    addEventListener(_el$0, "click", props.onConfigure, true);
    insert(_el$10, createComponent(Show, {
      get when() {
        return primaryIdentity();
      },
      get fallback() {
        return (() => {
          var _el$22 = _tmpl$8$1();
          addEventListener(_el$22, "click", props.onConfigure, true);
          return _el$22;
        })();
      },
      get children() {
        return [(() => {
          var _el$11 = _tmpl$4$2(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$12.nextSibling;
          _el$11.$$click = handleCopyEmail;
          _el$13.addEventListener("error", (e) => {
            e.currentTarget.style.display = "none";
          });
          insert(_el$14, (() => {
            var _c$ = memo(() => !!copied());
            return () => _c$() ? "✓ Copied" : primaryIdentity()?.email || primaryIdentity()?.handle;
          })());
          insert(_el$11, createComponent(Show, {
            get when() {
              return memo(() => !!primaryIdentity()?.aliases?.length)() && !copied();
            },
            get children() {
              var _el$15 = _tmpl$3$3(), _el$16 = _el$15.firstChild, _el$18 = _el$16.nextSibling;
              _el$18.nextSibling;
              insert(_el$15, () => primaryIdentity()?.aliases?.length, _el$18);
              return _el$15;
            }
          }), null);
          createRenderEffect((_p$) => {
            var _v$ = `Click to copy: ${primaryIdentity()?.email || primaryIdentity()?.handle}`, _v$2 = `https://www.google.com/s2/favicons?domain=${getProviderDomain(primaryIdentity()?.providerId)}&sz=64`, _v$3 = primaryIdentity()?.providerId;
            _v$ !== _p$.e && setAttribute(_el$11, "title", _p$.e = _v$);
            _v$2 !== _p$.t && setAttribute(_el$13, "src", _p$.t = _v$2);
            _v$3 !== _p$.a && setAttribute(_el$13, "alt", _p$.a = _v$3);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0
          });
          return _el$11;
        })(), createComponent(Show, {
          get when() {
            return secondaryIdentities().length > 0;
          },
          get children() {
            var _el$19 = _tmpl$6$1();
            addEventListener(_el$19, "click", props.onConfigure, true);
            insert(_el$19, createComponent(For, {
              get each() {
                return secondaryIdentities().slice(0, 3);
              },
              children: (s) => (() => {
                var _el$23 = _tmpl$9(), _el$24 = _el$23.firstChild;
                _el$24.addEventListener("error", (e) => {
                  e.currentTarget.style.display = "none";
                });
                createRenderEffect((_p$) => {
                  var _v$4 = `https://www.google.com/s2/favicons?domain=${getProviderDomain(s.providerId)}&sz=64`, _v$5 = s.providerId;
                  _v$4 !== _p$.e && setAttribute(_el$24, "src", _p$.e = _v$4);
                  _v$5 !== _p$.t && setAttribute(_el$24, "alt", _p$.t = _v$5);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                return _el$23;
              })()
            }), null);
            insert(_el$19, createComponent(Show, {
              get when() {
                return secondaryIdentities().length > 3;
              },
              get children() {
                var _el$20 = _tmpl$5$1();
                _el$20.firstChild;
                insert(_el$20, () => secondaryIdentities().length - 3, null);
                return _el$20;
              }
            }), null);
            createRenderEffect(() => setAttribute(_el$19, "title", secondaryIdentities().map((s) => `${s.providerId}: ${s.email || s.handle}`).join(", ")));
            return _el$19;
          }
        })];
      }
    }));
    createRenderEffect((_$p) => setStyleProperty(_el$4, "background-color", props.profile.color || "#e11d48"));
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<div class="flex items-center justify-between mb-4"><div class=space-y-0.5><h3 class="text-sm font-medium text-neutral-900">Profiles</h3><p class="text-xs font-normal text-neutral-400">Keep separate accounts, history, and cookies across workspaces.</p></div><button class="flex items-center gap-1.5 text-xs font-normal bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-1.5 rounded-xl transition-all shadow-xs shrink-0 cursor-pointer"><span>+</span><span>New profile`), _tmpl$2$2 = /* @__PURE__ */ template(`<div class="grid grid-cols-1 gap-3">`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class=p-6>`), _tmpl$4$1 = /* @__PURE__ */ template(`<div><div class="flex items-center gap-2 mb-3"><button class="text-xs text-neutral-400 hover:text-neutral-900 transition-colors flex items-center gap-1 cursor-pointer font-normal"><span>←</span> Back to profiles</button></div><h3 class="text-sm font-medium text-neutral-900 mb-3">`);
function ProfilesTab(props) {
  onMount(async () => {
    try {
      await window.api?.scanProfileIdentities?.();
      const profiles = await window.api?.getProfiles?.();
      if (profiles && Array.isArray(profiles)) {
        setLayoutStore("profiles", profiles);
      }
    } catch {
    }
  });
  return (() => {
    var _el$ = _tmpl$3$2();
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!!props.isCreatingProfile)() && !props.editingProfileId;
      },
      get fallback() {
        return (() => {
          var _el$6 = _tmpl$4$1(), _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$7.nextSibling;
          _el$8.$$click = () => {
            props.setIsCreatingProfile(false);
            props.setEditingProfileId(null);
          };
          insert(_el$9, () => props.isCreatingProfile ? "Create profile" : "Edit profile");
          insert(_el$6, createComponent(ProfileForm, {
            get initialData() {
              const p = layoutStore.profiles.find((p2) => p2.id === props.editingProfileId);
              if (!p) return void 0;
              return {
                ...p,
                is_ephemeral: !!p.is_ephemeral,
                proxy_server: p.proxy_server || "",
                user_agent: p.user_agent || "",
                identities_json: p.identities_json
              };
            },
            get onSave() {
              return props.handleSaveProfile;
            },
            onCancel: () => {
              props.setIsCreatingProfile(false);
              props.setEditingProfileId(null);
            },
            get onDelete() {
              return props.editingProfileId && props.editingProfileId !== "main" ? () => {
                props.handleDeleteProfile(props.editingProfileId);
                props.setEditingProfileId(null);
              } : void 0;
            }
          }), null);
          insert(_el$6, createComponent(Show, {
            get when() {
              return props.editingProfileId;
            },
            get children() {
              return createComponent(ProfileShortcutsManager, {
                get profileId() {
                  return props.editingProfileId;
                }
              });
            }
          }), null);
          return _el$6;
        })();
      },
      get children() {
        return [(() => {
          var _el$2 = _tmpl$$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
          _el$4.$$click = () => {
            if (!layoutStore.isPremium && layoutStore.profiles.length >= 2) {
              props.onClose();
              setLayoutStore("paywallReason", "profile");
              setLayoutStore("showPaywall", true);
              return;
            }
            props.setIsCreatingProfile(true);
          };
          return _el$2;
        })(), (() => {
          var _el$5 = _tmpl$2$2();
          insert(_el$5, createComponent(For, {
            get each() {
              return layoutStore.profiles;
            },
            children: (profile) => createComponent(ProfileCard, {
              profile,
              onConfigure: () => props.setEditingProfileId(profile.id)
            })
          }));
          return _el$5;
        })()];
      }
    }));
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$1 = /* @__PURE__ */ template(`<span class="text-neutral-400 mx-1 text-[10px] font-medium">+`), _tmpl$2$1 = /* @__PURE__ */ template(`<div class="flex items-center"><kbd class="px-2 py-1 rounded-md bg-white border border-neutral-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_-1px_0_rgba(0,0,0,0.02)] text-[11px] font-mono font-semibold text-neutral-700 tracking-wide">`), _tmpl$3$1 = /* @__PURE__ */ template(`<div class="flex items-center">`), _tmpl$4 = /* @__PURE__ */ template(`<div data-shortcut-recorder=true tabindex=0>`), _tmpl$5 = /* @__PURE__ */ template(`<span class="text-[11px] font-medium text-neutral-900 animate-pulse">Press any key... (Esc to cancel)`), _tmpl$6 = /* @__PURE__ */ template(`<div class="max-w-xl mx-auto"><div class="flex items-center justify-between mb-4"><p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Keyboard Shortcuts</p><button class="text-xs font-medium text-neutral-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50">Reset Defaults</button></div><div class="space-y-6 pb-6">`), _tmpl$7 = /* @__PURE__ */ template(`<div><h3 class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-3 px-1"></h3><div class="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100 shadow-sm">`), _tmpl$8 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-3 hover:bg-neutral-50 transition-colors"><span class="text-sm text-neutral-700">`);
function ShortcutRecorder(props) {
  const [isRecording, setIsRecording] = createSignal(false);
  const handleKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setIsRecording(false);
      return;
    }
    const isMac = navigator.userAgent.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (["control", "shift", "alt", "meta"].includes(key)) return;
    saveShortcut(props.shortcut.id, {
      key,
      mod,
      shift: e.shiftKey,
      alt: e.altKey
    });
    setIsRecording(false);
  };
  const displayKey = (s) => {
    const isMac = navigator.userAgent.toLowerCase().includes("mac");
    const parts = [];
    if (s.mod) parts.push(isMac ? "⌘" : "Ctrl");
    if (s.alt) parts.push(isMac ? "⌥" : "Alt");
    if (s.shift) parts.push(isMac ? "⇧" : "Shift");
    let keyName = (s.key || s.code || "").toUpperCase();
    if (keyName === " ") keyName = "Space";
    if (keyName === "ARROWUP") keyName = "↑";
    if (keyName === "ARROWDOWN") keyName = "↓";
    if (keyName === "ARROWLEFT") keyName = "←";
    if (keyName === "ARROWRIGHT") keyName = "→";
    if (keyName === "ESCAPE") keyName = "Esc";
    if (keyName === "BACKSLASH") keyName = "\\";
    parts.push(keyName);
    return parts.map((p, i) => (() => {
      var _el$ = _tmpl$2$1(), _el$2 = _el$.firstChild;
      insert(_el$2, p);
      insert(_el$, createComponent(Show, {
        get when() {
          return i < parts.length - 1;
        },
        get children() {
          return _tmpl$$1();
        }
      }), null);
      return _el$;
    })());
  };
  return (() => {
    var _el$4 = _tmpl$4();
    _el$4.addEventListener("blur", () => setIsRecording(false));
    addEventListener(_el$4, "keydown", isRecording() ? handleKeyDown : void 0, true);
    _el$4.$$click = () => setIsRecording(true);
    insert(_el$4, createComponent(Show, {
      get when() {
        return !isRecording();
      },
      get fallback() {
        return _tmpl$5();
      },
      get children() {
        var _el$5 = _tmpl$3$1();
        insert(_el$5, () => displayKey(props.shortcut));
        return _el$5;
      }
    }));
    createRenderEffect(() => className(_el$4, `flex items-center justify-end min-w-[120px] h-9 px-2 rounded-lg transition-all cursor-pointer ${isRecording() ? "bg-blue-50 ring-1 ring-blue-500 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]" : "hover:bg-neutral-50 border border-transparent hover:border-neutral-200/60"}`));
    return _el$4;
  })();
}
function ShortcutsTab() {
  return (() => {
    var _el$7 = _tmpl$6(), _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$8.nextSibling;
    _el$0.$$click = () => {
      localStorage.removeItem("apposition_shortcuts");
      window.location.reload();
    };
    insert(_el$1, createComponent(For, {
      get each() {
        return [...new Set(activeShortcuts().map((s) => s.category || "Other"))];
      },
      children: (category) => (() => {
        var _el$10 = _tmpl$7(), _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
        insert(_el$11, category);
        insert(_el$12, createComponent(For, {
          get each() {
            return activeShortcuts().filter((s) => s.category === category);
          },
          children: (shortcut) => (() => {
            var _el$13 = _tmpl$8(), _el$14 = _el$13.firstChild;
            insert(_el$14, () => shortcut.label || shortcut.id);
            insert(_el$13, createComponent(ShortcutRecorder, {
              shortcut
            }), null);
            return _el$13;
          })()
        }));
        return _el$10;
      })()
    }));
    return _el$7;
  })();
}
delegateEvents(["click", "keydown"]);
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed z-[99999] w-[600px] h-[480px] bg-white border border-neutral-200/80 rounded-[20px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.22)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"><div class="flex items-center justify-between px-5 py-4 border-b border-neutral-200/60 bg-white shrink-0"><div class="flex items-center gap-6"><h2 class="text-sm font-semibold text-neutral-800">Settings</h2><div class="flex items-center gap-1 bg-neutral-100 p-1 rounded-[14px]"></div></div></div><div class="flex-1 overflow-y-auto bg-white p-6 relative z-10">`), _tmpl$3 = /* @__PURE__ */ template(`<button>`);
function SettingsPopover(props) {
  const [activeTab, setActiveTab] = createSignal(layoutStore.settingsActiveTab || "account");
  const [editingProfileId, setEditingProfileId] = createSignal(null);
  const [isCreatingProfile, setIsCreatingProfile] = createSignal(false);
  const handleSaveProfile = async (data) => {
    if (!data.id) {
      if (!layoutStore.isPremium && layoutStore.profiles.length >= 2) {
        setLayoutStore("paywallReason", "profile");
        setLayoutStore("showPaywall", true);
        return;
      }
      const id = `profile_${Date.now()}`;
      await window.api?.createProfile(id, data.name, data.color, !!data.is_ephemeral, data.proxy_server, data.user_agent);
    } else {
      await window.api?.updateProfile(data.id, data.name, data.color, !!data.is_ephemeral, data.proxy_server, data.user_agent);
    }
    const profiles = await window.api?.getProfiles();
    if (profiles) setLayoutStore("profiles", profiles);
    setEditingProfileId(null);
    setIsCreatingProfile(false);
  };
  const handleDeleteProfile = async (id) => {
    if (id === "main") return;
    if (confirm("Are you sure? This will delete the profile and move all its panes to Main.")) {
      await window.api?.deleteProfile(id);
      const profiles = await window.api?.getProfiles();
      if (profiles) setLayoutStore("profiles", profiles);
    }
  };
  let popoverRef;
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  const position = () => {
    const anchor = layoutStore.settingsAnchor;
    if (!anchor) return {
      top: "calc(50% - 240px)",
      left: "calc(50% - 300px)"
    };
    const margin = 8;
    const isLeftHalf = anchor.left < window.innerWidth / 2;
    const isBottomHalf = anchor.top > window.innerHeight / 2;
    const style2 = {};
    if (isLeftHalf) {
      style2.left = `${anchor.left + anchor.width + margin}px`;
    } else {
      style2.right = `${window.innerWidth - anchor.left}px`;
    }
    if (isBottomHalf) {
      style2.bottom = `${window.innerHeight - (anchor.top + anchor.height)}px`;
    } else {
      style2.top = `${anchor.top}px`;
    }
    return style2;
  };
  return createComponent(Portal, {
    get children() {
      return [(() => {
        var _el$ = _tmpl$();
        _el$.$$mousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onClose();
        };
        return _el$;
      })(), (() => {
        var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$3.nextSibling;
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$2) : popoverRef = _el$2;
        insert(_el$6, createComponent(For, {
          each: ["account", "profiles", "workspaces", "shortcuts"],
          children: (tab) => (() => {
            var _el$8 = _tmpl$3();
            _el$8.$$click = () => setActiveTab(tab);
            insert(_el$8, () => tab.charAt(0).toUpperCase() + tab.slice(1));
            createRenderEffect(() => className(_el$8, `px-3 py-1.5 rounded-[10px] text-[11px] font-semibold transition-colors ${activeTab() === tab ? "bg-white text-neutral-900 shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]" : "text-neutral-500 hover:text-neutral-700"}`));
            return _el$8;
          })()
        }));
        insert(_el$7, createComponent(Show, {
          get when() {
            return activeTab() === "account";
          },
          get children() {
            return createComponent(AccountTab, {
              get onClose() {
                return props.onClose;
              }
            });
          }
        }), null);
        insert(_el$7, createComponent(Show, {
          get when() {
            return activeTab() === "workspaces";
          },
          get children() {
            return createComponent(WorkspacesTab, {
              get ws() {
                return props.ws;
              }
            });
          }
        }), null);
        insert(_el$7, createComponent(Show, {
          get when() {
            return activeTab() === "profiles";
          },
          get children() {
            return createComponent(ProfilesTab, {
              get onClose() {
                return props.onClose;
              },
              get isCreatingProfile() {
                return isCreatingProfile();
              },
              setIsCreatingProfile,
              get editingProfileId() {
                return editingProfileId();
              },
              setEditingProfileId,
              handleSaveProfile,
              handleDeleteProfile
            });
          }
        }), null);
        insert(_el$7, createComponent(Show, {
          get when() {
            return activeTab() === "shortcuts";
          },
          get children() {
            return createComponent(ShortcutsTab, {});
          }
        }), null);
        createRenderEffect((_$p) => style(_el$2, position(), _$p));
        return _el$2;
      })()];
    }
  });
}
delegateEvents(["mousedown", "click"]);
export {
  SettingsPopover as default
};
