import { i as insert, e as createRenderEffect, f as className, t as template, h as delegateEvents, c as createComponent, l as Show, z as addEventListener, q as createSignal, j as onMount, v as layoutStore, O as use, V as ModalShell, X as sendUserFeedback } from "./index-DfSjh5ij.js";
async function compressScreenshot(fileOrBlob, maxDimension = 1280, targetMaxBytes = 100 * 1024, initialQuality = 0.82) {
  const objectUrl = URL.createObjectURL(fileOrBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to load image for compression"));
      el.src = objectUrl;
    });
    let { width, height } = img;
    if (width > maxDimension || height > maxDimension) {
      if (width >= height) {
        height = Math.round(height * maxDimension / width);
        width = maxDimension;
      } else {
        width = Math.round(width * maxDimension / height);
        height = maxDimension;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire canvas 2D context");
    ctx.drawImage(img, 0, 0, width, height);
    let format = "image/webp";
    let quality = initialQuality;
    let dataUrl = canvas.toDataURL(format, quality);
    if (!dataUrl.startsWith("data:image/webp")) {
      format = "image/jpeg";
      dataUrl = canvas.toDataURL(format, quality);
    }
    let approxBytes = Math.round((dataUrl.length - 22) * 0.75);
    while (approxBytes > targetMaxBytes && quality > 0.3) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL(format, quality);
      approxBytes = Math.round((dataUrl.length - 22) * 0.75);
    }
    return {
      dataUrl,
      sizeBytes: approxBytes,
      width,
      height,
      format
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
var _tmpl$$2 = /* @__PURE__ */ template(`<div class="flex gap-2">`), _tmpl$2$2 = /* @__PURE__ */ template(`<button type=button>`);
const CATEGORIES = [{
  id: "bug",
  label: "Bug Report"
}, {
  id: "feature",
  label: "Feature Idea"
}, {
  id: "general",
  label: "General"
}];
function FeedbackCategoryPicker(props) {
  return (() => {
    var _el$ = _tmpl$$2();
    insert(_el$, () => CATEGORIES.map((cat) => (() => {
      var _el$2 = _tmpl$2$2();
      _el$2.$$click = () => props.onSelect(cat.id);
      insert(_el$2, () => cat.label);
      createRenderEffect(() => className(_el$2, `type-caption px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${props.selected === cat.id ? "bg-neutral-900 text-white border-neutral-900 font-semibold shadow-sm" : "bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100 hover:text-neutral-900"}`));
      return _el$2;
    })()));
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$1 = /* @__PURE__ */ template(`<button type=button class="type-caption flex items-center gap-1.5 text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2><rect x=3 y=3 width=18 height=18 rx=2 ry=2></rect><circle cx=8.5 cy=8.5 r=1.5></circle><polyline points="21 15 16 10 5 21"></polyline></svg>Attach screenshot (WebP auto-compressed)`), _tmpl$2$1 = /* @__PURE__ */ template(`<div class="flex items-center gap-2 bg-neutral-100 border border-neutral-200 rounded-lg px-2.5 py-1"><span class="type-telemetry text-neutral-600">Screenshot (<!> KB)</span><button type=button class="text-neutral-400 hover:text-neutral-700 cursor-pointer"aria-label="Remove screenshot"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2><path d="M18 6L6 18M6 6l12 12">`), _tmpl$3$1 = /* @__PURE__ */ template(`<div class="flex items-center justify-between">`);
function FeedbackAttachmentPill(props) {
  return (() => {
    var _el$ = _tmpl$3$1();
    insert(_el$, createComponent(Show, {
      get when() {
        return !props.screenshot;
      },
      get children() {
        var _el$2 = _tmpl$$1();
        addEventListener(_el$2, "click", props.onAttachClick, true);
        return _el$2;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return props.screenshot;
      },
      get children() {
        var _el$3 = _tmpl$2$1(), _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$7 = _el$5.nextSibling;
        _el$7.nextSibling;
        var _el$8 = _el$4.nextSibling;
        insert(_el$4, () => (props.screenshot.sizeBytes / 1024).toFixed(1), _el$7);
        addEventListener(_el$8, "click", props.onRemove, true);
        return _el$3;
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$ = /* @__PURE__ */ template(`<div class="py-8 flex flex-col items-center justify-center text-center gap-3 animate-in fade-in duration-200"><div class="w-10 h-10 rounded-full bg-neutral-100 border border-neutral-300 flex items-center justify-center text-neutral-900"><svg width=20 height=20 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5><polyline points="20 6 9 17 4 12"></polyline></svg></div><div class="type-title text-neutral-900">Feedback Sent</div><p class="type-caption text-neutral-500 max-w-xs">Thank you for helping us polish Apposition. We receive your note directly.`), _tmpl$2 = /* @__PURE__ */ template(`<div class="type-caption text-neutral-700 bg-neutral-100 border border-neutral-300 rounded-lg p-2.5">`), _tmpl$3 = /* @__PURE__ */ template(`<form class="flex flex-col gap-3.5"><textarea rows=4 placeholder="What happened or what would you like to see?"required class="w-full type-body p-3 bg-neutral-50/50 border border-neutral-200 rounded-xl focus:bg-white focus:border-neutral-400 focus:outline-none transition-colors resize-none placeholder:text-neutral-400 text-neutral-800"></textarea><input type=email placeholder="Your email (optional, for follow-up)"class="w-full type-ui px-3 py-2 bg-neutral-50/50 border border-neutral-200 rounded-xl focus:bg-white focus:border-neutral-400 focus:outline-none transition-colors placeholder:text-neutral-400 text-neutral-800"><input type=file accept=image/* class=hidden><div class="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100"><button type=button class="type-ui px-4 py-2 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer">Cancel</button><button type=submit class="type-ui px-4 py-2 bg-neutral-900 text-white rounded-xl hover:bg-neutral-800 disabled:opacity-50 transition-all shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.1)] active:scale-[0.98] cursor-pointer">`), _tmpl$4 = /* @__PURE__ */ template(`<div class="p-6 flex flex-col gap-4"><div class="flex items-start justify-between"><div><h2 class="type-title text-neutral-900">Share Feedback</h2><p class="type-caption text-neutral-500 mt-0.5">Send a bug report or suggest an improvement directly to our team.</p></div><button class="text-neutral-400 hover:text-neutral-700 p-1 rounded-lg transition-colors cursor-pointer"aria-label=Close><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2><path d="M18 6L6 18M6 6l12 12">`);
function FeedbackModal(props) {
  const [category, setCategory] = createSignal("bug");
  const [message, setMessage] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [screenshot, setScreenshot] = createSignal(null);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [isSuccess, setIsSuccess] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal(null);
  let fileInputRef;
  onMount(() => {
    const customerEmail = layoutStore.licenseState?.customer?.email;
    if (customerEmail) setEmail(customerEmail);
  });
  const handleFileChange = async (e) => {
    const target = e.target;
    const file = target.files?.[0];
    if (!file) return;
    try {
      setErrorMessage(null);
      const compressed = await compressScreenshot(file);
      setScreenshot(compressed);
    } catch {
      setErrorMessage("Could not process screenshot. Please choose an image file.");
    } finally {
      target.value = "";
    }
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const msg = message().trim();
    if (!msg) {
      setErrorMessage("Please enter a message before sending.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    const res = await sendUserFeedback({
      message: msg,
      email: email().trim() || void 0,
      category: category(),
      screenshotDataUrl: screenshot()?.dataUrl,
      metadata: {
        platform: navigator.platform || "desktop",
        userAgent: navigator.userAgent,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight
      }
    });
    setIsSubmitting(false);
    if (res.success) {
      setIsSuccess(true);
      setTimeout(() => {
        props.onClose();
        setIsSuccess(false);
        setMessage("");
        setScreenshot(null);
      }, 2e3);
    } else {
      setErrorMessage(res.error || "Failed to send feedback. Please try again.");
    }
  };
  return createComponent(ModalShell, {
    get isOpen() {
      return props.isOpen;
    },
    get onClose() {
      return props.onClose;
    },
    maxWidthClass: "max-w-lg",
    get children() {
      var _el$ = _tmpl$4(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
      addEventListener(_el$4, "click", props.onClose, true);
      insert(_el$, createComponent(Show, {
        get when() {
          return isSuccess();
        },
        get children() {
          return _tmpl$();
        }
      }), null);
      insert(_el$, createComponent(Show, {
        get when() {
          return !isSuccess();
        },
        get children() {
          var _el$6 = _tmpl$3(), _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$8.nextSibling, _el$1 = _el$9.nextSibling, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling;
          _el$6.addEventListener("submit", handleSubmit);
          insert(_el$6, createComponent(FeedbackCategoryPicker, {
            get selected() {
              return category();
            },
            onSelect: setCategory
          }), _el$7);
          _el$7.$$input = (e) => setMessage(e.currentTarget.value);
          _el$8.$$input = (e) => setEmail(e.currentTarget.value);
          _el$9.addEventListener("change", handleFileChange);
          var _ref$ = fileInputRef;
          typeof _ref$ === "function" ? use(_ref$, _el$9) : fileInputRef = _el$9;
          insert(_el$6, createComponent(FeedbackAttachmentPill, {
            get screenshot() {
              return screenshot();
            },
            onAttachClick: () => fileInputRef?.click(),
            onRemove: () => setScreenshot(null)
          }), _el$1);
          insert(_el$6, createComponent(Show, {
            get when() {
              return errorMessage();
            },
            get children() {
              var _el$0 = _tmpl$2();
              insert(_el$0, errorMessage);
              return _el$0;
            }
          }), _el$1);
          addEventListener(_el$10, "click", props.onClose, true);
          insert(_el$11, () => isSubmitting() ? "Sending..." : "Send Feedback");
          createRenderEffect(() => _el$11.disabled = isSubmitting());
          createRenderEffect(() => _el$7.value = message());
          createRenderEffect(() => _el$8.value = email());
          return _el$6;
        }
      }), null);
      return _el$;
    }
  });
}
delegateEvents(["click", "input"]);
export {
  FeedbackModal as default
};
