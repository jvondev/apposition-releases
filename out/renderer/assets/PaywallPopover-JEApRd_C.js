import { k as createSignal, f as onMount, D as onCleanup, n as layoutStore, p as setLayoutStore, c as createComponent, H as Portal, w as addEventListener, g as insert, h as Show, j as createRenderEffect, B as className, E as style, t as template, e as delegateEvents } from "./index-Dxnrzc_q.js";
function usePaywallController() {
  const [key, setKey] = createSignal("");
  const [selectedCycle, setSelectedCycle] = createSignal("annual");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal(null);
  const [success, setSuccess] = createSignal(false);
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && layoutStore.showPaywall) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  const getReasonText = () => {
    switch (layoutStore.paywallReason) {
      case "profile":
        return "Multi-account switching is a Pro feature. Free includes 1 active account; upgrade to Pro to switch between unlimited accounts seamlessly.";
      case "floating_pane":
        return "Free includes 1 open floating pane. Upgrade to Pro for unlimited floating multi-panes and canvas overlays.";
      default:
        return "Upgrade to Pro to unlock unlimited power features.";
    }
  };
  const getPopoverStyle = () => {
    const anchor = layoutStore.paywallAnchor;
    if (!anchor) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const popoverWidth = 320;
    const popoverHeight = 180;
    let left = anchor.left + anchor.width + 16;
    if (left + popoverWidth > window.innerWidth - 20) {
      left = anchor.left - popoverWidth - 16;
    }
    let top = anchor.top + anchor.height / 2 - popoverHeight / 2;
    if (top < 20) top = 20;
    if (top + popoverHeight > window.innerHeight - 20)
      top = window.innerHeight - popoverHeight - 20;
    return { top: `${top}px`, left: `${left}px` };
  };
  const handleActivate = async (e) => {
    e.preventDefault();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Connect to the internet to activate your license.");
      return;
    }
    const cleanKey = key().trim().replace(/^["']|["']$/g, "");
    if (!cleanKey) {
      setError("Please enter a license key.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.api?.activateLicenseKey(cleanKey);
      if (res && res.success) {
        setSuccess(true);
        try {
          const state = await window.api?.getLicenseState?.();
          if (state) setLayoutStore("licenseState", state);
        } catch {
        }
        setTimeout(() => {
          setLayoutStore("isPremium", true);
          setLayoutStore("showPaywall", false);
          setSuccess(false);
          setKey("");
        }, 1200);
      } else {
        setError(
          res?.error || "Invalid license key. Please check and try again."
        );
      }
    } catch (err) {
      setError(err.message || "An error occurred during activation.");
    } finally {
      setLoading(false);
    }
  };
  const handleBuy = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setError("You are offline. Connect to the internet to purchase.");
      return;
    }
    try {
      let checkoutUrl = await window.api?.getCheckoutUrl?.();
      if (!checkoutUrl) {
        checkoutUrl = "https://checkout.freemius.com/mode/dialog/plugin/38794/plan/65379/";
      }
      try {
        const parsed = new URL(checkoutUrl);
        parsed.searchParams.set("billing_cycle", selectedCycle());
        checkoutUrl = parsed.toString();
      } catch {
      }
      window.electron?.ipcRenderer.send("window.openExternal", checkoutUrl);
    } catch {
      const fallback = "https://checkout.freemius.com/mode/dialog/plugin/38794/plan/65379/";
      window.electron?.ipcRenderer.send("window.openExternal", fallback);
    }
  };
  const close = () => {
    setLayoutStore("showPaywall", false);
    setLayoutStore("paywallAnchor", null);
  };
  return {
    key,
    setKey,
    selectedCycle,
    setSelectedCycle,
    loading,
    error,
    success,
    getReasonText,
    getPopoverStyle,
    handleActivate,
    handleBuy,
    close
  };
}
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<svg class="animate-spin h-3.5 w-3.5"xmlns=http://www.w3.org/2000/svg fill=none viewBox="0 0 24 24"><circle class=opacity-25 cx=12 cy=12 r=10 stroke=currentColor stroke-width=4></circle><path class=opacity-75 fill=currentColor d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">`), _tmpl$3 = /* @__PURE__ */ template(`<span class="text-[11px] text-red-500 font-medium px-0.5">`), _tmpl$4 = /* @__PURE__ */ template(`<div class="flex flex-col gap-2.5 mt-1"><div class="flex items-center p-0.5 bg-neutral-100 rounded-lg border border-neutral-200/70"><button type=button><span>Annual</span><span class="text-[8.5px] px-1 py-0.5 bg-neutral-100 text-neutral-800 border border-neutral-300 rounded font-semibold leading-tight">-17%</span></button><button type=button><span>Monthly</span></button></div><button type=button class="w-full py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-[8px] text-[12px] transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"><svg xmlns=http://www.w3.org/2000/svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg><span></span></button><div class="flex items-center gap-2 pt-1"><div class="flex-1 h-[1px] bg-neutral-200/80"></div><span class="text-[10px] text-neutral-400 font-medium">or activate license</span><div class="flex-1 h-[1px] bg-neutral-200/80"></div></div><form class="flex flex-col gap-1.5"><div class="flex gap-1.5"><input type=text placeholder="Paste license key..."class="flex-1 px-2.5 py-1.5 text-[11px] bg-white border border-neutral-200/80 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 transition-all placeholder-neutral-400 text-neutral-800 shadow-2xs"><button type=submit class="px-3 py-1.5 bg-white hover:bg-neutral-50 border border-neutral-200/80 disabled:bg-neutral-100 disabled:text-neutral-400 disabled:cursor-not-allowed text-neutral-800 rounded-[8px] text-[11px] font-medium transition-all shadow-2xs flex items-center justify-center shrink-0 cursor-pointer">`), _tmpl$5 = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed z-[99999] w-[320px] bg-white ring-1 ring-black/[0.06] border border-neutral-200/60 rounded-[16px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] p-4 animate-in fade-in zoom-in-[0.98] duration-200 pointer-events-auto"><button class="absolute top-3.5 right-3.5 text-neutral-400 hover:text-neutral-700 transition-colors p-1 rounded-md hover:bg-neutral-100"><svg xmlns=http://www.w3.org/2000/svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button><div class="flex flex-col gap-3"><div><div class="inline-block px-2 py-0.5 bg-neutral-100 rounded-md border border-neutral-200/60 mb-2"><span class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Pro Feature</span></div><h3 class="text-[14px] font-semibold text-neutral-900 leading-tight">Unlock full access</h3></div><p class="text-[12px] text-neutral-500 leading-relaxed"> Upgrade to Pro to unlock unlimited capabilities.`), _tmpl$6 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-center py-4 text-center animate-in zoom-in-95 duration-200"><div class="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 mb-2 border border-emerald-200/50"><svg xmlns=http://www.w3.org/2000/svg width=20 height=20 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="20 6 9 17 4 12"></polyline></svg></div><p class="text-[12px] font-semibold text-emerald-700">Pro Activated!</p><p class="text-[11px] text-neutral-500 mt-0.5">All capabilities are now fully unlocked.`);
function PaywallPopover() {
  const ctrl = usePaywallController();
  return createComponent(Show, {
    get when() {
      return layoutStore.showPaywall;
    },
    get children() {
      return createComponent(Portal, {
        get children() {
          return [(() => {
            var _el$ = _tmpl$();
            _el$.$$mousedown = (e) => {
              e.preventDefault();
              e.stopPropagation();
              ctrl.close();
            };
            return _el$;
          })(), (() => {
            var _el$2 = _tmpl$5(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild;
            addEventListener(_el$3, "click", ctrl.close, true);
            insert(_el$6, () => ctrl.getReasonText(), _el$7);
            insert(_el$4, createComponent(Show, {
              get when() {
                return !ctrl.success();
              },
              get fallback() {
                return _tmpl$6();
              },
              get children() {
                var _el$8 = _tmpl$4(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$9.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$10.nextSibling, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling;
                _el$0.$$click = () => ctrl.setSelectedCycle("annual");
                _el$1.$$click = () => ctrl.setSelectedCycle("monthly");
                addEventListener(_el$10, "click", ctrl.handleBuy, true);
                insert(_el$12, () => ctrl.selectedCycle() === "annual" ? "Get Pro Annual ($10/mo)" : "Get Pro Monthly ($12/mo)");
                addEventListener(_el$14, "submit", ctrl.handleActivate);
                _el$16.$$input = (e) => ctrl.setKey(e.currentTarget.value);
                insert(_el$17, createComponent(Show, {
                  get when() {
                    return ctrl.loading();
                  },
                  fallback: "Activate",
                  get children() {
                    return _tmpl$2();
                  }
                }));
                insert(_el$14, createComponent(Show, {
                  get when() {
                    return ctrl.error();
                  },
                  get children() {
                    var _el$19 = _tmpl$3();
                    insert(_el$19, () => ctrl.error());
                    return _el$19;
                  }
                }), null);
                createRenderEffect((_p$) => {
                  var _v$ = `flex-1 py-1 text-[11px] rounded-md transition-all flex items-center justify-center gap-1 cursor-pointer ${ctrl.selectedCycle() === "annual" ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`, _v$2 = `flex-1 py-1 text-[11px] rounded-md transition-all flex items-center justify-center cursor-pointer ${ctrl.selectedCycle() === "monthly" ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`, _v$3 = ctrl.loading(), _v$4 = ctrl.loading() || !ctrl.key().trim();
                  _v$ !== _p$.e && className(_el$0, _p$.e = _v$);
                  _v$2 !== _p$.t && className(_el$1, _p$.t = _v$2);
                  _v$3 !== _p$.a && (_el$16.disabled = _p$.a = _v$3);
                  _v$4 !== _p$.o && (_el$17.disabled = _p$.o = _v$4);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0,
                  a: void 0,
                  o: void 0
                });
                createRenderEffect(() => _el$16.value = ctrl.key());
                return _el$8;
              }
            }), null);
            createRenderEffect((_$p) => style(_el$2, ctrl.getPopoverStyle(), _$p));
            return _el$2;
          })()];
        }
      });
    }
  });
}
delegateEvents(["mousedown", "click", "input"]);
export {
  PaywallPopover as default
};
