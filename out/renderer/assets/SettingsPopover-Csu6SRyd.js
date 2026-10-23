import { c as createComponent, S as Switch, M as Match, a as checkForUpdates, u as updateStore, d as downloadUpdate, i as insert, m as memo, b as isRestarting, e as createRenderEffect, f as className, o as openExternalUrl, g as applyUpdate, t as template, h as delegateEvents, j as onMount, k as initUpdateStore, l as Show, s as setStyleProperty, F as For, n as setLayoutStore, p as setAttribute, q as layoutStore, r as createSignal, W as WorkspaceIcon, v as createEffect, A as AppIcon, w as frecencyEngine, x as getAppNameFromUrl, y as addEventListener, z as getProviderDomain, B as getSortedIdentities, P as ProfileForm, C as setActiveShortcuts, D as DEFAULT_SHORTCUTS, E as activeShortcuts, G as isMacPlatform, H as saveShortcut, I as onCleanup, J as style, K as use, L as Portal } from "./index-CQXIu3Na.js";
import { u as useLicenseActivationController, U as UniversalActivationCard } from "./UniversalActivationCard-BfQQmtve.js";
var _tmpl$$a = /* @__PURE__ */ template(`<button class="text-xs font-medium text-neutral-800 bg-white hover:bg-neutral-100 active:scale-[0.98] border border-neutral-300/80 px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer">Check for Updates`), _tmpl$2$a = /* @__PURE__ */ template(`<button disabled class="text-xs font-medium text-neutral-500 bg-neutral-100 border border-neutral-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5 opacity-70 cursor-not-allowed"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 class="animate-spin text-neutral-600"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>Checking...`), _tmpl$3$a = /* @__PURE__ */ template(`<button class="text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] px-3.5 py-1.5 rounded-lg shadow-sm transition-all cursor-pointer">Download Update`), _tmpl$4$7 = /* @__PURE__ */ template(`<button disabled class="text-xs font-medium text-neutral-500 bg-neutral-100 border border-neutral-200 px-3 py-1.5 rounded-lg opacity-80 cursor-not-allowed">Downloading...`), _tmpl$5$6 = /* @__PURE__ */ template(`<button>`), _tmpl$6$5 = /* @__PURE__ */ template(`<button class="text-xs font-semibold text-neutral-900 bg-white hover:bg-neutral-100 border border-neutral-300 px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer">Download Package`), _tmpl$7$3 = /* @__PURE__ */ template(`<button class="text-xs font-medium text-neutral-800 bg-white hover:bg-neutral-100 border border-neutral-300 px-3 py-1.5 rounded-lg shadow-2xs transition-all cursor-pointer">Retry Check`), _tmpl$8$3 = /* @__PURE__ */ template(`<svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 class="animate-spin text-white"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67">`), _tmpl$9$1 = /* @__PURE__ */ template(`<span>Restarting...`);
function UpdateActionButton() {
  const handleApply = async () => {
    await applyUpdate();
  };
  return createComponent(Switch, {
    get children() {
      return [createComponent(Match, {
        get when() {
          return updateStore.status === "idle";
        },
        get children() {
          var _el$ = _tmpl$$a();
          _el$.$$click = () => checkForUpdates();
          return _el$;
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "checking";
        },
        get children() {
          return _tmpl$2$a();
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "available";
        },
        get children() {
          var _el$3 = _tmpl$3$a();
          _el$3.$$click = () => downloadUpdate();
          return _el$3;
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "downloading";
        },
        get children() {
          return _tmpl$4$7();
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "ready";
        },
        get children() {
          var _el$5 = _tmpl$5$6();
          _el$5.$$click = handleApply;
          insert(_el$5, (() => {
            var _c$ = memo(() => !!isRestarting());
            return () => _c$() ? [_tmpl$8$3(), _tmpl$9$1()] : "Restart to Apply";
          })());
          createRenderEffect((_p$) => {
            var _v$ = isRestarting(), _v$2 = `text-xs font-semibold text-white bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] border border-neutral-800 px-3.5 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1.5 ${isRestarting() ? "opacity-80 cursor-wait" : "cursor-pointer"}`;
            _v$ !== _p$.e && (_el$5.disabled = _p$.e = _v$);
            _v$2 !== _p$.t && className(_el$5, _p$.t = _v$2);
            return _p$;
          }, {
            e: void 0,
            t: void 0
          });
          return _el$5;
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "manual-action-required";
        },
        get children() {
          var _el$6 = _tmpl$6$5();
          _el$6.$$click = () => {
            const s = updateStore;
            if (s.downloadUrl) openExternalUrl(s.downloadUrl);
          };
          return _el$6;
        }
      }), createComponent(Match, {
        get when() {
          return updateStore.status === "error";
        },
        get children() {
          var _el$7 = _tmpl$7$3();
          _el$7.$$click = () => checkForUpdates();
          return _el$7;
        }
      })];
    }
  });
}
delegateEvents(["click"]);
var _tmpl$$9 = /* @__PURE__ */ template(`<p class="type-caption text-neutral-400 mt-1 pl-3 font-telemetry">`), _tmpl$2$9 = /* @__PURE__ */ template(`<div><div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-neutral-900"></span><span class="font-medium text-neutral-800">`), _tmpl$3$9 = /* @__PURE__ */ template(`<p class=text-neutral-500>Contacting release server for latest version information...`), _tmpl$4$6 = /* @__PURE__ */ template(`<div class=space-y-1><p class="font-medium text-neutral-900">A new version (<!>) is ready to download.</p><p class="text-neutral-500 type-caption">Download and install to receive the latest features, improvements, and fixes.`), _tmpl$5$5 = /* @__PURE__ */ template(`<div class="space-y-2 pt-1"><div class="flex justify-between type-caption font-medium text-neutral-700"><span>Downloading update...</span><span class=font-telemetry>%</span></div><div class="w-full bg-neutral-200 h-2 rounded-full overflow-hidden border border-neutral-300/50"><div class="bg-neutral-900 h-full rounded-full transition-all duration-300 ease-out">`), _tmpl$6$4 = /* @__PURE__ */ template(`<div class="flex items-center gap-2 text-neutral-900 bg-neutral-100 border border-neutral-300 p-2.5 rounded-xl font-medium shadow-2xs"><span class="w-2 h-2 rounded-full bg-neutral-900 shrink-0"></span><span>Update downloaded and verified. Restart Apposition to apply changes.`), _tmpl$7$2 = /* @__PURE__ */ template(`<p class="type-telemetry font-telemetry text-neutral-600 bg-neutral-100 px-2 py-1 rounded">`), _tmpl$8$2 = /* @__PURE__ */ template(`<div class="space-y-1.5 bg-white border border-neutral-200 p-2.5 rounded-xl shadow-2xs"><p class="font-medium text-neutral-900">Version <!> is available for manual download.`), _tmpl$9 = /* @__PURE__ */ template(`<p class="text-red-600 font-medium type-caption">`), _tmpl$0 = /* @__PURE__ */ template(`<div class="bg-neutral-50/60 border border-neutral-200/80 rounded-xl p-4 space-y-3 shadow-2xs select-none"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><span class="type-ui font-semibold text-neutral-900">Application Updates</span><span class="type-telemetry font-medium text-neutral-600 bg-white border border-neutral-200 px-2 py-0.5 rounded-md shadow-2xs font-telemetry">v</span></div></div><div class="type-caption text-neutral-600">`);
function UpdateCard() {
  onMount(() => {
    initUpdateStore();
  });
  return (() => {
    var _el$ = _tmpl$0(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
    _el$5.firstChild;
    var _el$7 = _el$2.nextSibling;
    insert(_el$5, () => updateStore.currentVersion, null);
    insert(_el$2, createComponent(UpdateActionButton, {}), null);
    insert(_el$7, createComponent(Switch, {
      get children() {
        return [createComponent(Match, {
          get when() {
            return updateStore.status === "idle";
          },
          get children() {
            var _el$8 = _tmpl$2$9(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling;
            insert(_el$1, () => updateStore.isDev ? "Running in development mode (updates disabled)." : "Apposition is up to date with the latest release.");
            insert(_el$8, createComponent(Show, {
              get when() {
                return updateStore.lastCheckedAt;
              },
              get children() {
                var _el$10 = _tmpl$$9();
                insert(_el$10, () => {
                  const ts = updateStore.lastCheckedAt;
                  if (!ts) return null;
                  const diff = Math.floor((Date.now() - ts) / 1e3);
                  if (diff < 60) return "Checked just now";
                  if (diff < 3600) return `Checked ${Math.floor(diff / 60)}m ago`;
                  return `Checked ${new Date(ts).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit"
                  })}`;
                });
                return _el$10;
              }
            }), null);
            return _el$8;
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "checking";
          },
          get children() {
            return _tmpl$3$9();
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "available";
          },
          get children() {
            var _el$12 = _tmpl$4$6(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild, _el$16 = _el$14.nextSibling;
            _el$16.nextSibling;
            insert(_el$13, () => updateStore.targetVersion, _el$16);
            return _el$12;
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "downloading";
          },
          get children() {
            var _el$17 = _tmpl$5$5(), _el$18 = _el$17.firstChild, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling, _el$21 = _el$20.firstChild, _el$22 = _el$18.nextSibling, _el$23 = _el$22.firstChild;
            insert(_el$20, () => updateStore.percent || 0, _el$21);
            insert(_el$20, createComponent(Show, {
              get when() {
                return updateStore.bytesPerSec;
              },
              get children() {
                return [" ", "· ", memo(() => Math.round(updateStore.bytesPerSec / (1024 * 1024) * 10) / 10), " MB/s"];
              }
            }), null);
            createRenderEffect((_$p) => setStyleProperty(_el$23, "width", `${updateStore.percent || 0}%`));
            return _el$17;
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "ready";
          },
          get children() {
            return _tmpl$6$4();
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "manual-action-required";
          },
          get children() {
            var _el$25 = _tmpl$8$2(), _el$26 = _el$25.firstChild, _el$27 = _el$26.firstChild, _el$29 = _el$27.nextSibling;
            _el$29.nextSibling;
            insert(_el$26, () => updateStore.targetVersion, _el$29);
            insert(_el$25, createComponent(Show, {
              get when() {
                return updateStore.terminalCommand;
              },
              get children() {
                var _el$30 = _tmpl$7$2();
                insert(_el$30, () => updateStore.terminalCommand);
                return _el$30;
              }
            }), null);
            return _el$25;
          }
        }), createComponent(Match, {
          get when() {
            return updateStore.status === "error";
          },
          get children() {
            var _el$31 = _tmpl$9();
            insert(_el$31, () => updateStore.message || "An error occurred while checking for updates.");
            return _el$31;
          }
        })];
      }
    }));
    return _el$;
  })();
}
var _tmpl$$8 = /* @__PURE__ */ template(`<div class="space-y-2.5 pt-3.5 border-t border-neutral-200/80"><div class="flex items-center justify-between"><span class="type-telemetry font-bold text-neutral-400 uppercase tracking-wider text-[9px]">Assigned Computers</span><div class="flex items-center gap-2"><span class="type-telemetry font-mono font-semibold text-neutral-700 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-md text-[10px]"> of <!> Devices Used</span><button type=button class="type-telemetry font-semibold text-neutral-600 hover:text-neutral-900 bg-white hover:bg-neutral-50 border border-neutral-200/90 px-2 py-0.5 rounded-md transition-colors shadow-2xs cursor-pointer text-[10px]"title="Manage all connected computers online">Manage Online ↗</button></div></div><div class=space-y-1.5></div><div class="pt-1 flex items-center justify-between text-[11px] text-neutral-500"><span>Move license to a new computer anytime with 1 click</span><button type=button class="font-semibold text-neutral-900 hover:underline cursor-pointer">Instant Transfer`), _tmpl$2$8 = /* @__PURE__ */ template(`<span class="type-telemetry font-mono font-bold text-[9px] uppercase px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-700 border border-neutral-200">This Device`), _tmpl$3$8 = /* @__PURE__ */ template(`<button type=button class="type-caption font-semibold text-neutral-700 hover:text-neutral-900 hover:bg-neutral-100 px-2.5 py-1 rounded-lg border border-neutral-200 transition-colors disabled:opacity-50 shrink-0 cursor-pointer text-[11px]">1-Click Move`), _tmpl$4$5 = /* @__PURE__ */ template(`<div class="flex items-center justify-between bg-white rounded-xl border border-neutral-200/90 p-3 shadow-2xs hover:border-neutral-300 transition-colors"><div class="flex items-center gap-3 min-w-0"><span></span><div class=min-w-0><div class="flex items-center gap-2"><span class="text-xs font-semibold text-neutral-900 truncate"></span></div><div class="type-caption text-neutral-500 text-[11px] font-mono">`), _tmpl$5$4 = /* @__PURE__ */ template(`<span class="type-telemetry font-mono font-medium text-neutral-500 text-[10px] px-2 py-1">Active`);
function AccountDevicesList(props) {
  const openPortal = () => {
    window.electron?.ipcRenderer.send("window.openExternal", "https://users.freemius.com/");
  };
  return (() => {
    var _el$ = _tmpl$$8(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$8 = _el$6.nextSibling;
    _el$8.nextSibling;
    var _el$9 = _el$5.nextSibling, _el$0 = _el$2.nextSibling, _el$1 = _el$0.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling;
    insert(_el$5, () => props.devices.length, _el$6);
    insert(_el$5, () => props.maxSeats ?? 2, _el$8);
    _el$9.$$click = openPortal;
    insert(_el$0, createComponent(For, {
      get each() {
        return props.devices;
      },
      children: (device) => (() => {
        var _el$12 = _tmpl$4$5(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$19 = _el$16.nextSibling;
        insert(_el$17, () => device.name);
        insert(_el$16, createComponent(Show, {
          get when() {
            return device.isCurrent;
          },
          get children() {
            return _tmpl$2$8();
          }
        }), null);
        insert(_el$19, () => device.os);
        insert(_el$12, createComponent(Show, {
          get when() {
            return !device.isCurrent;
          },
          get fallback() {
            return _tmpl$5$4();
          },
          get children() {
            var _el$20 = _tmpl$3$8();
            _el$20.$$click = () => props.onDeactivate(device.id);
            createRenderEffect(() => _el$20.disabled = props.deactivating);
            return _el$20;
          }
        }), null);
        createRenderEffect(() => className(_el$14, `w-2 h-2 rounded-full shrink-0 ${device.isCurrent ? "bg-neutral-900" : "bg-neutral-400"}`));
        return _el$12;
      })()
    }));
    _el$11.$$click = openPortal;
    return _el$;
  })();
}
delegateEvents(["click"]);
const AccountActivationBox = (props) => {
  const controller = useLicenseActivationController({
    onSuccess: () => {
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "License activated! All features unlocked.",
          type: "success"
        }
      }));
    }
  });
  return createComponent(UniversalActivationCard, {
    controller,
    title: "Activate License Key",
    badge: "Redeem",
    showFooterLink: true,
    footerLinkLabel: "Don't have a license key yet? View pricing and upgrades →",
    onFooterLinkClick: () => {
      props.onClose();
      setLayoutStore("paywallReason", null);
      setLayoutStore("showPaywall", true);
    }
  });
};
var _tmpl$$7 = /* @__PURE__ */ template(`<img class="w-11 h-11 rounded-full border border-neutral-200 object-cover shadow-2xs">`), _tmpl$2$7 = /* @__PURE__ */ template(`<div class="absolute -bottom-1 -right-1 bg-neutral-900 text-white type-telemetry font-bold tracking-wider px-1.5 py-0.2 rounded-full border border-white shadow-2xs">PRO`), _tmpl$3$7 = /* @__PURE__ */ template(`<span class="type-caption font-semibold text-neutral-800 bg-neutral-100 border border-neutral-300 px-2.5 py-1 rounded-lg flex items-center gap-1.5 shadow-2xs"><span class="w-1.5 h-1.5 rounded-full bg-neutral-900"></span> Active`), _tmpl$4$4 = /* @__PURE__ */ template(`<div class="flex items-center gap-3.5 p-3.5 bg-neutral-50/60 border border-neutral-200/80 rounded-xl shadow-2xs"><div class="relative shrink-0"></div><div class="min-w-0 flex-1"><h3 class="type-ui font-semibold text-neutral-900 truncate"></h3><p class="type-caption text-neutral-500 font-normal truncate"></p></div><div>`), _tmpl$5$3 = /* @__PURE__ */ template(`<div class="w-11 h-11 rounded-full bg-neutral-100 border border-neutral-200/90 flex items-center justify-center text-neutral-700 shadow-2xs"><svg width=18 height=18 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.75><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx=12 cy=7 r=4>`), _tmpl$6$3 = /* @__PURE__ */ template(`<span class="type-caption font-medium text-neutral-600 bg-white border border-neutral-200/80 px-2.5 py-1 rounded-lg shadow-2xs">Free Plan`);
const AccountProfileHeader = () => {
  return (() => {
    var _el$ = _tmpl$4$4(), _el$2 = _el$.firstChild, _el$5 = _el$2.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$5.nextSibling;
    insert(_el$2, createComponent(Show, {
      get when() {
        return layoutStore.licenseState?.customer?.avatar_url;
      },
      get fallback() {
        return _tmpl$5$3();
      },
      get children() {
        var _el$3 = _tmpl$$7();
        createRenderEffect(() => setAttribute(_el$3, "src", layoutStore.licenseState?.customer?.avatar_url));
        return _el$3;
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return layoutStore.isPremium;
      },
      get children() {
        return _tmpl$2$7();
      }
    }), null);
    insert(_el$6, () => layoutStore.licenseState?.customer?.name || "Local Profile");
    insert(_el$7, () => layoutStore.licenseState?.customer?.email || layoutStore.licenseState?.customerEmail || "No connected email");
    insert(_el$8, createComponent(Show, {
      get when() {
        return layoutStore.isPremium;
      },
      get fallback() {
        return _tmpl$6$3();
      },
      get children() {
        return _tmpl$3$7();
      }
    }));
    return _el$;
  })();
};
var _tmpl$$6 = /* @__PURE__ */ template(`<span class="type-telemetry font-mono font-bold text-[9px] uppercase px-1.5 py-0.5 rounded bg-neutral-900 text-white shadow-2xs">Active`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class="flex items-center gap-1.5"><button class="type-telemetry font-semibold text-neutral-500 hover:text-neutral-900 px-2 py-1 rounded-md hover:bg-neutral-100 transition-colors cursor-pointer">Validate</button><span class=text-neutral-300>·</span><button class="type-telemetry font-semibold text-neutral-500 hover:text-neutral-900 px-2 py-1 rounded-md hover:bg-neutral-100 transition-colors cursor-pointer">Manage ↗</button><span class=text-neutral-300>·</span><button class="type-telemetry font-semibold text-red-600 hover:text-red-700 px-2 py-1 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer">`), _tmpl$3$6 = /* @__PURE__ */ template(`<div class=space-y-1.5><span class="type-caption font-medium text-neutral-500">License Key</span><div class="flex items-center justify-between bg-white rounded-xl border border-neutral-200/90 p-2.5 shadow-2xs"><span class="font-telemetry type-caption font-semibold text-neutral-800 tracking-wide"></span><button class="type-caption font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer">Copy`), _tmpl$4$3 = /* @__PURE__ */ template(`<div class="p-2.5 bg-neutral-100 border border-neutral-200 rounded-xl text-neutral-800 type-caption flex items-center justify-between"><div class="flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-neutral-900"></span><span>Offline Mode (7-Day Grace Lease)</span></div><span class="type-telemetry font-telemetry">`), _tmpl$5$2 = /* @__PURE__ */ template(`<div class="pt-1 flex justify-between items-center type-caption"><span class=text-neutral-500>Renewal Date</span><span class="text-neutral-900 font-medium">`), _tmpl$6$2 = /* @__PURE__ */ template(`<div class="space-y-3.5 max-w-lg mx-auto select-none"><div class="bg-neutral-50/60 border border-neutral-200/80 rounded-xl p-4 shadow-2xs space-y-3.5"><div class="flex items-center justify-between pb-3 border-b border-neutral-200/70"><div><span class="type-telemetry font-bold text-neutral-400 uppercase tracking-wider block text-[9px]">Plan</span><div class="flex items-center gap-2 mt-0.5"><span class="type-ui font-bold text-neutral-900"></span></div></div></div></div><div>`);
function AccountTab(props) {
  const [deactivating, setDeactivating] = createSignal(false);
  const devices = () => {
    const custom = layoutStore.licenseState?.devices;
    if (Array.isArray(custom) && custom.length > 0) return custom;
    if (!layoutStore.isPremium) return [];
    const os = typeof navigator !== "undefined" && navigator.platform?.includes("Win") ? "Windows 11" : "macOS";
    return [{
      id: "dev_current",
      name: layoutStore.licenseState?.label || "Office Workstation",
      os,
      isCurrent: true
    }];
  };
  const planName = () => {
    if (!layoutStore.isPremium) return "Free Plan";
    const t = layoutStore.capabilities?.tier;
    if (t === "tier3") return "Pro Tier 3";
    if (t === "tier2") return "Pro Tier 2";
    if (t === "tier1") return "Tier 1 (Personal)";
    if (layoutStore.licenseState?.planName) return layoutStore.licenseState.planName;
    return "Pro Lifetime";
  };
  const handleDeactivate = async () => {
    if (!confirm("Remove license from this computer? This frees up your license to use on another computer.")) return;
    setDeactivating(true);
    try {
      await window.api?.deactivateLicenseKey?.();
      setLayoutStore("isPremium", false);
      setLayoutStore("licenseState", null);
      const caps = await window.api?.getCapabilities?.();
      if (caps) setLayoutStore("capabilities", caps);
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "License removed from this computer.",
          type: "success"
        }
      }));
    } catch {
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "Failed to remove license.",
          type: "error"
        }
      }));
    } finally {
      setDeactivating(false);
    }
  };
  const handleRefresh = async () => {
    const key = layoutStore.licenseState?.key;
    if (!key) return;
    const res = await window.api?.validateLicenseKey(key);
    const isPrem = await window.api?.checkPremiumStatus?.();
    setLayoutStore("isPremium", Boolean(isPrem));
    const [caps, state] = await Promise.all([window.api?.getCapabilities?.(), window.api?.getLicenseState?.()]);
    if (caps) setLayoutStore("capabilities", caps);
    if (state) setLayoutStore("licenseState", state);
    const msg = res?.success ? "License validated." : res?.error || "License is inactive";
    window.dispatchEvent(new CustomEvent("app:toast", {
      detail: {
        message: msg,
        type: res?.success ? "success" : "error"
      }
    }));
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
  return (() => {
    var _el$ = _tmpl$6$2(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild, _el$24 = _el$2.nextSibling;
    insert(_el$, createComponent(AccountProfileHeader, {}), _el$2);
    insert(_el$7, planName);
    insert(_el$6, createComponent(Show, {
      get when() {
        return layoutStore.isPremium;
      },
      get children() {
        return _tmpl$$6();
      }
    }), null);
    insert(_el$3, createComponent(Show, {
      get when() {
        return memo(() => !!layoutStore.isPremium)() && layoutStore.licenseState?.key;
      },
      get children() {
        var _el$9 = _tmpl$2$6(), _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.nextSibling, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling;
        _el$0.$$click = handleRefresh;
        _el$10.$$click = () => window.electron?.ipcRenderer.send("window.openExternal", "https://users.freemius.com/");
        _el$12.$$click = handleDeactivate;
        insert(_el$12, () => deactivating() ? "Removing..." : "Remove");
        createRenderEffect(() => _el$12.disabled = deactivating());
        return _el$9;
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return layoutStore.licenseState?.key;
      },
      get children() {
        return [(() => {
          var _el$13 = _tmpl$3$6(), _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling;
          insert(_el$16, () => (layoutStore.licenseState?.key || "").replace(/^(.{8}).*(.{4})$/, "$1-****-****-$2"));
          _el$17.$$click = () => {
            if (layoutStore.licenseState?.key) navigator.clipboard.writeText(layoutStore.licenseState.key);
          };
          return _el$13;
        })(), createComponent(Show, {
          get when() {
            return layoutStore.licenseState?.isGracePeriod;
          },
          get children() {
            var _el$18 = _tmpl$4$3(), _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling;
            insert(_el$20, (() => {
              var _c$ = memo(() => !!layoutStore.licenseState?.graceExpiresAt);
              return () => _c$() ? `${Math.max(1, Math.ceil((layoutStore.licenseState.graceExpiresAt - Date.now()) / 864e5))}d left` : "Active";
            })());
            return _el$18;
          }
        }), createComponent(Show, {
          get when() {
            return layoutStore.licenseState?.expiresAt;
          },
          get children() {
            var _el$21 = _tmpl$5$2(), _el$22 = _el$21.firstChild, _el$23 = _el$22.nextSibling;
            insert(_el$23, () => formatDate(layoutStore.licenseState?.expiresAt));
            return _el$21;
          }
        }), createComponent(Show, {
          get when() {
            return memo(() => !!layoutStore.isPremium)() && devices().length > 0;
          },
          get children() {
            return createComponent(AccountDevicesList, {
              get devices() {
                return devices();
              },
              onDeactivate: handleDeactivate,
              get deactivating() {
                return deactivating();
              },
              get maxSeats() {
                return layoutStore.capabilities?.maxDeviceSeats ?? 2;
              }
            });
          }
        })];
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return !layoutStore.isPremium;
      },
      get children() {
        return createComponent(AccountActivationBox, {
          get onClose() {
            return props.onClose;
          }
        });
      }
    }), null);
    insert(_el$24, createComponent(UpdateCard, {}));
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$5 = /* @__PURE__ */ template(`<div class="space-y-3.5 max-w-lg mx-auto select-none"><div class="flex items-center justify-between px-0.5"><div><h3 class="type-ui font-semibold text-neutral-900">Default Profiles</h3><p class="type-caption text-neutral-500 font-normal">Assign the default browsing identity for each workspace.</p></div></div><div class="bg-white border border-neutral-200/80 rounded-xl shadow-2xs overflow-hidden divide-y divide-neutral-100">`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-3.5 hover:bg-neutral-50/70 transition-colors"><div class="flex items-center gap-3 min-w-0"><div class="w-8 h-8 rounded-lg bg-neutral-100 border border-neutral-200/80 flex items-center justify-center text-neutral-700 shrink-0"></div><div class=min-w-0><div class="type-ui font-semibold text-neutral-900 truncate"></div><div class="type-telemetry text-neutral-400 font-telemetry"></div></div></div><div class="relative shrink-0"><select class="appearance-none type-caption font-medium bg-neutral-50 hover:bg-neutral-100/80 border border-neutral-200/90 rounded-lg py-1.5 pl-3 pr-7 text-neutral-800 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:bg-white transition-all shadow-2xs cursor-pointer"><option value=main>Main (Default)</option></select><div class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 flex items-center"><svg width=11 height=11 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="6 9 12 15 18 9">`), _tmpl$3$5 = /* @__PURE__ */ template(`<option>`);
function WorkspacesTab(props) {
  return (() => {
    var _el$ = _tmpl$$5(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
    insert(_el$3, createComponent(For, {
      get each() {
        return props.ws.workspaces();
      },
      children: (workspace) => (() => {
        var _el$4 = _tmpl$2$5(), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$5.nextSibling, _el$1 = _el$0.firstChild;
        _el$1.firstChild;
        insert(_el$6, createComponent(WorkspaceIcon, {
          get icon() {
            return workspace.icon;
          },
          get name() {
            return workspace.name;
          },
          size: 15,
          strokeWidth: 1.75
        }));
        insert(_el$8, () => workspace.name);
        insert(_el$9, () => workspace.id);
        _el$1.addEventListener("change", async (e) => {
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
        insert(_el$1, createComponent(For, {
          get each() {
            return layoutStore.profiles.filter((p) => p.id !== "main");
          },
          children: (profile) => (() => {
            var _el$11 = _tmpl$3$5();
            insert(_el$11, () => profile.name);
            createRenderEffect(() => _el$11.value = profile.id);
            return _el$11;
          })()
        }), null);
        createRenderEffect(() => _el$1.value = workspace.default_profile_id || "main");
        return _el$4;
      })()
    }));
    return _el$;
  })();
}
var _tmpl$$4 = /* @__PURE__ */ template(`<div class="space-y-3 mt-4 border-t border-neutral-100 pt-4"><div class=space-y-0.5><h4 class="type-ui font-semibold text-neutral-800 uppercase tracking-wider">Launchpad Shortcuts</h4><p class="type-telemetry text-neutral-500">Default bookmarks opened within this profile</p></div><div class="flex items-center gap-2"><input type=text class="flex-1 bg-white border border-neutral-200 rounded-lg px-3 py-2 type-ui text-neutral-800 outline-none focus:border-neutral-800 shadow-xs"placeholder="Website URL (e.g. app.slack.com)"><button class="type-ui font-medium bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg px-3.5 py-2 disabled:opacity-50 transition-colors cursor-pointer shadow-xs">Add</button></div><div class="border border-neutral-200/80 rounded-xl overflow-hidden divide-y divide-neutral-100 max-h-40 overflow-y-auto bg-neutral-50/50">`), _tmpl$2$4 = /* @__PURE__ */ template(`<div class="p-3 text-center type-caption text-neutral-400 italic">No shortcuts configured.`), _tmpl$3$4 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-2 hover:bg-white transition-colors"><div class="flex items-center gap-2 min-w-0"><div class="flex flex-col min-w-0"><span class="type-ui font-medium text-neutral-800 truncate"></span><span class="type-telemetry text-neutral-400 font-telemetry truncate"></span></div></div><div class="flex items-center gap-1"><button class="p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-30 cursor-pointer">▲</button><button class="p-1 hover:bg-neutral-100 rounded text-neutral-400 hover:text-neutral-700 disabled:opacity-30 cursor-pointer">▼</button><button class="p-1 hover:bg-red-50 text-neutral-400 hover:text-red-600 rounded cursor-pointer">✕`);
function ProfileShortcutsManager(props) {
  const [apps, setApps] = createSignal([]);
  const [newUrl, setNewUrl] = createSignal("");
  const loadApps = () => {
    const top = frecencyEngine.getTopApps(8);
    setApps(top.map((app) => ({
      id: app.id,
      name: app.name,
      domain: app.domain,
      url: app.url,
      category: "Tools",
      isPinned: app.isPinned
    })));
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
var _tmpl$$3 = /* @__PURE__ */ template(`<span class="type-caption font-normal text-neutral-400">(Default)`), _tmpl$2$3 = /* @__PURE__ */ template(`<span class="type-telemetry font-medium text-neutral-500 bg-neutral-100 border border-neutral-200/80 px-1.5 py-0.2 rounded-md">Incognito`), _tmpl$3$3 = /* @__PURE__ */ template(`<span class="type-telemetry font-semibold text-neutral-500 bg-neutral-100 border border-neutral-200/80 px-1.5 py-0.2 rounded-md tracking-wider">PRO (Inactive)`), _tmpl$4$2 = /* @__PURE__ */ template(`<button title="Delete Profile"class="p-1 text-neutral-400 hover:text-red-600 hover:bg-red-50/70 rounded-md transition-colors cursor-pointer"><svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2">`), _tmpl$5$1 = /* @__PURE__ */ template(`<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-neutral-50/80 hover:bg-white border border-neutral-200/90 shadow-2xs transition-all cursor-pointer min-w-0"><div class="w-3.5 h-3.5 rounded-full bg-white border border-neutral-200/60 flex items-center justify-center p-0.5 shrink-0 overflow-hidden"><img class="w-3 h-3 object-contain"></div><span class="type-ui font-normal text-neutral-800 truncate max-w-[190px]">`), _tmpl$6$1 = /* @__PURE__ */ template(`<div class="flex flex-col gap-2.5 p-3.5 bg-white rounded-xl border border-neutral-200/80 shadow-2xs hover:border-neutral-300 transition-all group select-none"><div class="flex items-center justify-between"><div class="flex items-center gap-2.5 min-w-0"><div class="flex items-center justify-center w-7 h-7 rounded-lg text-white type-caption font-bold shadow-2xs shrink-0"></div><div class="flex items-center gap-1.5 min-w-0 flex-wrap"><span class="type-ui font-semibold text-neutral-900 truncate"></span></div></div><div class="flex items-center gap-1 shrink-0"><button class="px-2.5 py-1 type-caption font-medium text-neutral-700 hover:text-neutral-950 bg-white hover:bg-neutral-50 rounded-lg transition-all shrink-0 cursor-pointer border border-neutral-200/90 shadow-2xs active:scale-[0.98]">Configure</button></div></div><div class="flex items-center justify-between pt-2 border-t border-neutral-100 min-h-[30px]"><div class="flex items-center gap-1.5 overflow-hidden min-w-0">`), _tmpl$7$1 = /* @__PURE__ */ template(`<button type=button class="flex items-center gap-1 px-2 py-0.5 rounded-md border border-neutral-200/80 bg-neutral-50/60 hover:bg-neutral-100/80 type-caption font-medium text-neutral-600 hover:text-neutral-900 transition-all cursor-pointer shadow-2xs"><span>+</span><span>Connect account`), _tmpl$8$1 = /* @__PURE__ */ template(`<div class="w-6 h-6 rounded-md bg-neutral-50 border border-neutral-200/90 flex items-center justify-center shrink-0 shadow-2xs"><img class="w-3 h-3 object-contain">`);
function ProfileCard(props) {
  const [copied, setCopied] = createSignal(false);
  const activeIdentitiesList = () => getSortedIdentities(props.profile.identities_json);
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
    var _el$ = _tmpl$6$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$5.firstChild, _el$0 = _el$3.nextSibling, _el$10 = _el$0.firstChild, _el$11 = _el$2.nextSibling, _el$12 = _el$11.firstChild;
    insert(_el$4, () => props.profile.name.charAt(0).toUpperCase());
    insert(_el$6, () => props.profile.name);
    insert(_el$5, createComponent(Show, {
      get when() {
        return isDefault();
      },
      get children() {
        return _tmpl$$3();
      }
    }), null);
    insert(_el$5, createComponent(Show, {
      get when() {
        return props.profile.is_ephemeral;
      },
      get children() {
        return _tmpl$2$3();
      }
    }), null);
    insert(_el$5, createComponent(Show, {
      get when() {
        return memo(() => !!!layoutStore.isPremium)() && !isDefault();
      },
      get children() {
        return _tmpl$3$3();
      }
    }), null);
    insert(_el$0, createComponent(Show, {
      get when() {
        return props.onDelete;
      },
      get children() {
        var _el$1 = _tmpl$4$2();
        _el$1.$$click = (e) => {
          e.stopPropagation();
          props.onDelete?.();
        };
        return _el$1;
      }
    }), _el$10);
    addEventListener(_el$10, "click", props.onConfigure, true);
    insert(_el$12, createComponent(Show, {
      get when() {
        return primaryIdentity();
      },
      get fallback() {
        return (() => {
          var _el$17 = _tmpl$7$1();
          addEventListener(_el$17, "click", props.onConfigure, true);
          return _el$17;
        })();
      },
      get children() {
        return [(() => {
          var _el$13 = _tmpl$5$1(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$14.nextSibling;
          _el$13.$$click = handleCopyEmail;
          _el$15.addEventListener("error", (e) => {
            e.currentTarget.style.display = "none";
          });
          insert(_el$16, (() => {
            var _c$ = memo(() => !!copied());
            return () => _c$() ? "✓ Copied" : primaryIdentity()?.email || primaryIdentity()?.handle;
          })());
          createRenderEffect((_p$) => {
            var _v$ = `Click to copy: ${primaryIdentity()?.email || primaryIdentity()?.handle}`, _v$2 = `https://www.google.com/s2/favicons?domain=${getProviderDomain(primaryIdentity()?.providerId)}&sz=64`, _v$3 = primaryIdentity()?.providerId;
            _v$ !== _p$.e && setAttribute(_el$13, "title", _p$.e = _v$);
            _v$2 !== _p$.t && setAttribute(_el$15, "src", _p$.t = _v$2);
            _v$3 !== _p$.a && setAttribute(_el$15, "alt", _p$.a = _v$3);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0
          });
          return _el$13;
        })(), createComponent(For, {
          get each() {
            return secondaryIdentities();
          },
          children: (ident) => (() => {
            var _el$18 = _tmpl$8$1(), _el$19 = _el$18.firstChild;
            _el$19.addEventListener("error", (e) => {
              e.currentTarget.style.display = "none";
            });
            createRenderEffect((_p$) => {
              var _v$4 = `${ident.providerId}: ${ident.email || ident.handle || ""}`, _v$5 = `https://www.google.com/s2/favicons?domain=${getProviderDomain(ident.providerId)}&sz=64`, _v$6 = ident.providerId;
              _v$4 !== _p$.e && setAttribute(_el$18, "title", _p$.e = _v$4);
              _v$5 !== _p$.t && setAttribute(_el$19, "src", _p$.t = _v$5);
              _v$6 !== _p$.a && setAttribute(_el$19, "alt", _p$.a = _v$6);
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$18;
          })()
        })];
      }
    }));
    createRenderEffect((_$p) => setStyleProperty(_el$4, "background-color", props.profile.color || "#40403e"));
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<div class="flex items-center justify-between px-0.5"><div class=space-y-0.5><h3 class="type-ui font-semibold text-neutral-900">Profiles</h3><p class="type-caption font-normal text-neutral-500">Keep separate accounts, history, and cookies across workspaces.</p></div><button class="flex items-center gap-1.5 type-caption font-semibold bg-neutral-900 hover:bg-black text-white px-3 py-1.5 rounded-lg transition-all shadow-2xs shrink-0 cursor-pointer active:scale-[0.98]"><span>+</span><span>New profile`), _tmpl$2$2 = /* @__PURE__ */ template(`<div class="grid grid-cols-1 gap-2.5">`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class="space-y-3.5 max-w-lg mx-auto select-none">`), _tmpl$4$1 = /* @__PURE__ */ template(`<div class=space-y-3><div class="flex items-center gap-2"><button class="type-caption font-medium text-neutral-500 hover:text-neutral-900 transition-colors flex items-center gap-1 cursor-pointer"><span>←</span> Back to profiles</button></div><h3 class="type-ui font-semibold text-neutral-900">`);
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
            if (!layoutStore.isPremium && layoutStore.profiles.length >= 1) {
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
              onConfigure: () => props.setEditingProfileId(profile.id),
              get onDelete() {
                return profile.id !== "main" ? () => props.handleDeleteProfile(profile.id) : void 0;
              }
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
var _tmpl$$1 = /* @__PURE__ */ template(`<span class="text-neutral-400 mx-1 type-telemetry font-medium">+`), _tmpl$2$1 = /* @__PURE__ */ template(`<div class="flex items-center"><kbd class="px-2 py-0.5 rounded-md bg-white border border-neutral-200/90 shadow-2xs type-caption font-telemetry font-semibold text-neutral-800 tracking-wide">`), _tmpl$3$1 = /* @__PURE__ */ template(`<div class="flex items-center">`), _tmpl$4 = /* @__PURE__ */ template(`<div data-shortcut-recorder=true tabindex=0>`), _tmpl$5 = /* @__PURE__ */ template(`<span class="type-caption font-medium text-neutral-900 animate-pulse">Press keys...`), _tmpl$6 = /* @__PURE__ */ template(`<div class="space-y-4 max-w-lg mx-auto select-none"><div class="flex items-center justify-between px-0.5"><div><h3 class="type-ui font-semibold text-neutral-900">Keyboard Shortcuts</h3><p class="type-caption text-neutral-500 font-normal">Custom keybindings for rapid spatial navigation.</p></div><button class="type-caption font-medium text-neutral-500 hover:text-red-600 transition-colors px-2 py-1 rounded-md hover:bg-red-50/70 cursor-pointer">Reset Defaults</button></div><div class="space-y-4 pb-2">`), _tmpl$7 = /* @__PURE__ */ template(`<div class=space-y-2><span class="type-telemetry font-semibold text-neutral-400 uppercase tracking-wider block px-1"></span><div class="bg-white border border-neutral-200/80 rounded-xl overflow-hidden divide-y divide-neutral-100 shadow-2xs">`), _tmpl$8 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-3 hover:bg-neutral-50/70 transition-colors"><span class="type-ui font-medium text-neutral-800">`);
function ShortcutRecorder(props) {
  const [isRecording, setIsRecording] = createSignal(false);
  const handleKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setIsRecording(false);
      return;
    }
    const isMac = isMacPlatform();
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
    const isMac = isMacPlatform();
    const parts = [];
    if (s.mod) parts.push(isMac ? "⌘" : "Ctrl");
    if (s.ctrl) parts.push(isMac ? "⌃" : "Ctrl");
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
    createRenderEffect(() => className(_el$4, `flex items-center justify-end min-w-[120px] h-8 px-2 rounded-lg transition-all cursor-pointer ${isRecording() ? "bg-neutral-100 ring-1 ring-neutral-900 shadow-2xs" : "hover:bg-neutral-50 border border-transparent hover:border-neutral-200/60"}`));
    return _el$4;
  })();
}
function ShortcutsTab() {
  return (() => {
    var _el$7 = _tmpl$6(), _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling, _el$1 = _el$8.nextSibling;
    _el$0.$$click = () => {
      localStorage.removeItem("apposition_shortcuts");
      setActiveShortcuts([...DEFAULT_SHORTCUTS]);
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
function computeSettingsPosition(anchor, portalRoot) {
  const margin = 8;
  const targetHeight = 520;
  if (!anchor) {
    return {
      top: "calc(50% - 260px)",
      left: "calc(50% - 280px)",
      width: "560px",
      height: `${targetHeight}px`,
      "max-height": `${targetHeight}px`
    };
  }
  if (portalRoot) {
    const pRect = portalRoot.getBoundingClientRect();
    const pWidth = portalRoot.offsetWidth || portalRoot.clientWidth || 1280;
    const pHeight = portalRoot.offsetHeight || portalRoot.clientHeight || 800;
    const scaleX = pRect.width > 0 && pWidth > 0 ? pRect.width / pWidth : 1;
    const scaleY = pRect.height > 0 && pHeight > 0 ? pRect.height / pHeight : 1;
    const localLeft = Math.round((anchor.left - pRect.left) / scaleX);
    const localTop = Math.round((anchor.top - pRect.top) / scaleY);
    const localWidth = Math.round(anchor.width / scaleX);
    const localHeight = Math.round(anchor.height / scaleY);
    const isLeftHalf2 = localLeft < pWidth / 2;
    const isBottomHalf2 = localTop > pHeight / 2;
    const style22 = {};
    if (isLeftHalf2) {
      style22.left = `${localLeft + localWidth + margin}px`;
    } else {
      style22.right = `${pWidth - localLeft}px`;
    }
    const availableHeight2 = isBottomHalf2 ? Math.max(300, localTop + localHeight - margin * 2) : Math.max(300, pHeight - localTop - margin * 2);
    const popoverHeight2 = Math.min(targetHeight, availableHeight2);
    if (isBottomHalf2) {
      style22.bottom = `${Math.max(margin, pHeight - (localTop + localHeight))}px`;
    } else {
      style22.top = `${Math.max(margin, localTop)}px`;
    }
    style22["max-height"] = `${popoverHeight2}px`;
    style22.height = `${popoverHeight2}px`;
    return style22;
  }
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const isLeftHalf = anchor.left < vw / 2;
  const isBottomHalf = anchor.top > vh / 2;
  const style2 = {};
  if (isLeftHalf) {
    style2.left = `${anchor.left + anchor.width + margin}px`;
  } else {
    style2.right = `${vw - anchor.left}px`;
  }
  const availableHeight = isBottomHalf ? Math.max(300, anchor.top + anchor.height - margin * 2) : Math.max(300, vh - anchor.top - margin * 2);
  const popoverHeight = Math.min(targetHeight, availableHeight);
  if (isBottomHalf) {
    style2.bottom = `${Math.max(margin, vh - (anchor.top + anchor.height))}px`;
  } else {
    style2.top = `${Math.max(margin, anchor.top)}px`;
  }
  style2["max-height"] = `${popoverHeight}px`;
  style2.height = `${popoverHeight}px`;
  return style2;
}
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="absolute inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<div data-overlay-chrome class="absolute z-[99999] w-[560px] bg-white border border-neutral-200/90 rounded-2xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 pointer-events-auto select-none"><div class="flex items-center justify-between px-5 py-3 border-b border-neutral-200/70 bg-white shrink-0"><div class="flex items-center gap-3.5"><h2 class="type-title font-semibold text-neutral-900 tracking-tight">Settings</h2><div class="flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-200/70"></div></div><button class="p-1.5 text-neutral-400 hover:text-neutral-800 rounded-lg hover:bg-neutral-100 transition-colors cursor-pointer"title=Close><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button></div><div class="flex-1 min-h-0 overflow-y-auto bg-white p-5 relative z-10 overscroll-contain">`), _tmpl$3 = /* @__PURE__ */ template(`<button>`);
function SettingsPopover(props) {
  const [activeTab, setActiveTab] = createSignal(layoutStore.settingsActiveTab || "account");
  const [editingProfileId, setEditingProfileId] = createSignal(null);
  const [isCreatingProfile, setIsCreatingProfile] = createSignal(false);
  let popoverRef;
  const handleSaveProfile = async (data) => {
    const maxProfiles = layoutStore.capabilities?.maxActiveProfiles ?? (layoutStore.isPremium ? Infinity : 1);
    if (!data.id && layoutStore.profiles.length >= maxProfiles) {
      setLayoutStore("paywallReason", "multi_account");
      setLayoutStore("showPaywall", true);
      return;
    }
    if (data.proxy_server && !layoutStore.capabilities?.allowProxy) {
      setLayoutStore("paywallReason", "proxy_feature");
      setLayoutStore("showPaywall", true);
      return;
    }
    if (!data.id) {
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
    const portalRoot = typeof document !== "undefined" ? document.getElementById("app-portal-root") : null;
    return computeSettingsPosition(layoutStore.settingsAnchor, portalRoot);
  };
  const portalTarget = () => typeof document !== "undefined" ? document.getElementById("app-portal-root") || void 0 : void 0;
  return createComponent(Portal, {
    get mount() {
      return portalTarget();
    },
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
        var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$4.nextSibling, _el$8 = _el$3.nextSibling;
        _el$2.$$mousedown = (e) => e.stopPropagation();
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$2) : popoverRef = _el$2;
        insert(_el$6, createComponent(For, {
          each: ["account", "profiles", "workspaces", "shortcuts"],
          children: (tab) => (() => {
            var _el$9 = _tmpl$3();
            _el$9.$$click = () => setActiveTab(tab);
            _el$9.$$mousedown = (e) => e.stopPropagation();
            insert(_el$9, () => tab.charAt(0).toUpperCase() + tab.slice(1));
            createRenderEffect(() => className(_el$9, `px-2.5 py-1 rounded-md type-ui transition-all cursor-pointer ${activeTab() === tab ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`));
            return _el$9;
          })()
        }));
        addEventListener(_el$7, "click", props.onClose, true);
        insert(_el$8, createComponent(Show, {
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
        insert(_el$8, createComponent(Show, {
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
        insert(_el$8, createComponent(Show, {
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
        insert(_el$8, createComponent(Show, {
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
