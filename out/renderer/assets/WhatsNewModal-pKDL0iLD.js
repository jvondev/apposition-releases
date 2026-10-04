import { f as onMount, B as onCleanup, c as createComponent, g as insert, w as addEventListener, F as For, H as DoubleBezel, I as ModalShell, t as template, e as delegateEvents } from "./index-oxVhEfYE.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="p-6 flex flex-col gap-5 text-neutral-900 select-none"><div class="flex flex-col gap-2"><div class="flex items-center justify-between"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-neutral-100 border border-neutral-200 text-neutral-600"></span><button class="text-neutral-400 hover:text-neutral-700 transition-colors p-1 -mr-1 rounded-md"aria-label=Close><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button></div><h2 class="text-xl font-bold tracking-tight text-neutral-900 leading-snug"></h2></div><div class="flex flex-col gap-3 py-1"></div><div class="flex items-center justify-between pt-3 border-t border-neutral-100"><button class="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors inline-flex items-center gap-1 cursor-pointer"><span>All release notes</span><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=5 y1=12 x2=19 y2=12></line><polyline points="12 5 19 12 12 19"></polyline></svg></button><button class="px-4 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 active:scale-[0.97] text-white text-xs font-semibold transition-all shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_2px_4px_rgba(0,0,0,0.1)] cursor-pointer">Got it`), _tmpl$2 = /* @__PURE__ */ template(`<div class="w-6 h-6 rounded-lg bg-neutral-900 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs"><svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="20 6 9 17 4 12">`), _tmpl$3 = /* @__PURE__ */ template(`<div class="flex flex-col gap-0.5"><h3 class="text-xs font-semibold text-neutral-800 leading-tight"></h3><p class="text-[11px] text-neutral-500 leading-relaxed">`);
function WhatsNewModal(props) {
  const versionTag = () => props.release?.tag || `v${props.release?.version || "1.0.0"}`;
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Enter" && props.isOpen) {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  return createComponent(ModalShell, {
    get isOpen() {
      return props.isOpen;
    },
    get onClose() {
      return props.onClose;
    },
    maxWidthClass: "max-w-md",
    get children() {
      var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling, _el$7 = _el$2.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.firstChild, _el$0 = _el$9.nextSibling;
      insert(_el$4, versionTag);
      addEventListener(_el$5, "click", props.onClose, true);
      insert(_el$6, () => props.release?.title || `What's New in Apposition ${versionTag()}`);
      insert(_el$7, createComponent(For, {
        get each() {
          return props.release?.highlights || [];
        },
        children: (item, idx) => createComponent(DoubleBezel, {
          size: "md",
          elevation: "flat",
          variant: "light",
          "class": "w-full",
          innerClass: "p-3.5 flex items-start gap-3 bg-neutral-50/60 hover:bg-neutral-50 transition-colors",
          get children() {
            return [_tmpl$2(), (() => {
              var _el$10 = _tmpl$3(), _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
              insert(_el$11, () => item.title);
              insert(_el$12, () => item.description);
              return _el$10;
            })()];
          }
        })
      }));
      addEventListener(_el$9, "click", props.onViewAll, true);
      addEventListener(_el$0, "click", props.onClose, true);
      return _el$;
    }
  });
}
delegateEvents(["click"]);
export {
  WhatsNewModal as default
};
