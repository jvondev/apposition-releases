import { g as insert, c as createComponent, h as Show, j as createRenderEffect, B as className, F as For, t as template, p as layoutStore, k as createSignal, f as onMount, D as onCleanup, n as setLayoutStore, m as memo, w as addEventListener, J as DoubleBezel, e as delegateEvents, G as use, l as setAttribute, H as Portal, E as style } from "./index-DNpM2k5E.js";
function sanitizeLicenseKey(rawKey) {
  if (!rawKey) return "";
  return rawKey.replace(/^[\uFEFF\xA0\s"']+|[\uFEFF\xA0\s"']+$/g, "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}
function sanitizeEmail(rawEmail) {
  if (!rawEmail) return "";
  return rawEmail.replace(/^[\uFEFF\xA0\s"']+|[\uFEFF\xA0\s"']+$/g, "").trim().toLowerCase();
}
function isValidEmailFormat(email) {
  if (!email || email.length < 5 || email.length > 254) return false;
  const regex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return regex.test(email);
}
function validateActivationInvariants(state) {
  const cleanKey = sanitizeLicenseKey(state.key);
  switch (state.status) {
    case "IDLE":
      return true;
    case "ACTIVATING":
      return cleanKey.length > 0;
    case "AWAITING_EMAIL":
      return cleanKey.length > 0;
    case "SUCCESS":
      return cleanKey.length > 0;
    case "ERROR":
      return true;
    default:
      return false;
  }
}
function createInitialActivationState(initialKey = "") {
  return {
    status: "IDLE",
    key: sanitizeLicenseKey(initialKey)
  };
}
function reduceActivationState(state, event) {
  if (state.status === "SUCCESS" && event.type !== "RESET") {
    return [state, []];
  }
  let result;
  switch (event.type) {
    case "RESET": {
      result = [{ status: "IDLE", key: "" }, []];
      break;
    }
    case "KEY_INPUT": {
      const clean = sanitizeLicenseKey(event.key);
      if (clean === "") {
        result = [{ status: "IDLE", key: "" }, []];
        break;
      }
      if (state.status === "AWAITING_EMAIL") {
        result = [
          { status: "AWAITING_EMAIL", key: clean, email: state.email, error: void 0 },
          []
        ];
        break;
      }
      result = [{ status: "IDLE", key: clean }, []];
      break;
    }
    case "EMAIL_INPUT": {
      const cleanEmail = sanitizeEmail(event.email);
      if (state.status === "AWAITING_EMAIL") {
        result = [
          { status: "AWAITING_EMAIL", key: state.key, email: cleanEmail, error: void 0 },
          []
        ];
        break;
      }
      if (state.status === "ERROR" && state.isEmailPhase) {
        result = [
          { status: "AWAITING_EMAIL", key: state.key, email: cleanEmail, error: void 0 },
          []
        ];
        break;
      }
      result = [state, []];
      break;
    }
    case "SUBMIT": {
      const cleanKey = sanitizeLicenseKey(state.key);
      if (!cleanKey) {
        result = [
          {
            status: "ERROR",
            key: "",
            error: "Please enter a license key.",
            isEmailPhase: false
          },
          [{ type: "FOCUS_KEY_INPUT" }]
        ];
        break;
      }
      if (state.status === "AWAITING_EMAIL" || state.status === "ERROR" && state.isEmailPhase) {
        const email = "email" in state ? state.email || "" : "";
        const cleanEmail = sanitizeEmail(email);
        if (!cleanEmail) {
          result = [
            {
              status: "AWAITING_EMAIL",
              key: cleanKey,
              email: "",
              error: "Please enter your email address."
            },
            [{ type: "FOCUS_EMAIL_INPUT" }]
          ];
          break;
        }
        if (!isValidEmailFormat(cleanEmail)) {
          result = [
            {
              status: "AWAITING_EMAIL",
              key: cleanKey,
              email: cleanEmail,
              error: "Please enter a valid email address."
            },
            [{ type: "FOCUS_EMAIL_INPUT" }]
          ];
          break;
        }
        result = [
          { status: "ACTIVATING", key: cleanKey, email: cleanEmail },
          [{ type: "EXECUTE_ACTIVATION", key: cleanKey, email: cleanEmail }]
        ];
        break;
      }
      result = [
        { status: "ACTIVATING", key: cleanKey },
        [{ type: "EXECUTE_ACTIVATION", key: cleanKey }]
      ];
      break;
    }
    case "NETWORK_CHALLENGE_EMAIL_REQUIRED": {
      const cleanKey = sanitizeLicenseKey(state.key);
      result = [
        {
          status: "AWAITING_EMAIL",
          key: cleanKey,
          email: "",
          error: void 0
        },
        [{ type: "FOCUS_EMAIL_INPUT" }]
      ];
      break;
    }
    case "NETWORK_SUCCESS": {
      const cleanKey = sanitizeLicenseKey(state.key);
      result = [
        { status: "SUCCESS", key: cleanKey, planId: event.planId },
        [{ type: "SCHEDULE_CLOSE", delayMs: 1200 }]
      ];
      break;
    }
    case "NETWORK_ERROR": {
      const isEmail = state.status === "AWAITING_EMAIL" || state.status === "ACTIVATING" && Boolean(state.email);
      result = [
        {
          status: "ERROR",
          key: state.key,
          email: "email" in state ? state.email : void 0,
          error: event.error,
          isEmailPhase: isEmail
        },
        isEmail ? [{ type: "FOCUS_EMAIL_INPUT" }] : [{ type: "FOCUS_KEY_INPUT" }]
      ];
      break;
    }
  }
  if (!validateActivationInvariants(result[0])) {
    throw new Error(`Activation invariant violated: ${JSON.stringify(result[0])}`);
  }
  return result;
}
var _tmpl$$4 = /* @__PURE__ */ template(`<div class="w-full font-sans select-none"><div class="overflow-x-auto rounded-xl border border-neutral-200/80 bg-white shadow-2xs"><table class="w-full text-left border-collapse"><thead><tr class="border-b border-neutral-200 bg-neutral-50/80 type-caption font-semibold text-neutral-900"><th>Feature</th><th>Free Forever</th><th>Pro ($10 - $12/mo)</th><th><div class="font-bold text-neutral-900">Lifetime ($149)</div><div class="type-caption text-neutral-500 font-normal mt-0.5">Pay once, own forever</div></th></tr></thead><tbody class="divide-y divide-neutral-200/60 type-caption text-neutral-700">`), _tmpl$2$3 = /* @__PURE__ */ template(`<tr class="hover:bg-neutral-50/60 transition-colors"><td></td><td></td><td></td><td>`), _tmpl$3$3 = /* @__PURE__ */ template(`<tr class="bg-neutral-100/70 font-semibold text-neutral-900 type-telemetry uppercase tracking-wider"><td colspan=4>`);
const COMPARISON_DATA = [{
  name: "Workspace & Window Canvas",
  starter: "",
  pro: "",
  lifetime: "",
  isHeader: true
}, {
  name: "Dedicated Workspaces",
  starter: "2 Workspaces",
  pro: "Unlimited",
  lifetime: "Unlimited"
}, {
  name: "Split-View Canvas Tiling",
  starter: "Unlimited Panes",
  pro: "Unlimited Panes",
  lifetime: "Unlimited Panes"
}, {
  name: "Detached Floating Windows (PiP)",
  starter: "1 Active Window",
  pro: "Unlimited",
  lifetime: "Unlimited"
}, {
  name: "Spotlight Command Palette (Cmd+K)",
  starter: "✓ Included",
  pro: "✓ Included",
  lifetime: "✓ Included"
}, {
  name: "Workspace Themes & Custom Icons",
  starter: "✓ Included",
  pro: "✓ Included",
  lifetime: "✓ Included"
}, {
  name: "Session & Tab State Persistence",
  starter: "✓ Local SQLite",
  pro: "✓ Local SQLite",
  lifetime: "✓ Local SQLite"
}, {
  name: "Multi-Account & Profile Sandboxing",
  starter: "",
  pro: "",
  lifetime: "",
  isHeader: true
}, {
  name: "Isolated Account Profiles (Multi-Login)",
  starter: "1 Profile (Default)",
  pro: "Unlimited Profiles",
  lifetime: "Unlimited Profiles"
}, {
  name: "Cookie Partition Sandboxing",
  starter: "Single Partition",
  pro: "✓ Sandboxed per Profile",
  lifetime: "✓ Sandboxed per Profile"
}, {
  name: "Custom Proxy Integration (HTTP & SOCKS5)",
  starter: "—",
  pro: "✓ Supported (BYO Proxy)",
  lifetime: "✓ Supported (BYO Proxy)"
}, {
  name: "Custom User-Agent & Device Emulation",
  starter: "—",
  pro: "✓ Included",
  lifetime: "✓ Included"
}, {
  name: "Local-First Privacy (Zero Cloud Telemetry)",
  starter: "✓ 100% On-Device",
  pro: "✓ 100% On-Device",
  lifetime: "✓ 100% On-Device"
}, {
  name: "Performance & Multitasking Continuity",
  starter: "",
  pro: "",
  lifetime: "",
  isHeader: true
}, {
  name: "Smart Background Tab Hibernation",
  starter: "—",
  pro: "✓ Automatic",
  lifetime: "✓ Automatic"
}, {
  name: "Background Audio & Media Continuity",
  starter: "—",
  pro: "✓ Persistent Playback",
  lifetime: "✓ Persistent Playback"
}, {
  name: "Split Session Snapshots & Instant Restore",
  starter: "—",
  pro: "✓ Included",
  lifetime: "✓ Included"
}, {
  name: "Licensing, Updates & Support",
  starter: "",
  pro: "",
  lifetime: "",
  isHeader: true
}, {
  name: "Active Workstation License",
  starter: "1 Computer",
  pro: "1 Active Seat",
  lifetime: "1 Active Seat"
}, {
  name: "Self-Serve Device License Migration",
  starter: "—",
  pro: "✓ Instant Portal",
  lifetime: "✓ Instant Portal"
}, {
  name: "Software Updates",
  starter: "Core Updates",
  pro: "✓ All Pro Releases",
  lifetime: "✓ All Future Releases Included"
}, {
  name: "14-Day Money-Back Guarantee",
  starter: "—",
  pro: "✓ 100% Full Refund",
  lifetime: "✓ 100% Full Refund"
}, {
  name: "Customer Support Channel",
  starter: "Online Guides",
  pro: "Priority Email (<12h)",
  lifetime: "Direct Founder Priority"
}];
const FeatureComparisonTable = (props) => {
  return (() => {
    var _el$ = _tmpl$$4(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.nextSibling, _el$0 = _el$4.nextSibling;
    insert(_el$0, createComponent(For, {
      each: COMPARISON_DATA,
      children: (row) => createComponent(Show, {
        get when() {
          return !row.isHeader;
        },
        get fallback() {
          return (() => {
            var _el$14 = _tmpl$3$3(), _el$15 = _el$14.firstChild;
            insert(_el$15, () => row.name);
            createRenderEffect(() => className(_el$15, `px-4 text-neutral-500 ${props.compact ? "py-1.5" : "py-2"}`));
            return _el$14;
          })();
        },
        get children() {
          var _el$1 = _tmpl$2$3(), _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling, _el$13 = _el$12.nextSibling;
          insert(_el$10, () => row.name);
          insert(_el$11, () => row.starter);
          insert(_el$12, () => row.pro);
          insert(_el$13, () => row.lifetime);
          createRenderEffect((_p$) => {
            var _v$5 = `px-4 font-medium text-neutral-900 ${props.compact ? "py-1.5" : "py-2"}`, _v$6 = `px-3 text-center text-neutral-600 ${props.compact ? "py-1.5" : "py-2"}`, _v$7 = `px-3 text-center font-medium bg-neutral-900/5 text-neutral-950 ${props.compact ? "py-1.5" : "py-2"}`, _v$8 = `px-3 text-center font-semibold text-neutral-950 ${props.compact ? "py-1.5" : "py-2"}`;
            _v$5 !== _p$.e && className(_el$10, _p$.e = _v$5);
            _v$6 !== _p$.t && className(_el$11, _p$.t = _v$6);
            _v$7 !== _p$.a && className(_el$12, _p$.a = _v$7);
            _v$8 !== _p$.o && className(_el$13, _p$.o = _v$8);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0
          });
          return _el$1;
        }
      })
    }));
    createRenderEffect((_p$) => {
      var _v$ = `px-4 w-2/5 ${props.compact ? "py-2" : "py-3"}`, _v$2 = `px-3 w-1/5 text-center text-neutral-600 ${props.compact ? "py-2" : "py-3"}`, _v$3 = `px-3 w-1/5 text-center bg-neutral-900/5 text-neutral-900 ${props.compact ? "py-2" : "py-3"}`, _v$4 = `px-3 w-1/5 text-center ${props.compact ? "py-2" : "py-3"}`;
      _v$ !== _p$.e && className(_el$6, _p$.e = _v$);
      _v$2 !== _p$.t && className(_el$7, _p$.t = _v$2);
      _v$3 !== _p$.a && className(_el$8, _p$.a = _v$3);
      _v$4 !== _p$.o && className(_el$9, _p$.o = _v$4);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$;
  })();
};
function getPaywallReasonText(reason) {
  const tier = layoutStore.capabilities?.tier ?? "free";
  switch (reason) {
    case "workspace_limit":
      return "Free plan includes 2 workspaces. Upgrade to Pro to organize unlimited client and business projects side-by-side.";
    case "profile":
    case "multi_account":
      if (tier === "tier1") {
        return "Staying logged into multiple client accounts on the same site requires Tier 2 or Pro. Upgrade your plan to manage all client logins at once.";
      }
      return "Staying logged into multiple client accounts on the same site is a Pro feature. Upgrade to Pro to manage all your client logins at the same time.";
    case "proxy_feature":
      if (tier === "tier1" || tier === "tier2") {
        return "Custom proxy setup (HTTP & SOCKS5) requires Tier 3 or Pro. Upgrade your plan to configure your own proxies for each account.";
      }
      return "Custom proxy setup (HTTP & SOCKS5) is a Pro feature. Upgrade to Pro to configure your own proxies for each account.";
    case "floating_pane":
      return "Free plan includes 1 pinned reference window. Upgrade to Pro to keep unlimited notes, spreadsheets, and reference docs open on top.";
    default:
      return "Upgrade to Pro to manage all your client accounts and work projects in one clean desktop app.";
  }
}
function usePaywallController() {
  const [activationState, setActivationState] = createSignal(
    createInitialActivationState()
  );
  const [selectedCycle, setSelectedCycle] = createSignal("lifetime");
  let emailInputRef;
  let keyInputRef;
  const runEffects = (effects) => {
    for (const eff of effects) {
      switch (eff.type) {
        case "FOCUS_EMAIL_INPUT":
          requestAnimationFrame(() => emailInputRef?.focus());
          break;
        case "FOCUS_KEY_INPUT":
          requestAnimationFrame(() => keyInputRef?.focus());
          break;
        case "SCHEDULE_CLOSE":
          setTimeout(async () => {
            setLayoutStore("isPremium", true);
            const caps = await window.api?.getCapabilities?.();
            if (caps) setLayoutStore("capabilities", caps);
            setLayoutStore("showPaywall", false);
            dispatch({ type: "RESET" });
          }, eff.delayMs);
          break;
        case "EXECUTE_ACTIVATION":
          executeActivation(eff.key, eff.email);
          break;
      }
    }
  };
  const dispatch = (event) => {
    const [next, effects] = reduceActivationState(activationState(), event);
    setActivationState(next);
    runEffects(effects);
  };
  const executeActivation = async (cleanKey, cleanEmail) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      dispatch({
        type: "NETWORK_ERROR",
        error: "You are offline. Connect to the internet to activate your license."
      });
      return;
    }
    try {
      const res = await window.api?.activateLicenseKey(cleanKey, cleanEmail);
      if (res && res.success) {
        try {
          const state = await window.api?.getLicenseState?.();
          if (state) setLayoutStore("licenseState", state);
          const caps = await window.api?.getCapabilities?.();
          if (caps) setLayoutStore("capabilities", caps);
        } catch {
        }
        dispatch({ type: "NETWORK_SUCCESS" });
      } else if (res && res.requiresEmail) {
        dispatch({ type: "NETWORK_CHALLENGE_EMAIL_REQUIRED" });
      } else {
        dispatch({
          type: "NETWORK_ERROR",
          error: res?.error || "Invalid license key. Please check and try again."
        });
      }
    } catch (err) {
      dispatch({
        type: "NETWORK_ERROR",
        error: err?.message || "An error occurred during activation."
      });
    }
  };
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
  const getReasonText = () => getPaywallReasonText(layoutStore.paywallReason);
  const getPopoverStyle = (isWide = false) => {
    const anchor = layoutStore.paywallAnchor;
    if (!anchor) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }
    const popoverWidth = isWide ? 1040 : 420;
    const isAwaitingEmail = activationState().status === "AWAITING_EMAIL" || activationState().status === "ERROR" && activationState().isEmailPhase;
    const popoverHeight = isAwaitingEmail ? 280 : 220;
    let left = anchor.left + anchor.width + 16;
    if (left + popoverWidth > window.innerWidth - 20) {
      left = Math.max(20, anchor.left - popoverWidth - 16);
    }
    let top = Math.max(20, anchor.top + anchor.height / 2 - popoverHeight / 2);
    if (top + popoverHeight > window.innerHeight - 20) {
      top = Math.max(20, window.innerHeight - popoverHeight - 20);
    }
    return { top: `${top}px`, left: `${left}px` };
  };
  const handleBuy = async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      dispatch({
        type: "NETWORK_ERROR",
        error: "You are offline. Connect to the internet to purchase."
      });
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
        if (selectedCycle() === "lifetime") parsed.searchParams.set("coupon", "FOUNDER149");
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
    dispatch({ type: "RESET" });
  };
  return {
    key: () => activationState().key,
    setKey: (key) => dispatch({ type: "KEY_INPUT", key }),
    email: () => "email" in activationState() ? activationState().email || "" : "",
    setEmail: (email) => dispatch({ type: "EMAIL_INPUT", email }),
    requiresEmail: () => activationState().status === "AWAITING_EMAIL" || activationState().status === "ERROR" && activationState().isEmailPhase,
    loading: () => activationState().status === "ACTIVATING",
    error: () => "error" in activationState() ? activationState().error || null : null,
    success: () => activationState().status === "SUCCESS",
    setEmailInputRef: (el) => {
      emailInputRef = el;
    },
    setKeyInputRef: (el) => {
      keyInputRef = el;
    },
    selectedCycle,
    setSelectedCycle,
    getReasonText,
    getPopoverStyle,
    handleActivate: (e) => {
      e.preventDefault();
      dispatch({ type: "SUBMIT" });
    },
    handleBuy,
    close
  };
}
var _tmpl$$3 = /* @__PURE__ */ template(`<div class="flex items-baseline justify-end font-telemetry"><span class="type-title font-bold text-neutral-900">$149`), _tmpl$2$2 = /* @__PURE__ */ template(`<span class="type-telemetry text-neutral-500 font-medium">One-time fee`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class="flex items-baseline justify-end gap-0.5 font-telemetry"><span class="type-title font-bold text-neutral-900">$10</span><span class="type-caption text-neutral-500 font-sans">/mo`), _tmpl$4$2 = /* @__PURE__ */ template(`<span class="type-telemetry text-neutral-500 font-normal">$120 billed yearly`), _tmpl$5$2 = /* @__PURE__ */ template(`<div class="flex items-baseline justify-end gap-0.5 font-telemetry"><span class="type-title font-bold text-neutral-900">$12</span><span class="type-caption text-neutral-500 font-sans">/mo`), _tmpl$6$2 = /* @__PURE__ */ template(`<span class="type-telemetry text-neutral-500 font-normal">Billed monthly`), _tmpl$7 = /* @__PURE__ */ template(`<div class="flex items-center justify-between"><div class="min-w-0 pr-2"><h4 class="type-body font-semibold text-neutral-900 leading-tight"></h4><p class="type-caption text-neutral-500 mt-0.5 leading-normal"></p></div><div class="text-right shrink-0">`), _tmpl$8 = /* @__PURE__ */ template(`<button type=button class="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 active:bg-black text-white font-medium rounded-xl type-ui transition-all shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.12)] flex items-center justify-center gap-1.5 cursor-pointer"><span></span><svg xmlns=http://www.w3.org/2000/svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class="opacity-70 group-hover:opacity-100"><line x1=5 y1=12 x2=19 y2=12></line><polyline points="12 5 19 12 12 19">`), _tmpl$9 = /* @__PURE__ */ template(`<div class="flex flex-col gap-3"><div class="flex items-center p-1 bg-neutral-100/90 rounded-xl border border-neutral-200/80"><button type=button><span>Lifetime</span><span class="type-telemetry font-telemetry px-1 py-0.2 rounded font-semibold bg-neutral-200/80 text-neutral-800">$149</span></button><button type=button><span>Annual</span><span class="type-telemetry font-telemetry px-1 py-0.2 rounded font-semibold bg-neutral-200/80 text-neutral-700">-17%</span></button><button type=button><span>Monthly`);
function PaywallPlanSelector(props) {
  return (() => {
    var _el$ = _tmpl$9(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.nextSibling;
    _el$3.$$click = () => props.setSelectedCycle("lifetime");
    _el$4.$$click = () => props.setSelectedCycle("annual");
    _el$5.$$click = () => props.setSelectedCycle("monthly");
    insert(_el$, createComponent(DoubleBezel, {
      size: "md",
      elevation: "flat",
      "class": "w-full",
      innerClass: "bg-neutral-50/70 p-3.5 rounded-xl border border-neutral-200/90 flex flex-col gap-3",
      get children() {
        return [(() => {
          var _el$6 = _tmpl$7(), _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$7.nextSibling;
          insert(_el$8, (() => {
            var _c$ = memo(() => props.selectedCycle() === "lifetime");
            return () => _c$() ? "Lifetime License" : props.selectedCycle() === "annual" ? "Annual Plan" : "Monthly Plan";
          })());
          insert(_el$9, (() => {
            var _c$2 = memo(() => props.selectedCycle() === "lifetime");
            return () => _c$2() ? "Pay once, use forever. All future updates included." : props.selectedCycle() === "annual" ? "Billed once a year ($120/yr). Save 17% with priority support." : "Billed monthly ($12/mo). Cancel anytime with one click.";
          })());
          insert(_el$0, createComponent(Show, {
            get when() {
              return props.selectedCycle() === "lifetime";
            },
            get children() {
              return [_tmpl$$3(), _tmpl$2$2()];
            }
          }), null);
          insert(_el$0, createComponent(Show, {
            get when() {
              return props.selectedCycle() === "annual";
            },
            get children() {
              return [_tmpl$3$2(), _tmpl$4$2()];
            }
          }), null);
          insert(_el$0, createComponent(Show, {
            get when() {
              return props.selectedCycle() === "monthly";
            },
            get children() {
              return [_tmpl$5$2(), _tmpl$6$2()];
            }
          }), null);
          return _el$6;
        })(), (() => {
          var _el$15 = _tmpl$8(), _el$16 = _el$15.firstChild;
          addEventListener(_el$15, "click", props.onBuy, true);
          insert(_el$16, (() => {
            var _c$3 = memo(() => props.selectedCycle() === "lifetime");
            return () => _c$3() ? "Get Lifetime License — $149" : props.selectedCycle() === "annual" ? "Subscribe Yearly — $120/yr" : "Subscribe Monthly — $12/mo";
          })());
          return _el$15;
        })()];
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$ = `flex-1 py-1.5 type-caption rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${props.selectedCycle() === "lifetime" ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`, _v$2 = `flex-1 py-1.5 type-caption rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${props.selectedCycle() === "annual" ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`, _v$3 = `flex-1 py-1.5 type-caption rounded-lg transition-all flex items-center justify-center cursor-pointer ${props.selectedCycle() === "monthly" ? "bg-white text-neutral-900 shadow-2xs font-semibold" : "text-neutral-500 hover:text-neutral-800 font-medium"}`;
      _v$ !== _p$.e && className(_el$3, _p$.e = _v$);
      _v$2 !== _p$.t && className(_el$4, _p$.t = _v$2);
      _v$3 !== _p$.a && className(_el$5, _p$.a = _v$3);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<svg class="animate-spin h-3.5 w-3.5 text-neutral-700"xmlns=http://www.w3.org/2000/svg fill=none viewBox="0 0 24 24"><circle class=opacity-25 cx=12 cy=12 r=10 stroke=currentColor stroke-width=4></circle><path class=opacity-75 fill=currentColor d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">`), _tmpl$2$1 = /* @__PURE__ */ template(`<button type=submit class="px-3 py-1.5 bg-white hover:bg-neutral-50 border border-neutral-300 disabled:bg-neutral-100 disabled:border-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed text-neutral-800 rounded-[8px] type-caption font-medium transition-all shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,1)] active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)] flex items-center justify-center shrink-0 cursor-pointer">`), _tmpl$3$1 = /* @__PURE__ */ template(`<svg class="animate-spin h-3.5 w-3.5 text-white"xmlns=http://www.w3.org/2000/svg fill=none viewBox="0 0 24 24"><circle class=opacity-25 cx=12 cy=12 r=10 stroke=currentColor stroke-width=4></circle><path class=opacity-75 fill=currentColor d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">`), _tmpl$4$1 = /* @__PURE__ */ template(`<div class="p-2 bg-neutral-50 border border-neutral-200/90 rounded-[8px] flex items-center justify-between gap-2 shadow-2xs"><span class="type-caption text-neutral-600 leading-tight">Computer limit reached. Remove an old computer:</span><button type=button class="px-2 py-0.5 bg-white hover:bg-neutral-100 text-neutral-800 rounded-[6px] type-telemetry font-semibold border border-neutral-300 transition-colors shrink-0 cursor-pointer shadow-2xs">Manage Devices ↗`), _tmpl$5$1 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1.5 px-0.5"><span class="type-caption text-red-500 font-medium leading-tight">`), _tmpl$6$1 = /* @__PURE__ */ template(`<form class="flex flex-col gap-1.5"><div class="flex gap-1.5"><input type=text placeholder="Paste license key..."class="flex-1 px-2.5 py-1.5 type-caption font-telemetry tracking-wide bg-white border border-neutral-200/90 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 transition-all placeholder:font-sans placeholder-neutral-400 text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"autocomplete=off></div><div><div class="overflow-hidden flex flex-col gap-1.5"><input type=email placeholder="Enter your email address..."class="w-full px-2.5 py-1.5 type-caption font-normal bg-white border border-neutral-200/90 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 transition-all placeholder-neutral-400 text-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"autocomplete=email><button type=submit class="w-full py-1.5 bg-neutral-900 hover:bg-neutral-800 border border-neutral-950 disabled:bg-neutral-200 disabled:border-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed text-white rounded-[8px] type-caption font-medium transition-all shadow-[0_1px_2px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] flex items-center justify-center cursor-pointer">`);
function PaywallActivationForm(props) {
  const isSeatLimitError = () => {
    const err = props.error()?.toLowerCase() || "";
    return err.includes("seat") || err.includes("limit") || err.includes("deactivate") || err.includes("utilized");
  };
  const openPortal = () => {
    window.electron?.ipcRenderer.send("window.openExternal", "https://users.freemius.com/");
  };
  return (() => {
    var _el$ = _tmpl$6$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$6 = _el$2.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling;
    addEventListener(_el$, "submit", props.onSubmit);
    _el$3.$$input = (e) => props.setKey(e.currentTarget.value);
    use((el) => props.setKeyInputRef?.(el), _el$3);
    setAttribute(_el$3, "spellcheck", false);
    insert(_el$2, createComponent(Show, {
      get when() {
        return !props.requiresEmail();
      },
      get children() {
        var _el$4 = _tmpl$2$1();
        insert(_el$4, createComponent(Show, {
          get when() {
            return props.loading();
          },
          fallback: "Activate",
          get children() {
            return _tmpl$$2();
          }
        }));
        createRenderEffect(() => _el$4.disabled = props.loading() || !props.key().trim());
        return _el$4;
      }
    }), null);
    _el$8.$$input = (e) => props.setEmail(e.currentTarget.value);
    use((el) => {
      props.setEmailInputRef(el);
      if (props.requiresEmail()) requestAnimationFrame(() => el?.focus());
    }, _el$8);
    setAttribute(_el$8, "spellcheck", false);
    insert(_el$9, createComponent(Show, {
      get when() {
        return props.loading();
      },
      fallback: "Complete Activation",
      get children() {
        return _tmpl$3$1();
      }
    }));
    insert(_el$, createComponent(Show, {
      get when() {
        return props.error();
      },
      get children() {
        var _el$1 = _tmpl$5$1(), _el$10 = _el$1.firstChild;
        insert(_el$10, () => props.error());
        insert(_el$1, createComponent(Show, {
          get when() {
            return isSeatLimitError();
          },
          get children() {
            var _el$11 = _tmpl$4$1(), _el$12 = _el$11.firstChild, _el$13 = _el$12.nextSibling;
            _el$13.$$click = openPortal;
            return _el$11;
          }
        }), null);
        return _el$1;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$ = props.loading(), _v$2 = `grid transition-all duration-300 ease-out ${props.requiresEmail() ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"}`, _v$3 = props.loading(), _v$4 = props.loading() || !props.email().trim();
      _v$ !== _p$.e && (_el$3.disabled = _p$.e = _v$);
      _v$2 !== _p$.t && className(_el$6, _p$.t = _v$2);
      _v$3 !== _p$.a && (_el$8.disabled = _p$.a = _v$3);
      _v$4 !== _p$.o && (_el$9.disabled = _p$.o = _v$4);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    createRenderEffect(() => _el$3.value = props.key());
    createRenderEffect(() => _el$8.value = props.email());
    return _el$;
  })();
}
delegateEvents(["input", "click"]);
var _tmpl$$1 = /* @__PURE__ */ template(`<div class="w-[620px] max-h-[calc(100vh-48px)] overflow-y-auto bg-white ring-1 ring-black/[0.06] border border-neutral-200/80 rounded-[18px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] p-5 animate-in fade-in slide-in-from-left-6 duration-300 pointer-events-auto select-none flex flex-col gap-3"><div class="flex items-center justify-between pb-3 border-b border-neutral-200/70"><div><div class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-neutral-100 rounded-full border border-neutral-200/80 mb-1"><span class="w-1.5 h-1.5 rounded-full bg-neutral-900"></span><span class="type-telemetry font-semibold tracking-wide text-neutral-800 uppercase leading-none">Detailed Plan Specs</span></div><h3 class="type-title font-bold text-neutral-900 leading-tight">Compare Features & Limits</h3><p class="type-caption text-neutral-500 mt-0.5 font-normal">Everything included in Free, Pro, and Founder Lifetime Deal</p></div><button type=button class="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"title="Close comparison"><svg xmlns=http://www.w3.org/2000/svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18>`);
function PaywallComparisonPanel(props) {
  return (() => {
    var _el$ = _tmpl$$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
    addEventListener(_el$4, "click", props.onClose, true);
    insert(_el$, createComponent(FeatureComparisonTable, {
      compact: true
    }), null);
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="pt-2 border-t border-neutral-200/60 space-y-2 animate-in fade-in duration-150"><div class="flex items-center justify-between type-caption text-neutral-500 font-medium"><span>Activate Pro License</span><button type=button class="text-neutral-400 hover:text-neutral-600 type-telemetry cursor-pointer">Close`), _tmpl$3 = /* @__PURE__ */ template(`<div class="flex flex-col gap-2.5"><button type=button class="w-full flex items-center justify-between px-3.5 py-2 rounded-xl bg-neutral-50 hover:bg-neutral-100 border border-neutral-200/80 text-left transition-colors group cursor-pointer"><div class="flex items-center gap-2"><svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class="text-neutral-500 group-hover:text-neutral-900 transition-colors"><rect width=18 height=18 x=3 y=3 rx=2></rect><path d="M9 3v18"></path><path d="M15 3v18"></path></svg><span class="type-ui font-medium text-neutral-800 group-hover:text-neutral-950 transition-colors">See full plan comparison</span></div><div class="flex items-center gap-1.5 type-caption font-medium text-neutral-400 group-hover:text-neutral-700 transition-colors"><span></span><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class="transition-transform duration-200"><polyline points="9 18 15 12 9 6"></polyline></svg></div></button><div class=pt-1>`), _tmpl$4 = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed z-[99999] flex items-start gap-4 transition-all duration-300 ease-out pointer-events-auto"><div class="w-[420px] max-h-[calc(100vh-40px)] overflow-y-auto bg-white ring-1 ring-black/[0.06] border border-neutral-200/80 rounded-[18px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.18)] p-5 animate-in fade-in zoom-in-[0.98] duration-200 select-none relative"><button class="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 transition-colors p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"title=Close><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button><div class="flex flex-col gap-3"><div><div class="inline-flex items-center gap-1.5 px-2 py-0.5 bg-neutral-100 rounded-md border border-neutral-200/80 mb-2"><span class="type-telemetry font-semibold tracking-wider text-neutral-700 uppercase leading-none">Apposition Pro</span></div><h3 class="type-title font-semibold text-neutral-900 leading-tight">Unlock full access</h3></div><p class="type-body text-neutral-500 leading-relaxed font-normal">`), _tmpl$5 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-center py-4 text-center animate-in zoom-in-95 duration-200"><div class="w-10 h-10 bg-neutral-100 rounded-full flex items-center justify-center text-neutral-900 mb-2 border border-neutral-200/80"><svg xmlns=http://www.w3.org/2000/svg width=20 height=20 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="20 6 9 17 4 12"></polyline></svg></div><p class="type-ui font-semibold text-neutral-900">Pro Activated!</p><p class="type-caption text-neutral-500 mt-0.5 font-normal">You're all set. Unlimited workspaces and multi-account logins are ready to use.`), _tmpl$6 = /* @__PURE__ */ template(`<div class="text-center pt-1 border-t border-neutral-100"><button type=button class="type-caption text-neutral-400 hover:text-neutral-700 transition-colors cursor-pointer">Already have a license key? <span class="underline underline-offset-2">Enter key`);
function PaywallPopover() {
  const ctrl = usePaywallController();
  const [showActivation, setShowActivation] = createSignal(false);
  const [showComparison, setShowComparison] = createSignal(false);
  const isActivationOpen = () => showActivation() || !!ctrl.key() || ctrl.requiresEmail() || !!ctrl.error();
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
            var _el$2 = _tmpl$4(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling;
            addEventListener(_el$4, "click", ctrl.close, true);
            insert(_el$7, () => ctrl.getReasonText());
            insert(_el$5, createComponent(Show, {
              get when() {
                return !ctrl.success();
              },
              get fallback() {
                return _tmpl$5();
              },
              get children() {
                var _el$8 = _tmpl$3(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$9.nextSibling;
                insert(_el$8, createComponent(PaywallPlanSelector, {
                  get selectedCycle() {
                    return ctrl.selectedCycle;
                  },
                  get setSelectedCycle() {
                    return ctrl.setSelectedCycle;
                  },
                  get onBuy() {
                    return ctrl.handleBuy;
                  }
                }), _el$9);
                _el$9.$$click = () => setShowComparison(!showComparison());
                insert(_el$10, () => showComparison() ? "Hide comparison" : "All features");
                insert(_el$12, createComponent(Show, {
                  get when() {
                    return isActivationOpen();
                  },
                  get fallback() {
                    return (() => {
                      var _el$18 = _tmpl$6(), _el$19 = _el$18.firstChild;
                      _el$19.$$click = () => setShowActivation(true);
                      return _el$18;
                    })();
                  },
                  get children() {
                    var _el$13 = _tmpl$2(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling;
                    _el$16.$$click = () => setShowActivation(false);
                    insert(_el$13, createComponent(PaywallActivationForm, {
                      get key() {
                        return ctrl.key;
                      },
                      get setKey() {
                        return ctrl.setKey;
                      },
                      get email() {
                        return ctrl.email;
                      },
                      get setEmail() {
                        return ctrl.setEmail;
                      },
                      get requiresEmail() {
                        return ctrl.requiresEmail;
                      },
                      get setEmailInputRef() {
                        return ctrl.setEmailInputRef;
                      },
                      get setKeyInputRef() {
                        return ctrl.setKeyInputRef;
                      },
                      get loading() {
                        return ctrl.loading;
                      },
                      get error() {
                        return ctrl.error;
                      },
                      get onSubmit() {
                        return ctrl.handleActivate;
                      }
                    }), null);
                    return _el$13;
                  }
                }));
                createRenderEffect(() => _el$11.classList.toggle("rotate-180", !!showComparison()));
                return _el$8;
              }
            }), null);
            insert(_el$2, createComponent(Show, {
              get when() {
                return showComparison();
              },
              get children() {
                return createComponent(PaywallComparisonPanel, {
                  onClose: () => setShowComparison(false)
                });
              }
            }), null);
            createRenderEffect((_$p) => style(_el$2, ctrl.getPopoverStyle(showComparison()), _$p));
            return _el$2;
          })()];
        }
      });
    }
  });
}
delegateEvents(["mousedown", "click"]);
export {
  PaywallPopover as default
};
