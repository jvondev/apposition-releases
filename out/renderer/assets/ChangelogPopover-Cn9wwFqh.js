import { o as onMount, r as onCleanup, a as createComponent, j as addEventListener, b as createRenderEffect, u as style, v as use, w as Portal, l as layoutStore, t as template, e as delegateEvents } from "./index-C9c2TOTm.js";
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed z-[99999] w-[400px] h-[560px] bg-white ring-1 ring-black/[0.06] rounded-[20px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"><div class="flex items-center justify-between px-5 py-4 border-b border-black/[0.04] bg-neutral-50 shrink-0"><h2 class="text-sm font-semibold text-neutral-800">Latest Updates</h2><button class="text-neutral-400 hover:text-neutral-700 transition-colors relative z-10"><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button></div><div class="flex-1 overflow-hidden relative bg-[#fafaf9] flex items-center justify-center z-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-neutral-400 absolute"></div><iframe src=https://apposition.app/changelog class="absolute inset-0 w-full h-full border-none z-10"title="Apposition Release Notes">`);
function ChangelogPopover(props) {
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
    const anchor = layoutStore.changelogAnchor;
    if (!anchor) return {
      top: "calc(50% - 240px)",
      left: "calc(50% - 200px)"
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
        var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling;
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$2) : popoverRef = _el$2;
        addEventListener(_el$5, "click", props.onClose, true);
        createRenderEffect((_$p) => style(_el$2, position(), _$p));
        return _el$2;
      })()];
    }
  });
}
delegateEvents(["mousedown", "click"]);
export {
  ChangelogPopover as default
};
