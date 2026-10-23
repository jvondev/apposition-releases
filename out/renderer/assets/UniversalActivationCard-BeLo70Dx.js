import { r as createSignal, I as onCleanup, n as setLayoutStore, y as addEventListener, i as insert, c as createComponent, l as Show, m as memo, K as use, p as setAttribute, e as createRenderEffect, f as className, t as template, h as delegateEvents } from "./index-rd3doXCh.js";
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
function useLicenseActivationController(options = {}) {
  const [activationState, setActivationState] = createSignal(
    createInitialActivationState(options.initialKey || "")
  );
  let emailInputRef;
  let keyInputRef;
  let closeTimeout;
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
          closeTimeout = setTimeout(async () => {
            setLayoutStore("isPremium", true);
            const caps = await window.api?.getCapabilities?.();
            if (caps) setLayoutStore("capabilities", caps);
            options.onSuccess?.();
            dispatch({ type: "RESET" });
          }, options.closeDelayMs ?? eff.delayMs);
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
          const [state, caps] = await Promise.all([
            window.api?.getLicenseState?.(),
            window.api?.getCapabilities?.()
          ]);
          if (state) setLayoutStore("licenseState", state);
          if (caps) setLayoutStore("capabilities", caps);
          setLayoutStore("isPremium", true);
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
  onCleanup(() => {
    if (closeTimeout) clearTimeout(closeTimeout);
  });
  return {
    key: () => activationState().key,
    setKey: (key) => dispatch({ type: "KEY_INPUT", key }),
    email: () => "email" in activationState() ? activationState().email || "" : "",
    setEmail: (email) => dispatch({ type: "EMAIL_INPUT", email }),
    requiresEmail: () => activationState().status === "AWAITING_EMAIL" || activationState().status === "ERROR" && activationState().isEmailPhase,
    loading: () => activationState().status === "ACTIVATING",
    error: () => "error" in activationState() ? activationState().error || null : null,
    success: () => activationState().status === "SUCCESS",
    isSeatLimitError: () => {
      const err = ("error" in activationState() ? activationState().error : "") || "";
      const lower = String(err).toLowerCase();
      return lower.includes("seat") || lower.includes("limit") || lower.includes("deactivate") || lower.includes("utilized");
    },
    setEmailInputRef: (el) => {
      emailInputRef = el;
    },
    setKeyInputRef: (el) => {
      keyInputRef = el;
    },
    handleActivate: (e) => {
      e.preventDefault();
      dispatch({ type: "SUBMIT" });
    },
    reset: () => dispatch({ type: "RESET" })
  };
}
var _tmpl$ = /* @__PURE__ */ template(`<div class="flex items-center justify-between"><label class="type-ui font-semibold text-neutral-900">`), _tmpl$2 = /* @__PURE__ */ template(`<svg class="animate-spin h-3.5 w-3.5 text-white"xmlns=http://www.w3.org/2000/svg fill=none viewBox="0 0 24 24"><circle class=opacity-25 cx=12 cy=12 r=10 stroke=currentColor stroke-width=4></circle><path class=opacity-75 fill=currentColor d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">`), _tmpl$3 = /* @__PURE__ */ template(`<button type=submit class="px-3.5 py-1.5 bg-neutral-900 hover:bg-black disabled:bg-neutral-200 disabled:text-neutral-400 text-white rounded-lg type-caption font-semibold transition-all shadow-2xs active:scale-[0.98] cursor-pointer shrink-0 flex items-center justify-center min-w-[72px]">`), _tmpl$4 = /* @__PURE__ */ template(`<div class="p-2 bg-neutral-50 border border-neutral-200/90 rounded-lg flex items-center justify-between gap-2 shadow-2xs"><span class="type-caption text-neutral-600 leading-tight">Computer limit reached. Deactivate an older device:</span><button type=button class="px-2.5 py-1 bg-white hover:bg-neutral-100 text-neutral-800 rounded-md type-telemetry font-semibold border border-neutral-300 transition-colors shrink-0 cursor-pointer shadow-2xs">Manage Devices ↗`), _tmpl$5 = /* @__PURE__ */ template(`<div class="space-y-1.5 pt-1"><p class="type-caption text-red-600 font-medium leading-tight">`), _tmpl$6 = /* @__PURE__ */ template(`<div class="text-center pt-0.5"><button type=button class="type-caption text-neutral-500 hover:text-neutral-900 underline underline-offset-2 transition-colors cursor-pointer">`), _tmpl$7 = /* @__PURE__ */ template(`<div class="space-y-2 text-left w-full select-none"data-overlay-chrome=true><form><div class="flex items-center gap-2"><input type=text placeholder="Paste your license key..."class="flex-1 px-3 py-1.5 bg-neutral-50/80 hover:bg-neutral-50 border border-neutral-300 rounded-lg type-caption font-telemetry text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:bg-white focus:border-neutral-900 transition-all shadow-2xs"autocomplete=off></div><div><div class="overflow-hidden flex flex-col gap-1.5 pt-0.5"><div class="flex items-center justify-between"><span class="type-caption font-medium text-neutral-600">Email required to register and link your license:</span></div><div class="flex items-center gap-2"><input type=email placeholder=name@example.com class="flex-1 px-3 py-1.5 bg-neutral-50/80 hover:bg-neutral-50 border border-neutral-300 rounded-lg type-caption font-telemetry text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:bg-white focus:border-neutral-900 transition-all shadow-2xs"autocomplete=email><button type=submit class="px-3.5 py-1.5 bg-neutral-900 hover:bg-black disabled:bg-neutral-200 disabled:text-neutral-400 text-white rounded-lg type-caption font-semibold transition-all shadow-2xs active:scale-[0.98] cursor-pointer shrink-0 flex items-center justify-center min-w-[72px]">`), _tmpl$8 = /* @__PURE__ */ template(`<span class="type-telemetry px-2 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-700 font-semibold tracking-wide uppercase">`);
const UniversalActivationCard = (props) => {
  const ctrl = props.controller;
  const isInline = () => props.variant === "inline";
  const openPortal = () => {
    window.electron?.ipcRenderer.send("window.openExternal", "https://users.freemius.com/");
  };
  return (() => {
    var _el$ = _tmpl$7(), _el$2 = _el$.firstChild, _el$5 = _el$2.firstChild, _el$6 = _el$5.firstChild, _el$9 = _el$5.nextSibling, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
    addEventListener(_el$2, "submit", ctrl.handleActivate);
    insert(_el$2, createComponent(Show, {
      get when() {
        return props.showTitle ?? !isInline();
      },
      get children() {
        var _el$3 = _tmpl$(), _el$4 = _el$3.firstChild;
        insert(_el$4, () => props.title || "Activate License Key");
        insert(_el$3, createComponent(Show, {
          get when() {
            return memo(() => props.badge !== void 0)() ? props.badge : "Lifetime / LTD";
          },
          children: (badgeText) => (() => {
            var _el$21 = _tmpl$8();
            insert(_el$21, badgeText);
            return _el$21;
          })()
        }), null);
        return _el$3;
      }
    }), _el$5);
    _el$6.$$input = (e) => ctrl.setKey(e.currentTarget.value);
    use((el) => ctrl.setKeyInputRef(el), _el$6);
    setAttribute(_el$6, "spellcheck", false);
    insert(_el$5, createComponent(Show, {
      get when() {
        return !ctrl.requiresEmail();
      },
      get children() {
        var _el$7 = _tmpl$3();
        insert(_el$7, createComponent(Show, {
          get when() {
            return ctrl.loading();
          },
          fallback: "Activate",
          get children() {
            return _tmpl$2();
          }
        }));
        createRenderEffect(() => _el$7.disabled = ctrl.loading() || !ctrl.key().trim());
        return _el$7;
      }
    }), null);
    _el$11.$$input = (e) => ctrl.setEmail(e.currentTarget.value);
    use((el) => ctrl.setEmailInputRef(el), _el$11);
    setAttribute(_el$11, "spellcheck", false);
    insert(_el$12, createComponent(Show, {
      get when() {
        return ctrl.loading();
      },
      fallback: "Complete",
      get children() {
        return _tmpl$2();
      }
    }));
    insert(_el$2, createComponent(Show, {
      get when() {
        return ctrl.error();
      },
      get children() {
        var _el$14 = _tmpl$5(), _el$15 = _el$14.firstChild;
        insert(_el$15, () => ctrl.error());
        insert(_el$14, createComponent(Show, {
          get when() {
            return ctrl.isSeatLimitError();
          },
          get children() {
            var _el$16 = _tmpl$4(), _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling;
            _el$18.$$click = openPortal;
            return _el$16;
          }
        }), null);
        return _el$14;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!props.showFooterLink)() && props.onFooterLinkClick;
      },
      get children() {
        var _el$19 = _tmpl$6(), _el$20 = _el$19.firstChild;
        addEventListener(_el$20, "click", props.onFooterLinkClick, true);
        insert(_el$20, () => props.footerLinkLabel || "Don't have a license key yet? View pricing and upgrades →");
        return _el$19;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$ = `transition-all ${isInline() ? "space-y-2 w-full" : `bg-white border border-neutral-200/90 rounded-xl shadow-2xs space-y-2.5 ${props.compact ? "p-3" : "p-4"}`}`, _v$2 = ctrl.loading(), _v$3 = `grid transition-all duration-200 ease-out ${ctrl.requiresEmail() ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0 pointer-events-none"}`, _v$4 = ctrl.loading(), _v$5 = ctrl.loading() || !ctrl.email().trim();
      _v$ !== _p$.e && className(_el$2, _p$.e = _v$);
      _v$2 !== _p$.t && (_el$6.disabled = _p$.t = _v$2);
      _v$3 !== _p$.a && className(_el$9, _p$.a = _v$3);
      _v$4 !== _p$.o && (_el$11.disabled = _p$.o = _v$4);
      _v$5 !== _p$.i && (_el$12.disabled = _p$.i = _v$5);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    createRenderEffect(() => _el$6.value = ctrl.key());
    createRenderEffect(() => _el$11.value = ctrl.email());
    return _el$;
  })();
};
delegateEvents(["input", "click"]);
export {
  UniversalActivationCard as U,
  useLicenseActivationController as u
};
