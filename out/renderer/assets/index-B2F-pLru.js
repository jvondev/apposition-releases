const IS_DEV = false;
const equalFn = (a, b) => a === b;
const $PROXY = Symbol("solid-proxy");
const SUPPORTS_PROXY = typeof Proxy === "function";
const $TRACK = Symbol("solid-track");
const signalOptions = {
  equals: equalFn
};
let ERROR = null;
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Transition = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener, owner = Owner, unowned = fn.length === 0, current = detachedOwner === void 0 ? owner : detachedOwner, root = unowned ? UNOWNED : {
    owned: null,
    cleanups: null,
    context: current ? current.context : null,
    owner: current
  }, updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || void 0
  };
  const setter = (value2) => {
    if (typeof value2 === "function") {
      value2 = value2(s.value);
    }
    return writeSignal(s, value2);
  };
  return [readSignal.bind(s), setter];
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  if (!options || !options.render) c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || void 0;
  updateComputation(c);
  return readSignal.bind(c);
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) ;
    return fn();
  } finally {
    Listener = listener;
  }
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null) ;
  else if (Owner.cleanups === null) Owner.cleanups = [fn];
  else Owner.cleanups.push(fn);
  return fn;
}
function catchError(fn, handler) {
  ERROR || (ERROR = Symbol("error"));
  Owner = createComputation(void 0, void 0, true);
  Owner.context = {
    ...Owner.context,
    [ERROR]: [handler]
  };
  try {
    return fn();
  } catch (err) {
    handleError(err);
  } finally {
    Owner = Owner.owner;
  }
}
function getListener() {
  return Listener;
}
function getOwner() {
  return Owner;
}
function runWithOwner(o, fn) {
  const prev = Owner;
  const prevListener = Listener;
  Owner = o;
  Listener = null;
  try {
    return runUpdates(fn, true);
  } catch (err) {
    handleError(err);
  } finally {
    Owner = prev;
    Listener = prevListener;
  }
}
function children(fn) {
  const children2 = createMemo(fn);
  const memo2 = createMemo(() => resolveChildren(children2()));
  memo2.toArray = () => {
    const c = memo2();
    return Array.isArray(c) ? c : c != null ? [c] : [];
  };
  return memo2;
}
function readSignal() {
  if (this.sources && this.state) {
    if (this.state === STALE) updateComputation(this);
    else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const observers = this.observers;
    if (!observers || observers[observers.length - 1] !== Listener) {
      const sSlot = observers ? observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [this];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(this);
        Listener.sourceSlots.push(sSlot);
      }
      if (!observers) {
        this.observers = [Listener];
        this.observerSlots = [Listener.sources.length - 1];
      } else {
        observers.push(Listener);
        this.observerSlots.push(Listener.sources.length - 1);
      }
    }
  }
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current = node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) ;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);
            else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;
        }
        if (Updates.length > 1e6) {
          Updates = [];
          if (IS_DEV) ;
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, node.value, time);
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner, listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init4, pure, state = STALE, options) {
  const c = {
    fn,
    state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init4,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Owner === null) ;
  else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];
      else Owner.owned.push(c);
    }
  }
  return c;
}
function runTop(node) {
  if (node.state === 0) return;
  if (node.state === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if (node.state === STALE) {
      updateComputation(node);
    } else if (node.state === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init4) {
  if (Updates) return fn();
  let wait = false;
  if (!init4) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function runUserEffects(queue) {
  let i, userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);
    else queue[userLength++] = e;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates.push(o);
      else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(), index = node.sourceSlots.pop(), obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(), s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function runErrors(err, fns, owner) {
  try {
    for (const f of fns) f(err);
  } catch (e) {
    handleError(e, owner && owner.owner || null);
  }
}
function handleError(err, owner = Owner) {
  const fns = ERROR && owner && owner.context && owner.context[ERROR];
  const error = castError(err);
  if (!fns) throw error;
  if (Effects) Effects.push({
    fn() {
      runErrors(error, fns, owner);
    },
    state: STALE
  });
  else runErrors(error, fns, owner);
}
function resolveChildren(children2) {
  if (typeof children2 === "function" && !children2.length) return resolveChildren(children2());
  if (Array.isArray(children2)) {
    const results = [];
    for (let i = 0; i < children2.length; i++) {
      const result = resolveChildren(children2[i]);
      if (Array.isArray(result)) {
        if (result.length < 32768) results.push.apply(results, result);
        else for (let j = 0; j < result.length; j++) results.push(result[j]);
      } else {
        results.push(result);
      }
    }
    return results;
  }
  return children2;
}
const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [], mapped = [], disposers = [], len = 0, indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [], newLen = newItems.length, i, j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot((disposer) => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      } else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++) ;
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = /* @__PURE__ */ new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === void 0 ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== void 0 && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function createComponent(Comp, props) {
  return untrack(() => Comp(props || {}));
}
function trueFn() {
  return true;
}
const propTraps = {
  get(_, property, receiver) {
    if (property === $PROXY) return receiver;
    return _.get(property);
  },
  has(_, property) {
    if (property === $PROXY) return true;
    return _.has(property);
  },
  set: trueFn,
  deleteProperty: trueFn,
  getOwnPropertyDescriptor(_, property) {
    return {
      configurable: true,
      enumerable: true,
      get() {
        return _.get(property);
      },
      set: trueFn,
      deleteProperty: trueFn
    };
  },
  ownKeys(_) {
    return _.keys();
  }
};
function resolveSource(s) {
  return !(s = typeof s === "function" ? s() : s) ? {} : s;
}
function resolveSources() {
  for (let i = 0, length = this.length; i < length; ++i) {
    const v = this[i]();
    if (v !== void 0) return v;
  }
}
function mergeProps(...sources) {
  let proxy = false;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    proxy = proxy || !!s && $PROXY in s;
    sources[i] = typeof s === "function" ? (proxy = true, createMemo(s)) : s;
  }
  if (SUPPORTS_PROXY && proxy) {
    return new Proxy({
      get(property) {
        for (let i = sources.length - 1; i >= 0; i--) {
          const v = resolveSource(sources[i])[property];
          if (v !== void 0) return v;
        }
      },
      has(property) {
        for (let i = sources.length - 1; i >= 0; i--) {
          if (property in resolveSource(sources[i])) return true;
        }
        return false;
      },
      keys() {
        const keys = [];
        for (let i = 0; i < sources.length; i++) keys.push(...Object.keys(resolveSource(sources[i])));
        return [...new Set(keys)];
      }
    }, propTraps);
  }
  const sourcesMap = {};
  const defined = /* @__PURE__ */ Object.create(null);
  for (let i = sources.length - 1; i >= 0; i--) {
    const source = sources[i];
    if (!source) continue;
    const sourceKeys = Object.getOwnPropertyNames(source);
    for (let i2 = sourceKeys.length - 1; i2 >= 0; i2--) {
      const key = sourceKeys[i2];
      if (key === "__proto__" || key === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(source, key);
      if (!defined[key]) {
        defined[key] = desc.get ? {
          enumerable: true,
          configurable: true,
          get: resolveSources.bind(sourcesMap[key] = [desc.get.bind(source)])
        } : desc.value !== void 0 ? desc : void 0;
      } else {
        const sources2 = sourcesMap[key];
        if (sources2) {
          if (desc.get) sources2.push(desc.get.bind(source));
          else if (desc.value !== void 0) sources2.push(() => desc.value);
        }
      }
    }
  }
  const target = {};
  const definedKeys = Object.keys(defined);
  for (let i = definedKeys.length - 1; i >= 0; i--) {
    const key = definedKeys[i], desc = defined[key];
    if (desc && desc.get) Object.defineProperty(target, key, desc);
    else target[key] = desc ? desc.value : void 0;
  }
  return target;
}
function splitProps(props, ...keys) {
  const len = keys.length;
  if (SUPPORTS_PROXY && $PROXY in props) {
    const blocked = len > 1 ? keys.flat() : keys[0];
    const res = keys.map((k) => {
      return new Proxy({
        get(property) {
          return k.includes(property) ? props[property] : void 0;
        },
        has(property) {
          return k.includes(property) && property in props;
        },
        keys() {
          return k.filter((property) => property in props);
        }
      }, propTraps);
    });
    res.push(new Proxy({
      get(property) {
        return blocked.includes(property) ? void 0 : props[property];
      },
      has(property) {
        return blocked.includes(property) ? false : property in props;
      },
      keys() {
        return Object.keys(props).filter((k) => !blocked.includes(k));
      }
    }, propTraps));
    return res;
  }
  const objects = [];
  for (let i = 0; i <= len; i++) {
    objects[i] = {};
  }
  for (const propName of Object.getOwnPropertyNames(props)) {
    let keyIndex = len;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].includes(propName)) {
        keyIndex = i;
        break;
      }
    }
    const desc = Object.getOwnPropertyDescriptor(props, propName);
    const isDefaultDesc = !desc.get && !desc.set && desc.enumerable && desc.writable && desc.configurable;
    isDefaultDesc ? objects[keyIndex][propName] = desc.value : Object.defineProperty(objects[keyIndex], propName, desc);
  }
  return objects;
}
const narrowedError = (name) => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || void 0));
}
function Show(props) {
  const keyed = props.keyed;
  const conditionValue = createMemo(() => props.when, void 0, void 0);
  const condition = keyed ? conditionValue : createMemo(conditionValue, void 0, {
    equals: (a, b) => !a === !b
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn ? untrack(() => child(keyed ? c : () => {
        if (!untrack(condition)) throw narrowedError("Show");
        return conditionValue();
      })) : child;
    }
    return props.fallback;
  }, void 0, void 0);
}
function Switch(props) {
  const chs = children(() => props.children);
  const switchFunc = createMemo(() => {
    const ch = chs();
    const mps = Array.isArray(ch) ? ch : [ch];
    let func = () => void 0;
    for (let i = 0; i < mps.length; i++) {
      const index = i;
      const mp = mps[i];
      const prevFunc = func;
      const conditionValue = createMemo(() => prevFunc() ? void 0 : mp.when, void 0, void 0);
      const condition = mp.keyed ? conditionValue : createMemo(conditionValue, void 0, {
        equals: (a, b) => !a === !b
      });
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : void 0);
    }
    return func;
  });
  return createMemo(() => {
    const sel = switchFunc()();
    if (!sel) return props.fallback;
    const [index, conditionValue, mp] = sel;
    const child = mp.children;
    const fn = typeof child === "function" && child.length > 0;
    return fn ? untrack(() => child(mp.keyed ? conditionValue() : () => {
      if (untrack(switchFunc)()?.[0] !== index) throw narrowedError("Match");
      return conditionValue();
    })) : child;
  }, void 0, void 0);
}
function Match(props) {
  return props;
}
let Errors;
function ErrorBoundary(props) {
  let err;
  const [errored, setErrored] = createSignal(err, void 0);
  Errors || (Errors = /* @__PURE__ */ new Set());
  Errors.add(setErrored);
  onCleanup(() => Errors.delete(setErrored));
  return createMemo(() => {
    let e;
    if (e = errored()) {
      const f = props.fallback;
      return typeof f === "function" && f.length ? untrack(() => f(e, () => setErrored())) : f;
    }
    return catchError(() => props.children, setErrored);
  }, void 0, void 0);
}
const booleans = [
  "allowfullscreen",
  "async",
  "alpha",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "disabled",
  "formnovalidate",
  "hidden",
  "indeterminate",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "seamless",
  "selected",
  "adauctionheaders",
  "browsingtopics",
  "credentialless",
  "defaultchecked",
  "defaultmuted",
  "defaultselected",
  "defer",
  "disablepictureinpicture",
  "disableremoteplayback",
  "preservespitch",
  "shadowrootclonable",
  "shadowrootcustomelementregistry",
  "shadowrootdelegatesfocus",
  "shadowrootserializable",
  "sharedstoragewritable"
];
const Properties = /* @__PURE__ */ new Set([
  "className",
  "value",
  "readOnly",
  "noValidate",
  "formNoValidate",
  "isMap",
  "noModule",
  "playsInline",
  "adAuctionHeaders",
  "allowFullscreen",
  "browsingTopics",
  "defaultChecked",
  "defaultMuted",
  "defaultSelected",
  "disablePictureInPicture",
  "disableRemotePlayback",
  "preservesPitch",
  "shadowRootClonable",
  "shadowRootCustomElementRegistry",
  "shadowRootDelegatesFocus",
  "shadowRootSerializable",
  "sharedStorageWritable",
  ...booleans
]);
const ChildProperties = /* @__PURE__ */ new Set(["innerHTML", "textContent", "innerText", "children"]);
const Aliases = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(null), {
  className: "class",
  htmlFor: "for"
});
const PropAliases = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(null), {
  class: "className",
  novalidate: {
    $: "noValidate",
    FORM: 1
  },
  formnovalidate: {
    $: "formNoValidate",
    BUTTON: 1,
    INPUT: 1
  },
  ismap: {
    $: "isMap",
    IMG: 1
  },
  nomodule: {
    $: "noModule",
    SCRIPT: 1
  },
  playsinline: {
    $: "playsInline",
    VIDEO: 1
  },
  readonly: {
    $: "readOnly",
    INPUT: 1,
    TEXTAREA: 1
  },
  adauctionheaders: {
    $: "adAuctionHeaders",
    IFRAME: 1
  },
  allowfullscreen: {
    $: "allowFullscreen",
    IFRAME: 1
  },
  browsingtopics: {
    $: "browsingTopics",
    IMG: 1
  },
  defaultchecked: {
    $: "defaultChecked",
    INPUT: 1
  },
  defaultmuted: {
    $: "defaultMuted",
    AUDIO: 1,
    VIDEO: 1
  },
  defaultselected: {
    $: "defaultSelected",
    OPTION: 1
  },
  disablepictureinpicture: {
    $: "disablePictureInPicture",
    VIDEO: 1
  },
  disableremoteplayback: {
    $: "disableRemotePlayback",
    AUDIO: 1,
    VIDEO: 1
  },
  preservespitch: {
    $: "preservesPitch",
    AUDIO: 1,
    VIDEO: 1
  },
  shadowrootclonable: {
    $: "shadowRootClonable",
    TEMPLATE: 1
  },
  shadowrootdelegatesfocus: {
    $: "shadowRootDelegatesFocus",
    TEMPLATE: 1
  },
  shadowrootserializable: {
    $: "shadowRootSerializable",
    TEMPLATE: 1
  },
  sharedstoragewritable: {
    $: "sharedStorageWritable",
    IFRAME: 1,
    IMG: 1
  }
});
function getPropAlias(prop, tagName) {
  const a = PropAliases[prop];
  return typeof a === "object" ? a[tagName] ? a["$"] : void 0 : a;
}
const DelegatedEvents = /* @__PURE__ */ new Set(["beforeinput", "click", "dblclick", "contextmenu", "focusin", "focusout", "input", "keydown", "keyup", "mousedown", "mousemove", "mouseout", "mouseover", "mouseup", "pointerdown", "pointermove", "pointerout", "pointerover", "pointerup", "touchend", "touchmove", "touchstart"]);
const SVGElements = /* @__PURE__ */ new Set([
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animate",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "circle",
  "clipPath",
  "color-profile",
  "cursor",
  "defs",
  "desc",
  "ellipse",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "filter",
  "font",
  "font-face",
  "font-face-format",
  "font-face-name",
  "font-face-src",
  "font-face-uri",
  "foreignObject",
  "g",
  "glyph",
  "glyphRef",
  "hkern",
  "image",
  "line",
  "linearGradient",
  "marker",
  "mask",
  "metadata",
  "missing-glyph",
  "mpath",
  "path",
  "pattern",
  "polygon",
  "polyline",
  "radialGradient",
  "rect",
  "set",
  "stop",
  "svg",
  "switch",
  "symbol",
  "text",
  "textPath",
  "tref",
  "tspan",
  "use",
  "view",
  "vkern"
]);
const SVGNamespace = {
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace"
};
const memo = (fn) => createMemo(() => fn());
function reconcileArrays(parentNode, a, b) {
  let bLength = b.length, aEnd = a.length, bEnd = bLength, aStart = 0, bStart = 0, after = a[aEnd - 1].nextSibling, map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = /* @__PURE__ */ new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart, sequence = 1, t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}
const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init4, options = {}) {
  let disposer;
  createRoot((dispose2) => {
    disposer = dispose2;
    element === document ? code() : insert(element, code(), element.firstChild ? null : void 0, init4);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    const t = isMathML ? document.createElementNS("http://www.w3.org/1998/Math/MathML", "template") : document.createElement("template");
    t.innerHTML = html;
    return isSVG ? t.content.firstChild.firstChild : isMathML ? t.firstChild : t.content.firstChild;
  };
  const fn = isImportNode ? () => untrack(() => document.importNode(node || (node = create()), true)) : () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document2 = window.document) {
  const e = document2[$$EVENTS] || (document2[$$EVENTS] = /* @__PURE__ */ new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document2.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);
  else node.setAttribute(name, value);
}
function setAttributeNS(node, namespace, name, value) {
  if (value == null) node.removeAttributeNS(namespace, name);
  else node.setAttributeNS(namespace, name, value);
}
function setBoolAttribute(node, name, value) {
  value ? node.setAttribute(name, "") : node.removeAttribute(name);
}
function className(node, value) {
  if (value == null) node.removeAttribute("class");
  else node.className = value;
}
function addEventListener(node, name, handler, delegate) {
  if (delegate) {
    if (Array.isArray(handler)) {
      node[`$$${name}`] = handler[0];
      node[`$$${name}Data`] = handler[1];
    } else node[`$$${name}`] = handler;
  } else if (Array.isArray(handler)) {
    const handlerFn = handler[0];
    node.addEventListener(name, handler[0] = (e) => handlerFn.call(node, handler[1], e));
  } else node.addEventListener(name, handler, typeof handler !== "function" && handler);
}
function classList(node, value, prev = {}) {
  const classKeys = Object.keys(value || {}), prevKeys = Object.keys(prev);
  let i, len;
  for (i = 0, len = prevKeys.length; i < len; i++) {
    const key = prevKeys[i];
    if (!key || key === "undefined" || value[key]) continue;
    toggleClassKey(node, key, false);
    delete prev[key];
  }
  for (i = 0, len = classKeys.length; i < len; i++) {
    const key = classKeys[i], classValue = !!value[key];
    if (!key || key === "undefined" || prev[key] === classValue || !classValue) continue;
    toggleClassKey(node, key, true);
    prev[key] = classValue;
  }
  return prev;
}
function style(node, value, prev) {
  if (!value) return prev ? setAttribute(node, "style") : value;
  const nodeStyle = node.style;
  if (typeof value === "string") return nodeStyle.cssText = value;
  typeof prev === "string" && (nodeStyle.cssText = prev = void 0);
  prev || (prev = {});
  value || (value = {});
  let v, s;
  for (s in prev) {
    value[s] == null && nodeStyle.removeProperty(s);
    delete prev[s];
  }
  for (s in value) {
    v = value[s];
    if (v !== prev[s]) {
      nodeStyle.setProperty(s, v);
      prev[s] = v;
    }
  }
  return prev;
}
function setStyleProperty(node, name, value) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}
function spread(node, props = {}, isSVG, skipChildren) {
  const prevProps = {};
  if (!skipChildren) {
    createRenderEffect(() => prevProps.children = insertExpression(node, props.children, prevProps.children));
  }
  createRenderEffect(() => typeof props.ref === "function" && use(props.ref, node));
  createRenderEffect(() => assign(node, props, isSVG, true, prevProps, true));
  return prevProps;
}
function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== void 0 && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect((current) => insertExpression(parent, accessor(), current, marker), initial);
}
function assign(node, props, isSVG, skipChildren, prevProps = {}, skipRef = false) {
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], isSVG, skipRef, props);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      continue;
    }
    const value = props[prop];
    prevProps[prop] = assignProp(node, prop, value, prevProps[prop], isSVG, skipRef, props);
  }
}
function toPropertyName(name) {
  return name.toLowerCase().replace(/-([a-z])/g, (_, w) => w.toUpperCase());
}
function toggleClassKey(node, key, value) {
  const classNames = key.trim().split(/\s+/);
  for (let i = 0, nameLen = classNames.length; i < nameLen; i++) node.classList.toggle(classNames[i], value);
}
function assignProp(node, prop, value, prev, isSVG, skipRef, props) {
  let isCE, isProp, isChildProp, propAlias, forceProp;
  if (prop === "style") return style(node, value, prev);
  if (prop === "classList") return classList(node, value, prev);
  if (value === prev) return prev;
  if (prop === "ref") {
    if (!skipRef) value(node);
  } else if (prop.slice(0, 3) === "on:") {
    const e = prop.slice(3);
    prev && node.removeEventListener(e, prev, typeof prev !== "function" && prev);
    value && node.addEventListener(e, value, typeof value !== "function" && value);
  } else if (prop.slice(0, 10) === "oncapture:") {
    const e = prop.slice(10);
    prev && node.removeEventListener(e, prev, true);
    value && node.addEventListener(e, value, true);
  } else if (prop.slice(0, 2) === "on") {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      const h = Array.isArray(prev) ? prev[0] : prev;
      node.removeEventListener(name, h);
    }
    if (delegate || value) {
      addEventListener(node, name, value, delegate);
      delegate && delegateEvents([name]);
    }
  } else if (prop.slice(0, 5) === "attr:") {
    setAttribute(node, prop.slice(5), value);
  } else if (prop.slice(0, 5) === "bool:") {
    setBoolAttribute(node, prop.slice(5), value);
  } else if ((forceProp = prop.slice(0, 5) === "prop:") || (isChildProp = ChildProperties.has(prop)) || !isSVG && ((propAlias = getPropAlias(prop, node.tagName)) || (isProp = Properties.has(prop))) || (isCE = node.nodeName.includes("-") || "is" in props)) {
    if (forceProp) {
      prop = prop.slice(5);
      isProp = true;
    }
    if (prop === "class" || prop === "className") className(node, value);
    else if (isCE && !isProp && !isChildProp) node[toPropertyName(prop)] = value;
    else node[propAlias || prop] = value;
  } else {
    const ns = isSVG && prop.indexOf(":") > -1 && SVGNamespace[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, Aliases[prop] || prop, value);
  }
  return value;
}
function eventHandler(e) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value) => Object.defineProperty(e, "target", {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== void 0 ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host)) ;
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node._$host) {
        node = node._$host;
        walkUpTree();
        break;
      }
      if (node.parentNode === oriCurrentTarget) {
        break;
      }
    }
  } else walkUpTree();
  retarget(oriTarget);
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value, multi = marker !== void 0;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else ;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap2) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i], prev = current && current[normalized.length], t;
    if (item == null || item === true || item === false) ;
    else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap2) {
        while (typeof item === "function") item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);
      else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === void 0) return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);
        else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
function createElement(tagName, isSVG = false, is = void 0) {
  return isSVG ? document.createElementNS(SVG_NAMESPACE, tagName) : document.createElement(tagName, {
    is
  });
}
function Portal(props) {
  const {
    useShadow
  } = props, marker = document.createTextNode(""), mount = () => props.mount || document.body, owner = getOwner();
  let content;
  createEffect(() => {
    content || (content = runWithOwner(owner, () => createMemo(() => props.children)));
    const el = mount();
    if (el instanceof HTMLHeadElement) {
      const [clean, setClean] = createSignal(false);
      const cleanup = () => setClean(true);
      createRoot((dispose2) => insert(el, () => !clean() ? content() : dispose2(), null));
      onCleanup(cleanup);
    } else {
      const container = createElement(props.isSVG ? "g" : "div", props.isSVG), renderRoot = useShadow && container.attachShadow ? container.attachShadow({
        mode: "open"
      }) : container;
      Object.defineProperty(container, "_$host", {
        get() {
          return marker.parentNode;
        },
        configurable: true
      });
      insert(renderRoot, content);
      el.appendChild(container);
      props.ref && props.ref(container);
      onCleanup(() => el.contains(container) && el.removeChild(container));
    }
  }, void 0, {
    render: true
  });
  return marker;
}
function createDynamic(component, props) {
  const cached = createMemo(component);
  return createMemo(() => {
    const component2 = cached();
    switch (typeof component2) {
      case "function":
        return untrack(() => component2(props));
      case "string":
        const isSvg = SVGElements.has(component2);
        const el = createElement(component2, isSvg, untrack(() => props.is));
        spread(el, props, isSvg);
        return el;
    }
  });
}
function Dynamic(props) {
  const [, others] = splitProps(props, ["component"]);
  return createDynamic(() => props.component, others);
}
var _tmpl$$f = /* @__PURE__ */ template(`<div class=p-3><div class="px-4 py-2 text-[10px] font-semibold text-neutral-400 tracking-[0.2em] uppercase">Suggestions</div><div class="px-4 py-3 mt-1 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-xl cursor-pointer flex justify-between group transition-colors"><span class="group-hover:translate-x-1 transition-transform duration-300 ease-out font-medium">Hibernate Background Panes (Free Memory)</span><span class="text-neutral-400 text-xs font-mono bg-white border border-neutral-200 shadow-sm px-2 py-0.5 rounded-md">mem</span></div><div class="px-4 py-3 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 rounded-xl cursor-pointer flex justify-between group transition-colors"><span class="group-hover:translate-x-1 transition-transform duration-300 ease-out font-medium">Hibernate All Panes (Deep Sleep)</span><span class="text-neutral-400 text-xs font-mono bg-white border border-neutral-200 shadow-sm px-2 py-0.5 rounded-md">zzz`), _tmpl$2$c = /* @__PURE__ */ template(`<div class="absolute inset-0 z-50 flex justify-center pt-[15vh] bg-neutral-900/60 animate-in fade-in duration-500"><div class="w-[640px] h-fit max-h-[60vh] bg-neutral-200/50 p-1.5 rounded-[2rem] ring-1 ring-black/5 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] animate-in slide-in-from-top-8 duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]"><div class="w-full bg-white rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] overflow-hidden flex flex-col"><div class="flex items-center px-6 h-16 border-b border-neutral-100"><span class="text-neutral-300 mr-4 text-2xl font-light">›</span><input type=text placeholder="Type a URL or command..."class="w-full h-full bg-transparent outline-none text-neutral-800 placeholder:text-neutral-400 font-sans text-lg tracking-tight">`);
function CommandPalette(props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let inputRef;
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen(true);
      } else if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });
  createEffect(() => {
    if (isOpen()) {
      setTimeout(() => inputRef?.focus(), 10);
    } else {
      setQuery("");
    }
  });
  return createComponent(Show, {
    get when() {
      return isOpen();
    },
    get children() {
      var _el$ = _tmpl$2$c(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling;
      _el$.$$click = () => setIsOpen(false);
      _el$2.$$click = (e) => e.stopPropagation();
      _el$6.$$keydown = (e) => {
        if (e.key === "Enter" && query()) {
          const isUrl = query().includes(".") && !query().includes(" ");
          if (isUrl) {
            props.onSpawnPane?.({
              id: `web_${Date.now()}`,
              type: "web",
              url: query().startsWith("http") ? query() : `https://${query()}`,
              profileId: "work"
            });
          }
          setIsOpen(false);
        }
      };
      _el$6.$$input = (e) => setQuery(e.currentTarget.value);
      var _ref$ = inputRef;
      typeof _ref$ === "function" ? use(_ref$, _el$6) : inputRef = _el$6;
      insert(_el$3, createComponent(Show, {
        get when() {
          return !query();
        },
        get children() {
          var _el$7 = _tmpl$$f(), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$9.nextSibling;
          _el$9.$$click = () => {
            window.dispatchEvent(new CustomEvent("app:hibernate-pane", {
              detail: "background"
            }));
            setIsOpen(false);
          };
          _el$0.$$click = () => {
            window.dispatchEvent(new CustomEvent("app:hibernate-pane", {
              detail: "all"
            }));
            setIsOpen(false);
          };
          return _el$7;
        }
      }), null);
      createRenderEffect(() => _el$6.value = query());
      return _el$;
    }
  });
}
delegateEvents(["click", "input", "keydown"]);
const $RAW = Symbol("store-raw"), $NODE = Symbol("store-node"), $HAS = Symbol("store-has"), $SELF = Symbol("store-self");
function wrap$1(value) {
  let p = value[$PROXY];
  if (!p) {
    Object.defineProperty(value, $PROXY, {
      value: p = new Proxy(value, proxyTraps$1)
    });
    if (!Array.isArray(value)) {
      const keys = Object.keys(value), desc = Object.getOwnPropertyDescriptors(value), proto = Object.getPrototypeOf(value);
      const isClass = proto !== null && value !== null && typeof value === "object" && !Array.isArray(value) && proto !== Object.prototype;
      if (isClass) {
        const descriptors = Object.getOwnPropertyDescriptors(proto);
        keys.push(...Object.keys(descriptors));
        Object.assign(desc, descriptors);
      }
      for (let i = 0, l = keys.length; i < l; i++) {
        const prop = keys[i];
        if (isClass && prop === "constructor") continue;
        if (desc[prop].get) {
          Object.defineProperty(value, prop, {
            configurable: true,
            enumerable: desc[prop].enumerable,
            get: desc[prop].get.bind(p)
          });
        }
      }
    }
  }
  return p;
}
function isWrappable(obj) {
  let proto;
  return obj != null && typeof obj === "object" && (obj[$PROXY] || !(proto = Object.getPrototypeOf(obj)) || proto === Object.prototype || Array.isArray(obj));
}
function unwrap(item, set = /* @__PURE__ */ new Set()) {
  let result, unwrapped, v, prop;
  if (result = item != null && item[$RAW]) return result;
  if (!isWrappable(item) || set.has(item)) return item;
  if (Array.isArray(item)) {
    if (Object.isFrozen(item)) item = item.slice(0);
    else set.add(item);
    for (let i = 0, l = item.length; i < l; i++) {
      v = item[i];
      if ((unwrapped = unwrap(v, set)) !== v) item[i] = unwrapped;
    }
  } else {
    if (Object.isFrozen(item)) item = Object.assign({}, item);
    else set.add(item);
    const keys = Object.keys(item), desc = Object.getOwnPropertyDescriptors(item);
    for (let i = 0, l = keys.length; i < l; i++) {
      prop = keys[i];
      if (desc[prop].get) continue;
      v = item[prop];
      if ((unwrapped = unwrap(v, set)) !== v) item[prop] = unwrapped;
    }
  }
  return item;
}
function getNodes(target, symbol) {
  let nodes = target[symbol];
  if (!nodes) Object.defineProperty(target, symbol, {
    value: nodes = /* @__PURE__ */ Object.create(null)
  });
  return nodes;
}
function getNode(nodes, property, value) {
  if (nodes[property]) return nodes[property];
  const [s, set] = createSignal(value, {
    equals: false,
    internal: true
  });
  s.$ = set;
  return nodes[property] = s;
}
function proxyDescriptor$1(target, property) {
  const desc = Reflect.getOwnPropertyDescriptor(target, property);
  if (!desc || desc.get || !desc.configurable || property === $PROXY || property === $NODE) return desc;
  delete desc.value;
  delete desc.writable;
  desc.get = () => target[$PROXY][property];
  return desc;
}
function trackSelf(target) {
  getListener() && getNode(getNodes(target, $NODE), $SELF)();
}
function ownKeys(target) {
  trackSelf(target);
  return Reflect.ownKeys(target);
}
const proxyTraps$1 = {
  get(target, property, receiver) {
    if (property === $RAW) return target;
    if (property === $PROXY) return receiver;
    if (property === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    const nodes = getNodes(target, $NODE);
    const tracked = nodes[property];
    let value = tracked ? tracked() : target[property];
    if (property === $NODE || property === $HAS || property === "__proto__") return value;
    if (!tracked) {
      const desc = Object.getOwnPropertyDescriptor(target, property);
      if (getListener() && (typeof value !== "function" || Object.prototype.hasOwnProperty.call(target, property)) && !(desc && desc.get)) value = getNode(nodes, property, value)();
    }
    return isWrappable(value) ? wrap$1(value) : value;
  },
  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $TRACK || property === $NODE || property === $HAS || property === "__proto__") return true;
    getListener() && getNode(getNodes(target, $HAS), property)();
    return property in target;
  },
  set() {
    return true;
  },
  deleteProperty() {
    return true;
  },
  ownKeys,
  getOwnPropertyDescriptor: proxyDescriptor$1
};
function setProperty(state, property, value, deleting = false) {
  if (property === "__proto__") {
    return;
  }
  if (!deleting && state[property] === value) return;
  const prev = state[property], len = state.length;
  if (value === void 0) {
    delete state[property];
    if (state[$HAS] && state[$HAS][property] && prev !== void 0) state[$HAS][property].$();
  } else {
    state[property] = value;
    if (state[$HAS] && state[$HAS][property] && prev === void 0) state[$HAS][property].$();
  }
  let nodes = getNodes(state, $NODE), node;
  if (node = getNode(nodes, property, prev)) node.$(() => value);
  if (Array.isArray(state) && state.length !== len) {
    for (let i = state.length; i < len; i++) (node = nodes[i]) && node.$();
    (node = getNode(nodes, "length", len)) && node.$(state.length);
  }
  (node = nodes[$SELF]) && node.$();
}
function mergeStoreNode(state, value) {
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (isUnsafeKey$1(key)) continue;
    setProperty(state, key, value[key]);
  }
}
function isUnsafeKey$1(property) {
  return property === "__proto__" || property === "constructor" || property === "prototype";
}
function updateArray(current, next) {
  if (typeof next === "function") next = next(current);
  next = unwrap(next);
  if (Array.isArray(next)) {
    if (current === next) return;
    let i = 0, len = next.length;
    for (; i < len; i++) {
      const value = next[i];
      if (current[i] !== value) setProperty(current, i, value);
    }
    setProperty(current, "length", len);
  } else mergeStoreNode(current, next);
}
function updatePath(current, path, traversed = []) {
  let part, prev = current;
  if (path.length > 1) {
    part = path.shift();
    const partType = typeof part, isArray = Array.isArray(current);
    if (partType === "string" && (part === "__proto__" || path.length > 1 && isUnsafeKey$1(part))) {
      return;
    }
    if (Array.isArray(part)) {
      for (let i = 0; i < part.length; i++) {
        updatePath(current, [part[i]].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "function") {
      for (let i = 0; i < current.length; i++) {
        if (part(current[i], i)) updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (isArray && partType === "object") {
      const {
        from = 0,
        to = current.length - 1,
        by = 1
      } = part;
      for (let i = from; i <= to; i += by) {
        updatePath(current, [i].concat(path), traversed);
      }
      return;
    } else if (path.length > 1) {
      updatePath(current[part], path, [part].concat(traversed));
      return;
    }
    prev = current[part];
    traversed = [part].concat(traversed);
  }
  let value = path[0];
  if (typeof value === "function") {
    value = value(prev, traversed);
    if (value === prev) return;
  }
  if (part === void 0 && value == void 0) return;
  value = unwrap(value);
  if (part === void 0 || isWrappable(prev) && isWrappable(value) && !Array.isArray(value)) {
    mergeStoreNode(prev, value);
  } else setProperty(current, part, value);
}
function createStore(...[store, options]) {
  const unwrappedStore = unwrap(store || {});
  const isArray = Array.isArray(unwrappedStore);
  const wrappedStore = wrap$1(unwrappedStore);
  function setStore(...args) {
    batch(() => {
      isArray && args.length === 1 ? updateArray(unwrappedStore, args[0]) : updatePath(unwrappedStore, args);
    });
  }
  return [wrappedStore, setStore];
}
const $ROOT = Symbol("store-root");
function isUnsafeKey(property) {
  return property === "__proto__" || property === "constructor" || property === "prototype";
}
function applyState(target, parent, property, merge, key) {
  if (isUnsafeKey(property)) return;
  const previous = parent[property];
  if (target === previous) return;
  const isArray = Array.isArray(target);
  if (property !== $ROOT && (!isWrappable(target) || !isWrappable(previous) || isArray !== Array.isArray(previous) || key && target[key] !== previous[key])) {
    setProperty(parent, property, target);
    return;
  }
  if (isArray) {
    if (target.length && previous.length && (!merge || key && target[0] && target[0][key] != null)) {
      let i, j, start, end, newEnd, item, newIndicesNext, keyVal;
      for (start = 0, end = Math.min(previous.length, target.length); start < end && (previous[start] === target[start] || key && previous[start] && target[start] && previous[start][key] && previous[start][key] === target[start][key]); start++) {
        applyState(target[start], previous, start, merge, key);
      }
      const temp = new Array(target.length), newIndices = /* @__PURE__ */ new Map();
      for (end = previous.length - 1, newEnd = target.length - 1; end >= start && newEnd >= start && (previous[end] === target[newEnd] || key && previous[end] && target[newEnd] && previous[end][key] && previous[end][key] === target[newEnd][key]); end--, newEnd--) {
        temp[newEnd] = previous[end];
      }
      if (start > newEnd || start > end) {
        for (j = start; j <= newEnd; j++) setProperty(previous, j, target[j]);
        for (; j < target.length; j++) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        }
        if (previous.length > target.length) setProperty(previous, "length", target.length);
        return;
      }
      newIndicesNext = new Array(newEnd + 1);
      for (j = newEnd; j >= start; j--) {
        item = target[j];
        keyVal = key && item ? item[key] : item;
        i = newIndices.get(keyVal);
        newIndicesNext[j] = i === void 0 ? -1 : i;
        newIndices.set(keyVal, j);
      }
      for (i = start; i <= end; i++) {
        item = previous[i];
        keyVal = key && item ? item[key] : item;
        j = newIndices.get(keyVal);
        if (j !== void 0 && j !== -1) {
          temp[j] = previous[i];
          j = newIndicesNext[j];
          newIndices.set(keyVal, j);
        }
      }
      for (j = start; j < target.length; j++) {
        if (j in temp) {
          setProperty(previous, j, temp[j]);
          applyState(target[j], previous, j, merge, key);
        } else setProperty(previous, j, target[j]);
      }
    } else {
      for (let i = 0, len = target.length; i < len; i++) {
        applyState(target[i], previous, i, merge, key);
      }
    }
    if (previous.length > target.length) setProperty(previous, "length", target.length);
    return;
  }
  const targetKeys = Object.keys(target);
  for (let i = 0, len = targetKeys.length; i < len; i++) {
    if (isUnsafeKey(targetKeys[i])) continue;
    applyState(target[targetKeys[i]], previous, targetKeys[i], merge, key);
  }
  const previousKeys = Object.keys(previous);
  for (let i = 0, len = previousKeys.length; i < len; i++) {
    if (target[previousKeys[i]] === void 0) setProperty(previous, previousKeys[i], void 0);
  }
}
function reconcile(value, options = {}) {
  const {
    merge,
    key = "id"
  } = options, v = unwrap(value);
  return (state) => {
    if (!isWrappable(state) || !isWrappable(v)) return v;
    const res = applyState(v, {
      [$ROOT]: state
    }, $ROOT, merge, key);
    return res === void 0 ? state : res;
  };
}
const [layoutStore, setLayoutStore] = createStore({
  nodes: {
    "pane_initial": { type: "pane", id: "pane_initial", paneType: "web", title: "New Tab" }
  },
  rootId: "pane_initial",
  snapshots: {},
  isTransitioning: false,
  maximizedPaneId: null,
  profiles: [],
  isPremium: true,
  paywallReason: null,
  showPaywall: false,
  paywallAnchor: null,
  licenseState: null,
  showSettings: false,
  settingsAnchor: null
});
var _tmpl$$e = /* @__PURE__ */ template(`<div class="flex flex-col gap-3 p-1"><div class=space-y-1><label class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Profile Name</label><input type=text placeholder="e.g. Work, Personal"class="w-full bg-white border border-neutral-200 rounded px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"autofocus></div><div class=space-y-1><label class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Theme Color</label><div class="flex flex-wrap gap-1.5"></div></div><div class="space-y-1 pt-1"><label class="flex items-center gap-2 cursor-pointer group"><div class="relative flex items-center"><input type=checkbox class="peer sr-only"><div class="w-8 h-4.5 bg-neutral-200 rounded-full peer peer-checked:bg-blue-500 transition-colors"></div><div class="absolute left-0.5 top-0.5 bg-white w-3.5 h-3.5 rounded-full transition-transform peer-checked:translate-x-3.5 shadow-sm"></div></div><span class="text-xs font-medium text-neutral-700 group-hover:text-neutral-900">Incognito Mode (RAM-only)</span></label></div><div class=space-y-1><label class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Proxy Server (Optional)</label><input type=text placeholder="e.g. socks5://127.0.0.1:9050"class="w-full bg-white border border-neutral-200 rounded px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"></div><div class=space-y-1><label class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">Custom User Agent (Optional)</label><input type=text placeholder="e.g. Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)..."class="w-full bg-white border border-neutral-200 rounded px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"></div><div class="flex items-center justify-between mt-2 pt-2 border-t border-neutral-100"><div></div><div class="flex items-center gap-2"><button class="text-[10px] font-medium text-neutral-500 hover:text-neutral-700 px-2 py-1">Cancel</button><button class="text-[10px] font-medium bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded transition-colors">Save Profile`), _tmpl$2$b = /* @__PURE__ */ template(`<button>`), _tmpl$3$b = /* @__PURE__ */ template(`<button class="text-[10px] font-medium text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors">Delete`);
const COLORS = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#d946ef"];
function ProfileForm(props) {
  const [name, setName] = createSignal(props.initialData?.name || "");
  const [color, setColor] = createSignal(props.initialData?.color || COLORS[6]);
  const [isEphemeral, setIsEphemeral] = createSignal(props.initialData?.is_ephemeral || false);
  const [proxyServer, setProxyServer] = createSignal(props.initialData?.proxy_server || "");
  const [userAgent, setUserAgent] = createSignal(props.initialData?.user_agent || "");
  const handleSave = () => {
    if (!name().trim()) return;
    props.onSave({
      id: props.initialData?.id,
      name: name().trim(),
      color: color(),
      is_ephemeral: isEphemeral(),
      proxy_server: proxyServer().trim() || "",
      user_agent: userAgent().trim() || ""
    });
  };
  return (() => {
    var _el$ = _tmpl$$e(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$2.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$5.nextSibling, _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$8.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$10.nextSibling, _el$14 = _el$13.firstChild, _el$15 = _el$14.nextSibling, _el$16 = _el$13.nextSibling, _el$17 = _el$16.firstChild, _el$18 = _el$17.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.nextSibling;
    _el$4.$$input = (e) => setName(e.currentTarget.value);
    insert(_el$7, () => COLORS.map((c) => (() => {
      var _el$21 = _tmpl$2$b();
      _el$21.$$click = () => setColor(c);
      setStyleProperty(_el$21, "background-color", c);
      createRenderEffect(() => className(_el$21, `w-5 h-5 rounded-full transition-transform hover:scale-110 ${color() === c ? "ring-2 ring-offset-1 ring-neutral-400 scale-110" : ""}`));
      return _el$21;
    })()));
    _el$1.addEventListener("change", (e) => setIsEphemeral(e.currentTarget.checked));
    _el$12.$$input = (e) => setProxyServer(e.currentTarget.value);
    _el$15.$$input = (e) => setUserAgent(e.currentTarget.value);
    insert(_el$17, (() => {
      var _c$ = memo(() => !!props.onDelete);
      return () => _c$() && (() => {
        var _el$22 = _tmpl$3$b();
        addEventListener(_el$22, "click", props.onDelete, true);
        return _el$22;
      })();
    })());
    addEventListener(_el$19, "click", props.onCancel, true);
    _el$20.$$click = handleSave;
    createRenderEffect(() => _el$20.disabled = !name().trim());
    createRenderEffect(() => _el$4.value = name());
    createRenderEffect(() => _el$1.checked = isEphemeral());
    createRenderEffect(() => _el$12.value = proxyServer());
    createRenderEffect(() => _el$15.value = userAgent());
    return _el$;
  })();
}
delegateEvents(["input", "click"]);
var _tmpl$$d = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[85] pointer-events-auto bg-black/10 backdrop-blur-[2px] transition-all duration-500 animate-in fade-in">`), _tmpl$2$a = /* @__PURE__ */ template(`<div class="w-[1px] h-3.5 bg-neutral-200 shrink-0 mx-0.5">`), _tmpl$3$a = /* @__PURE__ */ template(`<div class="absolute top-full -ml-[60px] mt-2 z-[100]"><div class="p-1.5 bg-neutral-200/50 backdrop-blur-xl ring-1 ring-black/5 rounded-[1.25rem] shadow-[0_24px_56px_-12px_rgba(0,0,0,0.15)] animate-in slide-in-from-top-1 fade-in duration-200"><div class="bg-white rounded-[calc(1.25rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] w-[160px] flex flex-col overflow-hidden"><div class="px-3 pt-2.5 pb-1.5 border-b border-neutral-100"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.15em]">Split Layout</span></div><div class="p-1 grid grid-cols-2 gap-0.5"><button class="flex flex-col items-center p-2 hover:bg-neutral-50 text-neutral-600 hover:text-neutral-900 rounded-lg transition-colors"><span class="text-xl leading-none mb-1">◧</span><span class="text-[9px] font-medium uppercase tracking-wide">Left</span></button><button class="flex flex-col items-center p-2 hover:bg-neutral-50 text-neutral-600 hover:text-neutral-900 rounded-lg transition-colors"><span class="text-xl leading-none mb-1">◨</span><span class="text-[9px] font-medium uppercase tracking-wide">Right</span></button><button class="flex flex-col items-center p-2 hover:bg-neutral-50 text-neutral-600 hover:text-neutral-900 rounded-lg transition-colors"><span class="text-xl leading-none mb-1">⬒</span><span class="text-[9px] font-medium uppercase tracking-wide">Top</span></button><button class="flex flex-col items-center p-2 hover:bg-neutral-50 text-neutral-600 hover:text-neutral-900 rounded-lg transition-colors"><span class="text-xl leading-none mb-1">⬓</span><span class="text-[9px] font-medium uppercase tracking-wide">Bottom`), _tmpl$4$a = /* @__PURE__ */ template(`<div class="relative group/splitmenu flex items-center bg-transparent hover:bg-neutral-100 rounded-[10px] transition-colors shrink-0"><button class="text-neutral-500 hover:text-blue-600 pl-2 pr-1 py-1.5 flex items-center justify-center transition-colors"><span class="text-sm leading-none -mt-0.5"></span></button><button class="text-neutral-400 hover:text-blue-500 pr-1.5 pl-0.5 py-1.5 flex items-center justify-center transition-colors"><span class="text-[8px] opacity-70">▼`), _tmpl$5$a = /* @__PURE__ */ template(`<div class="text-neutral-500 hover:text-neutral-900 transition-colors px-1.5 py-1.5 cursor-grab active:cursor-grabbing rounded-[10px] hover:bg-neutral-100 flex items-center justify-center shrink-0"title="Drag to move"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="19 9 22 12 19 15"></polyline><polyline points="9 19 12 22 15 19">`), _tmpl$6$8 = /* @__PURE__ */ template(`<div class="flex flex-col"><div class="px-3 pt-2.5 pb-1.5 border-b border-neutral-100 flex items-center justify-between"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.15em]">Select Profile</span></div><div class="max-h-[50vh] overflow-y-auto p-1">`), _tmpl$7$7 = /* @__PURE__ */ template(`<div class="border-t border-neutral-100 p-1.5 bg-neutral-50/50"><button class="w-full flex items-center justify-center gap-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 bg-white hover:bg-neutral-50 border border-neutral-200/80 py-1.5 rounded-[8px] transition-colors shadow-sm"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round><line x1=12 y1=5 x2=12 y2=19></line><line x1=5 y1=12 x2=19 y2=12></line></svg>New Profile`), _tmpl$8$7 = /* @__PURE__ */ template(`<div class="absolute top-full -ml-[90px] mt-2 z-[100]"><div class="p-1.5 bg-neutral-200/50 backdrop-blur-xl ring-1 ring-black/5 rounded-[1.25rem] shadow-[0_24px_56px_-12px_rgba(0,0,0,0.15)] animate-in slide-in-from-top-1 fade-in duration-200"><div class="bg-white rounded-[calc(1.25rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] w-[240px] flex flex-col overflow-hidden">`), _tmpl$9$7 = /* @__PURE__ */ template(`<div class="relative group/profilemenu flex items-center bg-transparent hover:bg-neutral-100 rounded-[10px] transition-colors shrink-0"><button class="text-neutral-500 hover:text-blue-600 px-1.5 py-1 flex items-center justify-center transition-colors"title="Change Profile"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx=12 cy=7 r=4></circle></svg><span class="text-[8px] opacity-70 ml-1">▼`), _tmpl$0$7 = /* @__PURE__ */ template(`<button class="text-neutral-500 hover:text-white hover:bg-red-500/90 rounded-[10px] w-7 h-7 flex items-center justify-center transition-colors shrink-0"title="Close Pane"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5><path d="M18 6L6 18M6 6l12 12">`), _tmpl$1$7 = /* @__PURE__ */ template(`<div><div><div><div><button class="flex items-center justify-center w-7 h-7 rounded-[10px] hover:bg-black/5 active:scale-95 transition-all text-neutral-600 disabled:opacity-30 disabled:pointer-events-none shrink-0"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><path d="m15 18-6-6 6-6"></path></svg></button><button class="flex items-center justify-center w-7 h-7 rounded-[10px] hover:bg-black/5 active:scale-95 transition-all text-neutral-600 disabled:opacity-30 disabled:pointer-events-none shrink-0"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><path d="m9 18 6-6-6-6"></path></svg></button><div><button title="Edit URL"><svg viewBox="0 0 24 24"fill=none stroke=currentColor stroke-linecap=round stroke-linejoin=round><circle cx=12 cy=12 r=10></circle><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path><path d="M2 12h20"></path></svg></button><input type=text placeholder="Search or URL">`), _tmpl$10$7 = /* @__PURE__ */ template(`<div class=p-3>`), _tmpl$11$5 = /* @__PURE__ */ template(`<svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round class="text-neutral-400 shrink-0"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1=1 y1=1 x2=23 y2=23>`), _tmpl$12$5 = /* @__PURE__ */ template(`<div class="group/prow flex items-center justify-between"><button><div class="flex items-center justify-center w-[16px] h-[16px] rounded-full text-white text-[8px] font-bold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] shrink-0"></div><span class="truncate tracking-tight flex-1"></span></button><button class="p-2 ml-1 text-neutral-400 hover:text-neutral-800 transition-colors opacity-0 group-hover/prow:opacity-100 rounded-[8px] hover:bg-neutral-100 shrink-0"title="Edit Profile"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z">`);
const [lastSplitChoice, setLastSplitChoice] = createSignal("right");
function PaneIsland(props) {
  const [showSplitMenu, setShowSplitMenu] = createSignal(false);
  const [showProfileMenu, setShowProfileMenu] = createSignal(false);
  const [editingProfileId, setEditingProfileId] = createSignal(null);
  const [isCreatingProfile, setIsCreatingProfile] = createSignal(false);
  const [urlExpanded, setUrlExpanded] = createSignal(false);
  let urlInputRef;
  onMount(() => {
    const handleFocus = (e) => {
      if (e.detail?.activePaneId === props.node.id) {
        setUrlExpanded(true);
        setTimeout(() => {
          urlInputRef?.focus();
          urlInputRef?.select();
        }, 10);
      }
    };
    window.addEventListener("focus-address-bar", handleFocus);
    onCleanup(() => window.removeEventListener("focus-address-bar", handleFocus));
  });
  const handleSaveProfile = async (data) => {
    if (!data.id) {
      if (!layoutStore.isPremium && layoutStore.profiles.length >= 2) {
        setLayoutStore("paywallReason", "profile");
        setLayoutStore("showPaywall", true);
        return;
      }
      const id = `profile_${Date.now()}`;
      await window.api?.createProfile(id, data.name, data.color, !!data.is_ephemeral, data.proxy_server, data.user_agent);
      props.onUpdatePane(props.node.id, {
        profileId: id
      });
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
      setEditingProfileId(null);
    }
  };
  return createComponent(Show, {
    get when() {
      return !props.isDraggingThis?.();
    },
    get children() {
      return [createComponent(Show, {
        get when() {
          return urlExpanded();
        },
        get children() {
          var _el$ = _tmpl$$d();
          _el$.$$pointerdown = (e) => {
            e.stopPropagation();
            setUrlExpanded(false);
          };
          return _el$;
        }
      }), (() => {
        var _el$2 = _tmpl$1$7(), _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.nextSibling, _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$9.nextSibling;
        _el$6.$$click = (e) => {
          e.stopPropagation();
          if (props.node.canGoBack) {
            window.api?.viewGoBack(props.node.id);
          } else if (props.node.history && props.node.historyIndex !== void 0 && props.node.historyIndex > 0) {
            const backUrl = props.node.history[props.node.historyIndex - 1];
            window.api?.viewLoadURL(props.node.id, backUrl, {
              clearHistory: true
            });
          }
        };
        _el$7.$$click = (e) => {
          e.stopPropagation();
          if (props.node.canGoForward) {
            window.api?.viewGoForward(props.node.id);
          } else if (props.node.history && props.node.historyIndex !== void 0 && props.node.historyIndex < props.node.history.length - 1) {
            const fwdUrl = props.node.history[props.node.historyIndex + 1];
            window.api?.viewLoadURL(props.node.id, fwdUrl, {
              clearHistory: true
            });
          }
        };
        _el$9.$$click = (e) => {
          e.stopPropagation();
          if (!urlExpanded()) setUrlExpanded(true);
        };
        _el$1.$$keydown = (e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.currentTarget.value = props.node.url || "";
            e.currentTarget.blur();
          }
        };
        _el$1.addEventListener("blur", (e) => {
          setUrlExpanded(false);
          let val = e.target.value.trim();
          if (val && val !== props.node.url) {
            if (!/^https?:\/\//i.test(val) && val.includes(".")) {
              val = `https://${val}`;
            } else if (!/^https?:\/\//i.test(val)) {
              val = `https://google.com/search?q=${encodeURIComponent(val)}`;
            }
            window.dispatchEvent(new CustomEvent("pane.force-gate", {
              detail: {
                id: props.node.id,
                url: val
              }
            }));
            window.api?.viewLoadURL(props.node.id, val);
          }
        });
        var _ref$ = urlInputRef;
        typeof _ref$ === "function" ? use(_ref$, _el$1) : urlInputRef = _el$1;
        insert(_el$4, createComponent(Show, {
          get when() {
            return !urlExpanded();
          },
          get children() {
            return [_tmpl$2$a(), (() => {
              var _el$11 = _tmpl$4$a(), _el$12 = _el$11.firstChild, _el$13 = _el$12.firstChild, _el$14 = _el$12.nextSibling;
              _el$12.$$click = (e) => {
                e.stopPropagation();
                props.onSplit(props.node.id, lastSplitChoice());
              };
              insert(_el$13, (() => {
                var _c$ = memo(() => lastSplitChoice() === "left");
                return () => _c$() ? "◧" : memo(() => lastSplitChoice() === "right")() ? "◨" : lastSplitChoice() === "top" ? "⬒" : "⬓";
              })());
              _el$14.$$click = (e) => {
                e.stopPropagation();
                setShowSplitMenu(!showSplitMenu());
                setShowProfileMenu(false);
              };
              insert(_el$11, createComponent(Show, {
                get when() {
                  return showSplitMenu();
                },
                get children() {
                  var _el$15 = _tmpl$3$a(), _el$16 = _el$15.firstChild, _el$17 = _el$16.firstChild, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$21.nextSibling, _el$23 = _el$22.nextSibling;
                  _el$20.$$click = (e) => {
                    e.stopPropagation();
                    setLastSplitChoice("left");
                    props.onSplit(props.node.id, "left");
                    setShowSplitMenu(false);
                  };
                  _el$21.$$click = (e) => {
                    e.stopPropagation();
                    setLastSplitChoice("right");
                    props.onSplit(props.node.id, "right");
                    setShowSplitMenu(false);
                  };
                  _el$22.$$click = (e) => {
                    e.stopPropagation();
                    setLastSplitChoice("top");
                    props.onSplit(props.node.id, "top");
                    setShowSplitMenu(false);
                  };
                  _el$23.$$click = (e) => {
                    e.stopPropagation();
                    setLastSplitChoice("bottom");
                    props.onSplit(props.node.id, "bottom");
                    setShowSplitMenu(false);
                  };
                  return _el$15;
                }
              }), null);
              createRenderEffect(() => setAttribute(_el$12, "title", `Split ${lastSplitChoice()}`));
              return _el$11;
            })(), createComponent(Show, {
              get when() {
                return !props.isOnlyPane;
              },
              get children() {
                return [_tmpl$2$a(), (() => {
                  var _el$25 = _tmpl$5$a();
                  _el$25.$$pointerdown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent("app:dragstart", {
                      detail: {
                        id: props.node.id,
                        e
                      }
                    }));
                  };
                  return _el$25;
                })()];
              }
            }), _tmpl$2$a(), (() => {
              var _el$27 = _tmpl$9$7(), _el$28 = _el$27.firstChild;
              _el$28.$$click = (e) => {
                e.stopPropagation();
                setShowProfileMenu(!showProfileMenu());
                setShowSplitMenu(false);
              };
              insert(_el$27, createComponent(Show, {
                get when() {
                  return showProfileMenu();
                },
                get children() {
                  var _el$29 = _tmpl$8$7(), _el$30 = _el$29.firstChild, _el$31 = _el$30.firstChild;
                  insert(_el$31, createComponent(Show, {
                    get when() {
                      return memo(() => !!!editingProfileId())() && !isCreatingProfile();
                    },
                    get fallback() {
                      return (() => {
                        var _el$39 = _tmpl$10$7();
                        insert(_el$39, createComponent(ProfileForm, {
                          get initialData() {
                            const p = layoutStore.profiles.find((p2) => p2.id === editingProfileId());
                            if (!p) return void 0;
                            return {
                              ...p,
                              is_ephemeral: !!p.is_ephemeral,
                              proxy_server: p.proxy_server || "",
                              user_agent: p.user_agent || ""
                            };
                          },
                          onSave: handleSaveProfile,
                          onCancel: () => {
                            setEditingProfileId(null);
                            setIsCreatingProfile(false);
                          },
                          get onDelete() {
                            return editingProfileId() && editingProfileId() !== "main" ? () => handleDeleteProfile(editingProfileId()) : void 0;
                          }
                        }));
                        return _el$39;
                      })();
                    },
                    get children() {
                      return [(() => {
                        var _el$32 = _tmpl$6$8(), _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling;
                        insert(_el$34, createComponent(For, {
                          get each() {
                            return layoutStore.profiles;
                          },
                          children: (profile) => (() => {
                            var _el$40 = _tmpl$12$5(), _el$41 = _el$40.firstChild, _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling, _el$45 = _el$41.nextSibling;
                            _el$41.$$click = (e) => {
                              e.stopPropagation();
                              props.onUpdatePane(props.node.id, {
                                profileId: profile.id
                              });
                              setShowProfileMenu(false);
                            };
                            insert(_el$42, () => profile.name.charAt(0).toUpperCase());
                            insert(_el$43, () => profile.name);
                            insert(_el$41, createComponent(Show, {
                              get when() {
                                return profile.is_ephemeral;
                              },
                              get children() {
                                return _tmpl$11$5();
                              }
                            }), null);
                            _el$45.$$click = (e) => {
                              e.stopPropagation();
                              setEditingProfileId(profile.id);
                              setIsCreatingProfile(false);
                            };
                            createRenderEffect((_p$) => {
                              var _v$11 = `flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] transition-colors w-full text-left outline-none ${props.node.profileId === profile.id || profile.id === "main" && !props.node.profileId ? "bg-neutral-100 text-neutral-900 font-medium" : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`, _v$12 = profile.color || "#3b82f6";
                              _v$11 !== _p$.e && className(_el$41, _p$.e = _v$11);
                              _v$12 !== _p$.t && setStyleProperty(_el$42, "background-color", _p$.t = _v$12);
                              return _p$;
                            }, {
                              e: void 0,
                              t: void 0
                            });
                            return _el$40;
                          })()
                        }));
                        return _el$32;
                      })(), (() => {
                        var _el$35 = _tmpl$7$7(), _el$36 = _el$35.firstChild;
                        _el$36.$$click = (e) => {
                          e.stopPropagation();
                          if (!layoutStore.isPremium && layoutStore.profiles.length >= 2) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setLayoutStore("paywallAnchor", {
                              top: rect.top,
                              left: rect.left,
                              width: rect.width,
                              height: rect.height
                            });
                            setLayoutStore("paywallReason", "profile");
                            setLayoutStore("showPaywall", true);
                            return;
                          }
                          setEditingProfileId(null);
                          setIsCreatingProfile(true);
                        };
                        return _el$35;
                      })()];
                    }
                  }));
                  return _el$29;
                }
              }), null);
              return _el$27;
            })(), _tmpl$2$a(), (() => {
              var _el$38 = _tmpl$0$7();
              _el$38.$$click = (e) => {
                e.stopPropagation();
                props.onClose(props.node.id);
              };
              _el$38.$$pointerdown = (e) => e.stopPropagation();
              return _el$38;
            })()];
          }
        }), null);
        createRenderEffect((_p$) => {
          var _v$ = `absolute left-1/2 -translate-x-1/2 pointer-events-none z-[90] group/island flex justify-center items-start transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]
        ${urlExpanded() ? "top-[20vh]" : "top-0 pt-2"}
      `, _v$2 = `pointer-events-auto flex items-center justify-center rounded-[24px] transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)]
          ${showSplitMenu() || showProfileMenu() || urlExpanded() ? `overflow-visible ${urlExpanded() ? "w-[640px] max-w-[90vw] h-[68px] rounded-[34px] p-2" : props.isOnlyPane ? "w-[210px] h-9 p-1" : "w-[260px] h-9 p-1"} bg-white/90 backdrop-blur-3xl ring-1 ring-black/5 ${urlExpanded() ? "shadow-[0_40px_80px_-20px_rgba(0,0,0,0.15)]" : "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.12)]"}` : `overflow-hidden w-8 h-1 bg-neutral-300 group-hover/island:h-9 group-hover/island:bg-white/90 group-hover/island:backdrop-blur-3xl group-hover/island:ring-1 group-hover/island:ring-black/5 group-hover/island:shadow-sm group-hover/island:p-1 ${props.isOnlyPane ? "group-hover/island:w-[210px]" : "group-hover/island:w-[260px]"}`}
        `, _v$3 = `flex items-center gap-0.5 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] justify-center w-full
            ${showSplitMenu() || showProfileMenu() || urlExpanded() ? "opacity-100 scale-100" : "opacity-0 scale-90 group-hover/island:opacity-100 group-hover/island:scale-100"}`, _v$4 = `flex items-center gap-0.5 shrink-0 transition-all duration-500 ${urlExpanded() ? "w-full h-full" : ""}`, _v$5 = !props.node.canGoBack && (!props.node.history || props.node.historyIndex === void 0 || props.node.historyIndex <= 0), _v$6 = !props.node.canGoForward && (!props.node.history || props.node.historyIndex === void 0 || props.node.historyIndex >= props.node.history.length - 1), _v$7 = `relative flex items-center bg-black/5 rounded-[10px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${urlExpanded() ? "flex-1 ml-1 mr-1 h-full rounded-[20px]" : "w-7 hover:w-8 hover:bg-black/10 shrink-0 ml-0.5"}`, _v$8 = `absolute left-0 top-0 bottom-0 flex items-center justify-center text-neutral-400 z-10 transition-all duration-500 ${urlExpanded() ? "w-12 pointer-events-none" : "w-7 hover:text-blue-600 cursor-pointer"}`, _v$9 = urlExpanded() ? "20" : "12", _v$0 = urlExpanded() ? "20" : "12", _v$1 = urlExpanded() ? "2" : "2.5", _v$10 = `w-full bg-transparent font-medium text-neutral-700 outline-none transition-all duration-500 ${urlExpanded() ? "h-full pl-12 pr-4 text-xl opacity-100" : "h-7 pl-7 pr-2 text-[11px] opacity-0 pointer-events-none absolute"}`;
          _v$ !== _p$.e && className(_el$2, _p$.e = _v$);
          _v$2 !== _p$.t && className(_el$3, _p$.t = _v$2);
          _v$3 !== _p$.a && className(_el$4, _p$.a = _v$3);
          _v$4 !== _p$.o && className(_el$5, _p$.o = _v$4);
          _v$5 !== _p$.i && (_el$6.disabled = _p$.i = _v$5);
          _v$6 !== _p$.n && (_el$7.disabled = _p$.n = _v$6);
          _v$7 !== _p$.s && className(_el$8, _p$.s = _v$7);
          _v$8 !== _p$.h && className(_el$9, _p$.h = _v$8);
          _v$9 !== _p$.r && setAttribute(_el$0, "width", _p$.r = _v$9);
          _v$0 !== _p$.d && setAttribute(_el$0, "height", _p$.d = _v$0);
          _v$1 !== _p$.l && setAttribute(_el$0, "stroke-width", _p$.l = _v$1);
          _v$10 !== _p$.u && className(_el$1, _p$.u = _v$10);
          return _p$;
        }, {
          e: void 0,
          t: void 0,
          a: void 0,
          o: void 0,
          i: void 0,
          n: void 0,
          s: void 0,
          h: void 0,
          r: void 0,
          d: void 0,
          l: void 0,
          u: void 0
        });
        createRenderEffect(() => _el$1.value = props.node.url || "");
        return _el$2;
      })()];
    }
  });
}
delegateEvents(["pointerdown", "click", "keydown"]);
var _tmpl$$c = /* @__PURE__ */ template(`<div><div>`), _tmpl$2$9 = /* @__PURE__ */ template(`<div class="flex-1 bg-black/[0.03] border-2 border-dashed border-neutral-300/50 rounded-xl m-1 pointer-events-none animate-in fade-in zoom-in-[0.98] duration-300 shadow-[inset_0_4px_20px_rgba(0,0,0,0.02)] z-0">`), _tmpl$3$9 = /* @__PURE__ */ template(`<div><div><div><div class="flex-1 relative w-full h-full bg-transparent group/pane pointer-events-none transition-all duration-300 z-10"></div></div><div class="absolute inset-0 pointer-events-none z-[80] overflow-hidden"><div class="absolute bottom-0 left-0 right-0 h-2 flex items-end justify-center group/edge pointer-events-auto z-[80]"><button class="pointer-events-auto h-1.5 w-16 hover:h-8 hover:w-32 bg-white/60 hover:bg-white backdrop-blur-md border border-neutral-200/60 text-transparent hover:text-neutral-500 rounded-t-xl transition-all duration-300 ease-out flex items-center justify-center text-xl pt-0.5 opacity-0 group-hover/edge:opacity-100 shadow-sm">+</button></div><div class="absolute left-0 top-0 bottom-0 w-2 flex items-center justify-start group/edge pointer-events-auto z-[80]"><button class="pointer-events-auto w-1.5 h-16 hover:w-8 hover:h-32 bg-white/60 hover:bg-white backdrop-blur-md border border-neutral-200/60 text-transparent hover:text-neutral-500 rounded-r-xl transition-all duration-300 ease-out flex items-center justify-center text-xl pr-0.5 opacity-0 group-hover/edge:opacity-100 shadow-sm">+</button></div><div class="absolute right-0 top-0 bottom-0 w-2 flex items-center justify-end group/edge pointer-events-auto z-[80]"><button class="pointer-events-auto w-1.5 h-16 hover:w-8 hover:h-32 bg-white/60 hover:bg-white backdrop-blur-md border border-neutral-200/60 text-transparent hover:text-neutral-500 rounded-l-xl transition-all duration-300 ease-out flex items-center justify-center text-xl pl-0.5 opacity-0 group-hover/edge:opacity-100 shadow-sm">+`), _tmpl$4$9 = /* @__PURE__ */ template(`<div class="overflow-visible min-w-[50px] min-h-[50px] pointer-events-none transition-all duration-300">`), _tmpl$5$9 = /* @__PURE__ */ template(`<div>`);
function Resizer(props) {
  const onPointerDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startRatio = props.initialRatio;
    const resizer = e.currentTarget;
    const container = resizer.parentElement;
    const rect = container.getBoundingClientRect();
    const nodeA = container.children[0];
    const nodeB = container.children[2];
    let overlay = document.getElementById("resizer-drag-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "resizer-drag-overlay";
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "9999";
      overlay.style.cursor = props.isHorizontal ? "col-resize" : "row-resize";
      document.body.appendChild(overlay);
    }
    document.body.classList.add("is-resizing");
    let rafId = null;
    const onPointerMove = (ev) => {
      let newRatio = startRatio;
      if (props.isHorizontal) {
        const delta = ev.clientX - startX;
        newRatio = startRatio + delta / rect.width;
      } else {
        const delta = ev.clientY - startY;
        newRatio = startRatio + delta / rect.height;
      }
      newRatio = Math.max(0.05, Math.min(0.95, newRatio));
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          nodeA.style.flex = `${newRatio} 1 0%`;
          nodeB.style.flex = `${1 - newRatio} 1 0%`;
          rafId = null;
        });
      }
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("mouseleave", onPointerUp);
      const overlayToRemove = document.getElementById("resizer-drag-overlay");
      if (overlayToRemove) overlayToRemove.remove();
      document.body.classList.remove("is-resizing");
      let finalRatio = startRatio;
      if (props.isHorizontal) {
        const delta = window.__lastPointerX - startX;
        finalRatio = startRatio + delta / rect.width;
      } else {
        const delta = window.__lastPointerY - startY;
        finalRatio = startRatio + delta / rect.height;
      }
      finalRatio = Math.max(0.05, Math.min(0.95, finalRatio));
      props.onRatioChange(finalRatio);
    };
    const trackPos = (ev) => {
      window.__lastPointerX = ev.clientX;
      window.__lastPointerY = ev.clientY;
    };
    window.addEventListener("pointermove", trackPos);
    window.addEventListener("pointermove", onPointerMove);
    const cleanupPos = () => window.removeEventListener("pointermove", trackPos);
    window.addEventListener("pointerup", cleanupPos);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cleanupPos);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("mouseleave", cleanupPos);
    window.addEventListener("mouseleave", onPointerUp);
  };
  return (() => {
    var _el$ = _tmpl$$c(), _el$2 = _el$.firstChild;
    _el$.$$pointerdown = onPointerDown;
    createRenderEffect((_p$) => {
      var _v$ = `relative flex items-center justify-center bg-transparent z-20 group pointer-events-auto shrink-0 ${props.isHorizontal ? "w-2 cursor-col-resize -mx-1" : "h-2 cursor-row-resize -my-1"}`, _v$2 = `bg-transparent group-hover:bg-blue-500 group-active:bg-blue-600 transition-colors ${props.isHorizontal ? "w-[2px] h-full" : "h-[2px] w-full"}`;
      _v$ !== _p$.e && className(_el$, _p$.e = _v$);
      _v$2 !== _p$.t && className(_el$2, _p$.t = _v$2);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
createSignal("right");
function PaneNode(props) {
  const isTarget = () => props.dragTarget?.id === props.node.id;
  const isDraggingThis = () => props.activeDragId === props.node.id;
  const profileColor = () => layoutStore.profiles.find((p) => p.id === (props.node.profileId || "main"))?.color || "#3b82f6";
  onMount(() => {
    window.dispatchEvent(new CustomEvent("pane-target-mounted", {
      detail: props.node.id
    }));
  });
  return (() => {
    var _el$3 = _tmpl$3$9(), _el$4 = _el$3.firstChild, _el$5 = _el$4.firstChild, _el$7 = _el$5.firstChild, _el$9 = _el$5.nextSibling, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$0.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$10.nextSibling, _el$13 = _el$12.firstChild;
    _el$3.$$click = () => props.onActivePaneChange(props.node.id);
    insert(_el$5, createComponent(Show, {
      get when() {
        return memo(() => !!isTarget())() && (props.dragTarget?.direction === "left" || props.dragTarget?.direction === "top");
      },
      get children() {
        return _tmpl$2$9();
      }
    }), _el$7);
    insert(_el$5, createComponent(Show, {
      get when() {
        return memo(() => !!isTarget())() && (props.dragTarget?.direction === "right" || props.dragTarget?.direction === "bottom");
      },
      get children() {
        return _tmpl$2$9();
      }
    }), null);
    _el$1.$$click = (e) => {
      e.stopPropagation();
      props.onSplit(props.node.id, "bottom");
    };
    _el$11.$$click = (e) => {
      e.stopPropagation();
      props.onSplit(props.node.id, "left");
    };
    _el$13.$$click = (e) => {
      e.stopPropagation();
      props.onSplit(props.node.id, "right");
    };
    insert(_el$4, createComponent(PaneIsland, {
      get node() {
        return props.node;
      },
      get isOnlyPane() {
        return props.isOnlyPane;
      },
      get onSplit() {
        return props.onSplit;
      },
      get onClose() {
        return props.onClose;
      },
      get onUpdatePane() {
        return props.onUpdatePane;
      },
      isDraggingThis
    }), null);
    createRenderEffect((_p$) => {
      var _v$3 = `w-full h-full relative p-1.5 group/pane-container pointer-events-none ${props.activePaneId === props.node.id ? "z-20" : "z-10"}`, _v$4 = props.node.id, _v$5 = `w-full h-full relative overflow-visible flex flex-col pointer-events-none transition-all duration-300 ${!layoutStore.maximizedPaneId && props.activePaneId === props.node.id && !props.isOnlyPane && !window.IS_WEB_DEMO ? "ring-2 rounded-[12px]" : "ring-1 ring-transparent"} ${isDraggingThis() || layoutStore.maximizedPaneId ? "opacity-0" : ""}`, _v$6 = !layoutStore.maximizedPaneId && props.activePaneId === props.node.id && !props.isOnlyPane && !window.IS_WEB_DEMO ? {
        "--tw-ring-color": `${profileColor()}66`
      } : {}, _v$7 = `flex-1 w-full h-full flex transition-all duration-300 relative ${isTarget() && (props.dragTarget?.direction === "left" || props.dragTarget?.direction === "right") ? "flex-row" : "flex-col"}`, _v$8 = `pane-container-${props.node.id}`;
      _v$3 !== _p$.e && className(_el$3, _p$.e = _v$3);
      _v$4 !== _p$.t && setAttribute(_el$3, "data-pane-id", _p$.t = _v$4);
      _v$5 !== _p$.a && className(_el$4, _p$.a = _v$5);
      _p$.o = style(_el$4, _v$6, _p$.o);
      _v$7 !== _p$.i && className(_el$5, _p$.i = _v$7);
      _v$8 !== _p$.n && setAttribute(_el$7, "id", _p$.n = _v$8);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0,
      n: void 0
    });
    return _el$3;
  })();
}
function LayoutNode(props) {
  const node = () => layoutStore.nodes[props.nodeId];
  return createComponent(Show, {
    get when() {
      return node()?.type === "split";
    },
    get fallback() {
      return createComponent(Show, {
        get when() {
          return node()?.type === "pane";
        },
        get children() {
          return createComponent(PaneNode, mergeProps(props, {
            get node() {
              return node();
            }
          }));
        }
      });
    },
    get children() {
      var _el$14 = _tmpl$5$9();
      insert(_el$14, createComponent(Show, {
        get when() {
          return props.activeDragId !== node().a;
        },
        get children() {
          var _el$15 = _tmpl$4$9();
          insert(_el$15, createComponent(LayoutNode, mergeProps(props, {
            get nodeId() {
              return node().a;
            }
          })));
          createRenderEffect((_$p) => setStyleProperty(_el$15, "flex", props.activeDragId === node().b ? 1 : node().ratio));
          return _el$15;
        }
      }), null);
      insert(_el$14, createComponent(Show, {
        get when() {
          return memo(() => props.activeDragId !== node().a)() && props.activeDragId !== node().b;
        },
        get children() {
          return createComponent(Resizer, {
            get isHorizontal() {
              return node().direction === "horizontal";
            },
            onRatioChange: (newRatio) => props.onRatioChange(node().id, newRatio),
            get initialRatio() {
              return node().ratio;
            }
          });
        }
      }), null);
      insert(_el$14, createComponent(Show, {
        get when() {
          return props.activeDragId !== node().b;
        },
        get children() {
          var _el$16 = _tmpl$4$9();
          insert(_el$16, createComponent(LayoutNode, mergeProps(props, {
            get nodeId() {
              return node().b;
            }
          })));
          createRenderEffect((_$p) => setStyleProperty(_el$16, "flex", props.activeDragId === node().a ? 1 : 1 - node().ratio));
          return _el$16;
        }
      }), null);
      createRenderEffect(() => className(_el$14, `w-full h-full flex ${node()?.type === "split" && node().direction === "horizontal" ? "flex-row" : "flex-col"} overflow-visible pointer-events-none`));
      return _el$14;
    }
  });
}
delegateEvents(["pointerdown", "click"]);
var _tmpl$$b = /* @__PURE__ */ template(`<div><div>`);
function AbsolutePane(props) {
  let paneRef;
  const [style$1, setStyle] = createSignal({
    transform: "translate3d(0,0,0)",
    width: "0px",
    height: "0px",
    opacity: "0"
  });
  onMount(() => {
    let ro = null;
    const attachObserver = () => {
      if (ro) {
        ro.disconnect();
        ro = null;
      }
      const target = document.getElementById(props.targetId);
      if (!target) {
        setStyle((s) => ({
          ...s,
          opacity: "0"
        }));
        if (props.paneId) {
          window.api?.viewSetBounds?.(props.paneId, {
            x: -1e4,
            y: -1e4,
            width: 0,
            height: 0
          });
        }
        return;
      }
      let sizeRaf = null;
      let lastBounds = {
        x: -1,
        y: -1,
        width: -1,
        height: -1
      };
      const updatePosition = () => {
        if (props.isDragging) return;
        const rect = target.getBoundingClientRect();
        let offsetX = 0;
        let offsetY = 0;
        let scaleX = 1;
        let scaleY = 1;
        const container = document.getElementById("main-canvas");
        if (container) {
          const containerRect = container.getBoundingClientRect();
          offsetX = containerRect.left;
          offsetY = containerRect.top;
          if (container.offsetWidth > 0) {
            scaleX = containerRect.width / container.offsetWidth;
          }
          if (container.offsetHeight > 0) {
            scaleY = containerRect.height / container.offsetHeight;
          }
        }
        const isMaximized = layoutStore.maximizedPaneId === props.paneId;
        let relX = (rect.left - offsetX) / scaleX;
        let relY = (rect.top - offsetY) / scaleY;
        let finalWidth = rect.width / scaleX;
        let finalHeight = rect.height / scaleY;
        if (isMaximized && container) {
          const padding = 12;
          relX = padding;
          relY = padding;
          finalWidth = container.offsetWidth - padding * 2;
          finalHeight = container.offsetHeight - padding * 2;
        }
        if (rect.width === 0 && rect.height === 0 || layoutStore.maximizedPaneId && !isMaximized) {
          if (paneRef) {
            paneRef.style.opacity = "0";
            paneRef.style.pointerEvents = "none";
          } else {
            setStyle({
              transform: `translate3d(${relX}px, ${relY}px, 0)`,
              width: "0px",
              height: "0px",
              opacity: "0"
            });
          }
          if (props.paneId) {
            window.api?.viewSetBounds?.(props.paneId, {
              x: -1e4,
              y: -1e4,
              width: 0,
              height: 0
            });
          }
          return;
        }
        if (paneRef) {
          paneRef.style.transform = `translate3d(${relX}px, ${relY}px, 0)`;
          paneRef.style.width = `${finalWidth}px`;
          paneRef.style.height = `${finalHeight}px`;
          paneRef.style.opacity = "1";
          paneRef.style.pointerEvents = "auto";
        } else {
          setStyle({
            transform: `translate3d(${relX}px, ${relY}px, 0)`,
            width: `${finalWidth}px`,
            height: `${finalHeight}px`,
            opacity: "1"
          });
        }
        if (props.paneId) {
          const padding = 12;
          const newX = isMaximized && container ? Math.round(container.getBoundingClientRect().left) + padding : Math.round(rect.left);
          const newY = isMaximized && container ? Math.round(container.getBoundingClientRect().top) + padding : Math.round(rect.top);
          const newW = isMaximized && container ? Math.round(container.getBoundingClientRect().width) - padding * 2 : Math.round(rect.width);
          const newH = isMaximized && container ? Math.round(container.getBoundingClientRect().height) - padding * 2 : Math.round(rect.height);
          if (Math.abs(lastBounds.x - newX) > 0.5 || Math.abs(lastBounds.y - newY) > 0.5 || Math.abs(lastBounds.width - newW) > 0.5 || Math.abs(lastBounds.height - newH) > 0.5) {
            lastBounds = {
              x: newX,
              y: newY,
              width: newW,
              height: newH
            };
            if (sizeRaf) cancelAnimationFrame(sizeRaf);
            sizeRaf = window.requestAnimationFrame(() => {
              window.api?.viewSetBounds?.(props.paneId, lastBounds);
            });
          }
        }
      };
      updatePosition();
      ro = new ResizeObserver(() => {
        updatePosition();
      });
      ro.observe(target);
      window.addEventListener("resize", updatePosition);
      createEffect(() => {
        layoutStore.maximizedPaneId;
        setTimeout(updatePosition, 10);
      });
    };
    attachObserver();
    const onTargetMounted = (e) => {
      if (`pane-container-${e.detail}` === props.targetId) {
        attachObserver();
      }
    };
    const onDragEnd = () => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("pane-target-mounted", {
          detail: props.paneId
        }));
      }, 50);
    };
    window.addEventListener("pane-target-mounted", onTargetMounted);
    window.addEventListener("app:dragend", onDragEnd);
    window.addEventListener("pointerup", onDragEnd);
    createEffect(() => {
      if (layoutStore.maximizedPaneId) {
        if (ro) attachObserver();
      } else {
        if (ro) attachObserver();
      }
    });
    onCleanup(() => {
      window.removeEventListener("pane-target-mounted", onTargetMounted);
      window.removeEventListener("app:dragend", onDragEnd);
      window.removeEventListener("pointerup", onDragEnd);
      window.removeEventListener("resize", attachObserver);
      if (ro) ro.disconnect();
      if (props.paneId) {
        window.api?.viewSetBounds?.(props.paneId, {
          x: -1e4,
          y: -1e4,
          width: 0,
          height: 0
        });
      }
    });
  });
  createEffect(() => {
    if (paneRef) {
      paneRef.style.pointerEvents = props.isGlobalDragging ? "none" : "auto";
    }
  });
  return (() => {
    var _el$ = _tmpl$$b(), _el$2 = _el$.firstChild;
    var _ref$ = paneRef;
    typeof _ref$ === "function" ? use(_ref$, _el$) : paneRef = _el$;
    insert(_el$2, () => props.children);
    createRenderEffect((_p$) => {
      var _v$ = `absolute top-0 left-0 z-0 absolute-pane-container overflow-hidden p-0 bg-transparent rounded-[12px] ${props.isGlobalDragging ? "pointer-events-none" : "pointer-events-auto"} ${props.isDragging ? "transition-transform duration-75" : "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"}`, _v$2 = layoutStore.maximizedPaneId === props.paneId ? {
        ...style$1(),
        "z-index": 9990,
        opacity: "1"
      } : {
        ...style$1(),
        "transform-origin": "center",
        "z-index": props.isDragging ? 9999 : 0,
        "box-shadow": props.isDragging ? "0 25px 50px -12px rgba(0, 0, 0, 0.5)" : "",
        opacity: props.isDragging ? "0.85" : "1",
        filter: props.isDragging ? "blur(0.5px)" : "none"
      }, _v$3 = props.targetId, _v$4 = `w-full h-full bg-transparent rounded-[12px] border border-neutral-200/50 dark:border-neutral-800 shadow-[0_2px_8px_rgba(0,0,0,0.04)] overflow-hidden relative z-50 ${layoutStore.maximizedPaneId === props.paneId ? "shadow-[0_0_0_100vw_#E5E5E5] dark:shadow-[0_0_0_100vw_#121212]" : ""} ${layoutStore.maximizedPaneId && layoutStore.maximizedPaneId !== props.paneId ? "opacity-0 pointer-events-none" : ""}`;
      _v$ !== _p$.e && className(_el$, _p$.e = _v$);
      _p$.t = style(_el$, _v$2, _p$.t);
      _v$3 !== _p$.a && setAttribute(_el$, "data-target-id", _p$.a = _v$3);
      _v$4 !== _p$.o && className(_el$2, _p$.o = _v$4);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0
    });
    return _el$;
  })();
}
function _assertThisInitialized(self) {
  if (self === void 0) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }
  return self;
}
function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  subClass.__proto__ = superClass;
}
/*!
 * GSAP 3.15.0
 * https://gsap.com
 *
 * @license Copyright 2008-2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license
 * @author: Jack Doyle, jack@greensock.com
*/
var _config = {
  autoSleep: 120,
  force3D: "auto",
  nullTargetWarn: 1,
  units: {
    lineHeight: ""
  }
}, _defaults = {
  duration: 0.5,
  overwrite: false,
  delay: 0
}, _suppressOverwrites, _reverting$1, _context, _bigNum$1 = 1e8, _tinyNum = 1 / _bigNum$1, _2PI = Math.PI * 2, _HALF_PI = _2PI / 4, _gsID = 0, _sqrt = Math.sqrt, _cos = Math.cos, _sin = Math.sin, _isString = function _isString2(value) {
  return typeof value === "string";
}, _isFunction = function _isFunction2(value) {
  return typeof value === "function";
}, _isNumber = function _isNumber2(value) {
  return typeof value === "number";
}, _isUndefined = function _isUndefined2(value) {
  return typeof value === "undefined";
}, _isObject = function _isObject2(value) {
  return typeof value === "object";
}, _isNotFalse = function _isNotFalse2(value) {
  return value !== false;
}, _windowExists$1 = function _windowExists() {
  return typeof window !== "undefined";
}, _isFuncOrString = function _isFuncOrString2(value) {
  return _isFunction(value) || _isString(value);
}, _isTypedArray = typeof ArrayBuffer === "function" && ArrayBuffer.isView || function() {
}, _isArray = Array.isArray, _randomExp = /random\([^)]+\)/g, _commaDelimExp = /,\s*/g, _strictNumExp = /(?:-?\.?\d|\.)+/gi, _numExp = /[-+=.]*\d+[.e\-+]*\d*[e\-+]*\d*/g, _numWithUnitExp = /[-+=.]*\d+[.e-]*\d*[a-z%]*/g, _complexStringNumExp = /[-+=.]*\d+\.?\d*(?:e-|e\+)?\d*/gi, _relExp = /[+-]=-?[.\d]+/, _delimitedValueExp = /[^,'"\[\]\s]+/gi, _unitExp = /^[+\-=e\s\d]*\d+[.\d]*([a-z]*|%)\s*$/i, _globalTimeline, _win$2, _coreInitted, _doc$2, _globals = {}, _installScope = {}, _coreReady, _install = function _install2(scope) {
  return (_installScope = _merge(scope, _globals)) && gsap$1;
}, _missingPlugin = function _missingPlugin2(property, value) {
  return console.warn("Invalid property", property, "set to", value, "Missing plugin? gsap.registerPlugin()");
}, _warn = function _warn2(message, suppress) {
  return !suppress && console.warn(message);
}, _addGlobal = function _addGlobal2(name, obj) {
  return name && (_globals[name] = obj) && _installScope && (_installScope[name] = obj) || _globals;
}, _emptyFunc = function _emptyFunc2() {
  return 0;
}, _startAtRevertConfig = {
  suppressEvents: true,
  isStart: true,
  kill: false
}, _revertConfigNoKill = {
  suppressEvents: true,
  kill: false
}, _revertConfig = {
  suppressEvents: true
}, _reservedProps = {}, _lazyTweens = [], _lazyLookup = {}, _lastRenderedFrame, _plugins = {}, _effects = {}, _nextGCFrame = 30, _harnessPlugins = [], _callbackNames = "", _harness = function _harness2(targets) {
  var target = targets[0], harnessPlugin, i;
  _isObject(target) || _isFunction(target) || (targets = [targets]);
  if (!(harnessPlugin = (target._gsap || {}).harness)) {
    i = _harnessPlugins.length;
    while (i-- && !_harnessPlugins[i].targetTest(target)) {
    }
    harnessPlugin = _harnessPlugins[i];
  }
  i = targets.length;
  while (i--) {
    targets[i] && (targets[i]._gsap || (targets[i]._gsap = new GSCache(targets[i], harnessPlugin))) || targets.splice(i, 1);
  }
  return targets;
}, _getCache = function _getCache2(target) {
  return target._gsap || _harness(toArray(target))[0]._gsap;
}, _getProperty = function _getProperty2(target, property, v) {
  return (v = target[property]) && _isFunction(v) ? target[property]() : _isUndefined(v) && target.getAttribute && target.getAttribute(property) || v;
}, _forEachName = function _forEachName2(names, func) {
  return (names = names.split(",")).forEach(func) || names;
}, _round$1 = function _round(value) {
  return Math.round(value * 1e5) / 1e5 || 0;
}, _roundPrecise = function _roundPrecise2(value) {
  return Math.round(value * 1e7) / 1e7 || 0;
}, _parseRelative = function _parseRelative2(start, value) {
  var operator = value.charAt(0), end = parseFloat(value.substr(2));
  start = parseFloat(start);
  return operator === "+" ? start + end : operator === "-" ? start - end : operator === "*" ? start * end : start / end;
}, _arrayContainsAny = function _arrayContainsAny2(toSearch, toFind) {
  var l = toFind.length, i = 0;
  for (; toSearch.indexOf(toFind[i]) < 0 && ++i < l; ) {
  }
  return i < l;
}, _lazyRender = function _lazyRender2() {
  var l = _lazyTweens.length, a = _lazyTweens.slice(0), i, tween;
  _lazyLookup = {};
  _lazyTweens.length = 0;
  for (i = 0; i < l; i++) {
    tween = a[i];
    tween && tween._lazy && (tween.render(tween._lazy[0], tween._lazy[1], true)._lazy = 0);
  }
}, _isRevertWorthy = function _isRevertWorthy2(animation) {
  return !!(animation._initted || animation._startAt || animation.add);
}, _lazySafeRender = function _lazySafeRender2(animation, time, suppressEvents, force) {
  _lazyTweens.length && !_reverting$1 && _lazyRender();
  animation.render(time, suppressEvents, !!(_reverting$1 && time < 0 && _isRevertWorthy(animation)));
  _lazyTweens.length && !_reverting$1 && _lazyRender();
}, _numericIfPossible = function _numericIfPossible2(value) {
  var n = parseFloat(value);
  return (n || n === 0) && (value + "").match(_delimitedValueExp).length < 2 ? n : _isString(value) ? value.trim() : value;
}, _passThrough = function _passThrough2(p) {
  return p;
}, _setDefaults = function _setDefaults2(obj, defaults2) {
  for (var p in defaults2) {
    p in obj || (obj[p] = defaults2[p]);
  }
  return obj;
}, _setKeyframeDefaults = function _setKeyframeDefaults2(excludeDuration) {
  return function(obj, defaults2) {
    for (var p in defaults2) {
      p in obj || p === "duration" && excludeDuration || p === "ease" || (obj[p] = defaults2[p]);
    }
  };
}, _merge = function _merge2(base, toMerge) {
  for (var p in toMerge) {
    base[p] = toMerge[p];
  }
  return base;
}, _mergeDeep = function _mergeDeep2(base, toMerge) {
  for (var p in toMerge) {
    p !== "__proto__" && p !== "constructor" && p !== "prototype" && (base[p] = _isObject(toMerge[p]) ? _mergeDeep2(base[p] || (base[p] = {}), toMerge[p]) : toMerge[p]);
  }
  return base;
}, _copyExcluding = function _copyExcluding2(obj, excluding) {
  var copy = {}, p;
  for (p in obj) {
    p in excluding || (copy[p] = obj[p]);
  }
  return copy;
}, _inheritDefaults = function _inheritDefaults2(vars) {
  var parent = vars.parent || _globalTimeline, func = vars.keyframes ? _setKeyframeDefaults(_isArray(vars.keyframes)) : _setDefaults;
  if (_isNotFalse(vars.inherit)) {
    while (parent) {
      func(vars, parent.vars.defaults);
      parent = parent.parent || parent._dp;
    }
  }
  return vars;
}, _arraysMatch = function _arraysMatch2(a1, a2) {
  var i = a1.length, match = i === a2.length;
  while (match && i-- && a1[i] === a2[i]) {
  }
  return i < 0;
}, _addLinkedListItem = function _addLinkedListItem2(parent, child, firstProp, lastProp, sortBy) {
  var prev = parent[lastProp], t;
  if (sortBy) {
    t = child[sortBy];
    while (prev && prev[sortBy] > t) {
      prev = prev._prev;
    }
  }
  if (prev) {
    child._next = prev._next;
    prev._next = child;
  } else {
    child._next = parent[firstProp];
    parent[firstProp] = child;
  }
  if (child._next) {
    child._next._prev = child;
  } else {
    parent[lastProp] = child;
  }
  child._prev = prev;
  child.parent = child._dp = parent;
  return child;
}, _removeLinkedListItem = function _removeLinkedListItem2(parent, child, firstProp, lastProp) {
  if (firstProp === void 0) {
    firstProp = "_first";
  }
  if (lastProp === void 0) {
    lastProp = "_last";
  }
  var prev = child._prev, next = child._next;
  if (prev) {
    prev._next = next;
  } else if (parent[firstProp] === child) {
    parent[firstProp] = next;
  }
  if (next) {
    next._prev = prev;
  } else if (parent[lastProp] === child) {
    parent[lastProp] = prev;
  }
  child._next = child._prev = child.parent = null;
}, _removeFromParent = function _removeFromParent2(child, onlyIfParentHasAutoRemove) {
  child.parent && (!onlyIfParentHasAutoRemove || child.parent.autoRemoveChildren) && child.parent.remove && child.parent.remove(child);
  child._act = 0;
}, _uncache = function _uncache2(animation, child) {
  if (animation && (!child || child._end > animation._dur || child._start < 0)) {
    var a = animation;
    while (a) {
      a._dirty = 1;
      a = a.parent;
    }
  }
  return animation;
}, _recacheAncestors = function _recacheAncestors2(animation) {
  var parent = animation.parent;
  while (parent && parent.parent) {
    parent._dirty = 1;
    parent.totalDuration();
    parent = parent.parent;
  }
  return animation;
}, _rewindStartAt = function _rewindStartAt2(tween, totalTime, suppressEvents, force) {
  return tween._startAt && (_reverting$1 ? tween._startAt.revert(_revertConfigNoKill) : tween.vars.immediateRender && !tween.vars.autoRevert || tween._startAt.render(totalTime, true, force));
}, _hasNoPausedAncestors = function _hasNoPausedAncestors2(animation) {
  return !animation || animation._ts && _hasNoPausedAncestors2(animation.parent);
}, _elapsedCycleDuration = function _elapsedCycleDuration2(animation) {
  return animation._repeat ? _animationCycle(animation._tTime, animation = animation.duration() + animation._rDelay) * animation : 0;
}, _animationCycle = function _animationCycle2(tTime, cycleDuration) {
  var whole = Math.floor(tTime = _roundPrecise(tTime / cycleDuration));
  return tTime && whole === tTime ? whole - 1 : whole;
}, _parentToChildTotalTime = function _parentToChildTotalTime2(parentTime, child) {
  return (parentTime - child._start) * child._ts + (child._ts >= 0 ? 0 : child._dirty ? child.totalDuration() : child._tDur);
}, _setEnd = function _setEnd2(animation) {
  return animation._end = _roundPrecise(animation._start + (animation._tDur / Math.abs(animation._ts || animation._rts || _tinyNum) || 0));
}, _alignPlayhead = function _alignPlayhead2(animation, totalTime) {
  var parent = animation._dp;
  if (parent && parent.smoothChildTiming && animation._ts) {
    animation._start = _roundPrecise(parent._time - (animation._ts > 0 ? totalTime / animation._ts : ((animation._dirty ? animation.totalDuration() : animation._tDur) - totalTime) / -animation._ts));
    _setEnd(animation);
    parent._dirty || _uncache(parent, animation);
  }
  return animation;
}, _postAddChecks = function _postAddChecks2(timeline2, child) {
  var t;
  if (child._time || !child._dur && child._initted || child._start < timeline2._time && (child._dur || !child.add)) {
    t = _parentToChildTotalTime(timeline2.rawTime(), child);
    if (!child._dur || _clamp(0, child.totalDuration(), t) - child._tTime > _tinyNum) {
      child.render(t, true);
    }
  }
  if (_uncache(timeline2, child)._dp && timeline2._initted && timeline2._time >= timeline2._dur && timeline2._ts) {
    if (timeline2._dur < timeline2.duration()) {
      t = timeline2;
      while (t._dp) {
        t.rawTime() >= 0 && t.totalTime(t._tTime);
        t = t._dp;
      }
    }
    timeline2._zTime = -_tinyNum;
  }
}, _addToTimeline = function _addToTimeline2(timeline2, child, position, skipChecks) {
  child.parent && _removeFromParent(child);
  child._start = _roundPrecise((_isNumber(position) ? position : position || timeline2 !== _globalTimeline ? _parsePosition(timeline2, position, child) : timeline2._time) + child._delay);
  child._end = _roundPrecise(child._start + (child.totalDuration() / Math.abs(child.timeScale()) || 0));
  _addLinkedListItem(timeline2, child, "_first", "_last", timeline2._sort ? "_start" : 0);
  _isFromOrFromStart(child) || (timeline2._recent = child);
  skipChecks || _postAddChecks(timeline2, child);
  timeline2._ts < 0 && _alignPlayhead(timeline2, timeline2._tTime);
  return timeline2;
}, _scrollTrigger = function _scrollTrigger2(animation, trigger) {
  return (_globals.ScrollTrigger || _missingPlugin("scrollTrigger", trigger)) && _globals.ScrollTrigger.create(trigger, animation);
}, _attemptInitTween = function _attemptInitTween2(tween, time, force, suppressEvents, tTime) {
  _initTween(tween, time, tTime);
  if (!tween._initted) {
    return 1;
  }
  if (!force && tween._pt && !_reverting$1 && (tween._dur && tween.vars.lazy !== false || !tween._dur && tween.vars.lazy) && _lastRenderedFrame !== _ticker.frame) {
    _lazyTweens.push(tween);
    tween._lazy = [tTime, suppressEvents];
    return 1;
  }
}, _parentPlayheadIsBeforeStart = function _parentPlayheadIsBeforeStart2(_ref) {
  var parent = _ref.parent;
  return parent && parent._ts && parent._initted && !parent._lock && (parent.rawTime() < 0 || _parentPlayheadIsBeforeStart2(parent));
}, _isFromOrFromStart = function _isFromOrFromStart2(_ref2) {
  var data = _ref2.data;
  return data === "isFromStart" || data === "isStart";
}, _renderZeroDurationTween = function _renderZeroDurationTween2(tween, totalTime, suppressEvents, force) {
  var prevRatio = tween.ratio, ratio = totalTime < 0 || !totalTime && (!tween._start && _parentPlayheadIsBeforeStart(tween) && !(!tween._initted && _isFromOrFromStart(tween)) || (tween._ts < 0 || tween._dp._ts < 0) && !_isFromOrFromStart(tween)) ? 0 : 1, repeatDelay = tween._rDelay, tTime = 0, pt, iteration, prevIteration;
  if (repeatDelay && tween._repeat) {
    tTime = _clamp(0, tween._tDur, totalTime);
    iteration = _animationCycle(tTime, repeatDelay);
    tween._yoyo && iteration & 1 && (ratio = 1 - ratio);
    if (iteration !== _animationCycle(tween._tTime, repeatDelay)) {
      prevRatio = 1 - ratio;
      tween.vars.repeatRefresh && tween._initted && tween.invalidate();
    }
  }
  if (ratio !== prevRatio || _reverting$1 || force || tween._zTime === _tinyNum || !totalTime && tween._zTime) {
    if (!tween._initted && _attemptInitTween(tween, totalTime, force, suppressEvents, tTime)) {
      return;
    }
    prevIteration = tween._zTime;
    tween._zTime = totalTime || (suppressEvents ? _tinyNum : 0);
    suppressEvents || (suppressEvents = totalTime && !prevIteration);
    tween.ratio = ratio;
    tween._from && (ratio = 1 - ratio);
    tween._time = 0;
    tween._tTime = tTime;
    pt = tween._pt;
    while (pt) {
      pt.r(ratio, pt.d);
      pt = pt._next;
    }
    totalTime < 0 && _rewindStartAt(tween, totalTime, suppressEvents, true);
    tween._onUpdate && !suppressEvents && _callback(tween, "onUpdate");
    tTime && tween._repeat && !suppressEvents && tween.parent && _callback(tween, "onRepeat");
    if ((totalTime >= tween._tDur || totalTime < 0) && tween.ratio === ratio) {
      ratio && _removeFromParent(tween, 1);
      if (!suppressEvents && !_reverting$1) {
        _callback(tween, ratio ? "onComplete" : "onReverseComplete", true);
        tween._prom && tween._prom();
      }
    }
  } else if (!tween._zTime) {
    tween._zTime = totalTime;
  }
}, _findNextPauseTween = function _findNextPauseTween2(animation, prevTime, time) {
  var child;
  if (time > prevTime) {
    child = animation._first;
    while (child && child._start <= time) {
      if (child.data === "isPause" && child._start > prevTime) {
        return child;
      }
      child = child._next;
    }
  } else {
    child = animation._last;
    while (child && child._start >= time) {
      if (child.data === "isPause" && child._start < prevTime) {
        return child;
      }
      child = child._prev;
    }
  }
}, _setDuration = function _setDuration2(animation, duration, skipUncache, leavePlayhead) {
  var repeat = animation._repeat, dur = _roundPrecise(duration) || 0, totalProgress = animation._tTime / animation._tDur;
  totalProgress && !leavePlayhead && (animation._time *= dur / animation._dur);
  animation._dur = dur;
  animation._tDur = !repeat ? dur : repeat < 0 ? 1e10 : _roundPrecise(dur * (repeat + 1) + animation._rDelay * repeat);
  totalProgress > 0 && !leavePlayhead && _alignPlayhead(animation, animation._tTime = animation._tDur * totalProgress);
  animation.parent && _setEnd(animation);
  skipUncache || _uncache(animation.parent, animation);
  return animation;
}, _onUpdateTotalDuration = function _onUpdateTotalDuration2(animation) {
  return animation instanceof Timeline ? _uncache(animation) : _setDuration(animation, animation._dur);
}, _zeroPosition = {
  _start: 0,
  endTime: _emptyFunc,
  totalDuration: _emptyFunc
}, _parsePosition = function _parsePosition2(animation, position, percentAnimation) {
  var labels = animation.labels, recent = animation._recent || _zeroPosition, clippedDuration = animation.duration() >= _bigNum$1 ? recent.endTime(false) : animation._dur, i, offset, isPercent;
  if (_isString(position) && (isNaN(position) || position in labels)) {
    offset = position.charAt(0);
    isPercent = position.substr(-1) === "%";
    i = position.indexOf("=");
    if (offset === "<" || offset === ">") {
      i >= 0 && (position = position.replace(/=/, ""));
      return (offset === "<" ? recent._start : recent.endTime(recent._repeat >= 0)) + (parseFloat(position.substr(1)) || 0) * (isPercent ? (i < 0 ? recent : percentAnimation).totalDuration() / 100 : 1);
    }
    if (i < 0) {
      position in labels || (labels[position] = clippedDuration);
      return labels[position];
    }
    offset = parseFloat(position.charAt(i - 1) + position.substr(i + 1));
    if (isPercent && percentAnimation) {
      offset = offset / 100 * (_isArray(percentAnimation) ? percentAnimation[0] : percentAnimation).totalDuration();
    }
    return i > 1 ? _parsePosition2(animation, position.substr(0, i - 1), percentAnimation) + offset : clippedDuration + offset;
  }
  return position == null ? clippedDuration : +position;
}, _createTweenType = function _createTweenType2(type, params, timeline2) {
  var isLegacy = _isNumber(params[1]), varsIndex = (isLegacy ? 2 : 1) + (type < 2 ? 0 : 1), vars = params[varsIndex], irVars, parent;
  isLegacy && (vars.duration = params[1]);
  vars.parent = timeline2;
  if (type) {
    irVars = vars;
    parent = timeline2;
    while (parent && !("immediateRender" in irVars)) {
      irVars = parent.vars.defaults || {};
      parent = _isNotFalse(parent.vars.inherit) && parent.parent;
    }
    vars.immediateRender = _isNotFalse(irVars.immediateRender);
    type < 2 ? vars.runBackwards = 1 : vars.startAt = params[varsIndex - 1];
  }
  return new Tween(params[0], vars, params[varsIndex + 1]);
}, _conditionalReturn = function _conditionalReturn2(value, func) {
  return value || value === 0 ? func(value) : func;
}, _clamp = function _clamp2(min, max, value) {
  return value < min ? min : value > max ? max : value;
}, getUnit = function getUnit2(value, v) {
  return !_isString(value) || !(v = _unitExp.exec(value)) ? "" : v[1];
}, clamp = function clamp2(min, max, value) {
  return _conditionalReturn(value, function(v) {
    return _clamp(min, max, v);
  });
}, _slice = [].slice, _isArrayLike = function _isArrayLike2(value, nonEmpty) {
  return value && _isObject(value) && "length" in value && (!nonEmpty && !value.length || value.length - 1 in value && _isObject(value[0])) && !value.nodeType && value !== _win$2;
}, _flatten = function _flatten2(ar, leaveStrings, accumulator) {
  if (accumulator === void 0) {
    accumulator = [];
  }
  return ar.forEach(function(value) {
    var _accumulator;
    return _isString(value) && !leaveStrings || _isArrayLike(value, 1) ? (_accumulator = accumulator).push.apply(_accumulator, toArray(value)) : accumulator.push(value);
  }) || accumulator;
}, toArray = function toArray2(value, scope, leaveStrings) {
  return _context && !scope && _context.selector ? _context.selector(value) : _isString(value) && !leaveStrings && (_coreInitted || !_wake()) ? _slice.call((scope || _doc$2).querySelectorAll(value), 0) : _isArray(value) ? _flatten(value, leaveStrings) : _isArrayLike(value) ? _slice.call(value, 0) : value ? [value] : [];
}, selector = function selector2(value) {
  value = toArray(value)[0] || _warn("Invalid scope") || {};
  return function(v) {
    var el = value.current || value.nativeElement || value;
    return toArray(v, el.querySelectorAll ? el : el === value ? _warn("Invalid scope") || _doc$2.createElement("div") : value);
  };
}, shuffle = function shuffle2(a) {
  return a.sort(function() {
    return 0.5 - Math.random();
  });
}, distribute = function distribute2(v) {
  if (_isFunction(v)) {
    return v;
  }
  var vars = _isObject(v) ? v : {
    each: v
  }, ease = _parseEase(vars.ease), from = vars.from || 0, base = parseFloat(vars.base) || 0, cache = {}, isDecimal = from > 0 && from < 1, ratios = isNaN(from) || isDecimal, axis = vars.axis, ratioX = from, ratioY = from;
  if (_isString(from)) {
    ratioX = ratioY = {
      center: 0.5,
      edges: 0.5,
      end: 1
    }[from] || 0;
  } else if (!isDecimal && ratios) {
    ratioX = from[0];
    ratioY = from[1];
  }
  return function(i, target, a) {
    var l = (a || vars).length, distances = cache[l], originX, originY, x, y, d, j, max, min, wrapAt;
    if (!distances) {
      wrapAt = vars.grid === "auto" ? 0 : (vars.grid || [1, _bigNum$1])[1];
      if (!wrapAt) {
        max = -_bigNum$1;
        while (max < (max = a[wrapAt++].getBoundingClientRect().left) && wrapAt < l) {
        }
        wrapAt < l && wrapAt--;
      }
      distances = cache[l] = [];
      originX = ratios ? Math.min(wrapAt, l) * ratioX - 0.5 : from % wrapAt;
      originY = wrapAt === _bigNum$1 ? 0 : ratios ? l * ratioY / wrapAt - 0.5 : from / wrapAt | 0;
      max = 0;
      min = _bigNum$1;
      for (j = 0; j < l; j++) {
        x = j % wrapAt - originX;
        y = originY - (j / wrapAt | 0);
        distances[j] = d = !axis ? _sqrt(x * x + y * y) : Math.abs(axis === "y" ? y : x);
        d > max && (max = d);
        d < min && (min = d);
      }
      from === "random" && shuffle(distances);
      distances.max = max - min;
      distances.min = min;
      distances.v = l = (parseFloat(vars.amount) || parseFloat(vars.each) * (wrapAt > l ? l - 1 : !axis ? Math.max(wrapAt, l / wrapAt) : axis === "y" ? l / wrapAt : wrapAt) || 0) * (from === "edges" ? -1 : 1);
      distances.b = l < 0 ? base - l : base;
      distances.u = getUnit(vars.amount || vars.each) || 0;
      ease = ease && l < 0 ? _invertEase(ease) : ease;
    }
    l = (distances[i] - distances.min) / distances.max || 0;
    return _roundPrecise(distances.b + (ease ? ease(l) : l) * distances.v) + distances.u;
  };
}, _roundModifier = function _roundModifier2(v) {
  var p = Math.pow(10, ((v + "").split(".")[1] || "").length);
  return function(raw) {
    var n = _roundPrecise(Math.round(parseFloat(raw) / v) * v * p);
    return (n - n % 1) / p + (_isNumber(raw) ? 0 : getUnit(raw));
  };
}, snap = function snap2(snapTo, value) {
  var isArray = _isArray(snapTo), radius, is2D;
  if (!isArray && _isObject(snapTo)) {
    radius = isArray = snapTo.radius || _bigNum$1;
    if (snapTo.values) {
      snapTo = toArray(snapTo.values);
      if (is2D = !_isNumber(snapTo[0])) {
        radius *= radius;
      }
    } else {
      snapTo = _roundModifier(snapTo.increment);
    }
  }
  return _conditionalReturn(value, !isArray ? _roundModifier(snapTo) : _isFunction(snapTo) ? function(raw) {
    is2D = snapTo(raw);
    return Math.abs(is2D - raw) <= radius ? is2D : raw;
  } : function(raw) {
    var x = parseFloat(is2D ? raw.x : raw), y = parseFloat(is2D ? raw.y : 0), min = _bigNum$1, closest = 0, i = snapTo.length, dx, dy;
    while (i--) {
      if (is2D) {
        dx = snapTo[i].x - x;
        dy = snapTo[i].y - y;
        dx = dx * dx + dy * dy;
      } else {
        dx = Math.abs(snapTo[i] - x);
      }
      if (dx < min) {
        min = dx;
        closest = i;
      }
    }
    closest = !radius || min <= radius ? snapTo[closest] : raw;
    return is2D || closest === raw || _isNumber(raw) ? closest : closest + getUnit(raw);
  });
}, random = function random2(min, max, roundingIncrement, returnFunction) {
  return _conditionalReturn(_isArray(min) ? !max : roundingIncrement === true ? !!(roundingIncrement = 0) : !returnFunction, function() {
    return _isArray(min) ? min[~~(Math.random() * min.length)] : (roundingIncrement = roundingIncrement || 1e-5) && (returnFunction = roundingIncrement < 1 ? Math.pow(10, (roundingIncrement + "").length - 2) : 1) && Math.floor(Math.round((min - roundingIncrement / 2 + Math.random() * (max - min + roundingIncrement * 0.99)) / roundingIncrement) * roundingIncrement * returnFunction) / returnFunction;
  });
}, pipe = function pipe2() {
  for (var _len = arguments.length, functions = new Array(_len), _key = 0; _key < _len; _key++) {
    functions[_key] = arguments[_key];
  }
  return function(value) {
    return functions.reduce(function(v, f) {
      return f(v);
    }, value);
  };
}, unitize = function unitize2(func, unit) {
  return function(value) {
    return func(parseFloat(value)) + (unit || getUnit(value));
  };
}, normalize = function normalize2(min, max, value) {
  return mapRange(min, max, 0, 1, value);
}, _wrapArray = function _wrapArray2(a, wrapper, value) {
  return _conditionalReturn(value, function(index) {
    return a[~~wrapper(index)];
  });
}, wrap = function wrap2(min, max, value) {
  var range = max - min;
  return _isArray(min) ? _wrapArray(min, wrap2(0, min.length), max) : _conditionalReturn(value, function(value2) {
    return (range + (value2 - min) % range) % range + min;
  });
}, wrapYoyo = function wrapYoyo2(min, max, value) {
  var range = max - min, total = range * 2;
  return _isArray(min) ? _wrapArray(min, wrapYoyo2(0, min.length - 1), max) : _conditionalReturn(value, function(value2) {
    value2 = (total + (value2 - min) % total) % total || 0;
    return min + (value2 > range ? total - value2 : value2);
  });
}, _replaceRandom = function _replaceRandom2(s) {
  return s.replace(_randomExp, function(match) {
    var arIndex = match.indexOf("[") + 1, values = match.substring(arIndex || 7, arIndex ? match.indexOf("]") : match.length - 1).split(_commaDelimExp);
    return random(arIndex ? values : +values[0], arIndex ? 0 : +values[1], +values[2] || 1e-5);
  });
}, mapRange = function mapRange2(inMin, inMax, outMin, outMax, value) {
  var inRange = inMax - inMin, outRange = outMax - outMin;
  return _conditionalReturn(value, function(value2) {
    return outMin + ((value2 - inMin) / inRange * outRange || 0);
  });
}, interpolate = function interpolate2(start, end, progress, mutate) {
  var func = isNaN(start + end) ? 0 : function(p2) {
    return (1 - p2) * start + p2 * end;
  };
  if (!func) {
    var isString = _isString(start), master = {}, p, i, interpolators, l, il;
    progress === true && (mutate = 1) && (progress = null);
    if (isString) {
      start = {
        p: start
      };
      end = {
        p: end
      };
    } else if (_isArray(start) && !_isArray(end)) {
      interpolators = [];
      l = start.length;
      il = l - 2;
      for (i = 1; i < l; i++) {
        interpolators.push(interpolate2(start[i - 1], start[i]));
      }
      l--;
      func = function func2(p2) {
        p2 *= l;
        var i2 = Math.min(il, ~~p2);
        return interpolators[i2](p2 - i2);
      };
      progress = end;
    } else if (!mutate) {
      start = _merge(_isArray(start) ? [] : {}, start);
    }
    if (!interpolators) {
      for (p in end) {
        _addPropTween.call(master, start, p, "get", end[p]);
      }
      func = function func2(p2) {
        return _renderPropTweens(p2, master) || (isString ? start.p : start);
      };
    }
  }
  return _conditionalReturn(progress, func);
}, _getLabelInDirection = function _getLabelInDirection2(timeline2, fromTime, backward) {
  var labels = timeline2.labels, min = _bigNum$1, p, distance, label;
  for (p in labels) {
    distance = labels[p] - fromTime;
    if (distance < 0 === !!backward && distance && min > (distance = Math.abs(distance))) {
      label = p;
      min = distance;
    }
  }
  return label;
}, _callback = function _callback2(animation, type, executeLazyFirst) {
  var v = animation.vars, callback = v[type], prevContext = _context, context3 = animation._ctx, params, scope, result;
  if (!callback) {
    return;
  }
  params = v[type + "Params"];
  scope = v.callbackScope || animation;
  executeLazyFirst && _lazyTweens.length && _lazyRender();
  context3 && (_context = context3);
  result = params ? callback.apply(scope, params) : callback.call(scope);
  _context = prevContext;
  return result;
}, _interrupt$1 = function _interrupt(animation) {
  _removeFromParent(animation);
  animation.scrollTrigger && animation.scrollTrigger.kill(!!_reverting$1);
  animation.progress() < 1 && _callback(animation, "onInterrupt");
  return animation;
}, _quickTween, _registerPluginQueue = [], _createPlugin = function _createPlugin2(config3) {
  if (!config3) return;
  config3 = !config3.name && config3["default"] || config3;
  if (_windowExists$1() || config3.headless) {
    var name = config3.name, isFunc = _isFunction(config3), Plugin = name && !isFunc && config3.init ? function() {
      this._props = [];
    } : config3, instanceDefaults = {
      init: _emptyFunc,
      render: _renderPropTweens,
      add: _addPropTween,
      kill: _killPropTweensOf,
      modifier: _addPluginModifier,
      rawVars: 0
    }, statics = {
      targetTest: 0,
      get: 0,
      getSetter: _getSetter,
      aliases: {},
      register: 0
    };
    _wake();
    if (config3 !== Plugin) {
      if (_plugins[name]) {
        return;
      }
      _setDefaults(Plugin, _setDefaults(_copyExcluding(config3, instanceDefaults), statics));
      _merge(Plugin.prototype, _merge(instanceDefaults, _copyExcluding(config3, statics)));
      _plugins[Plugin.prop = name] = Plugin;
      if (config3.targetTest) {
        _harnessPlugins.push(Plugin);
        _reservedProps[name] = 1;
      }
      name = (name === "css" ? "CSS" : name.charAt(0).toUpperCase() + name.substr(1)) + "Plugin";
    }
    _addGlobal(name, Plugin);
    config3.register && config3.register(gsap$1, Plugin, PropTween);
  } else {
    _registerPluginQueue.push(config3);
  }
}, _255 = 255, _colorLookup = {
  aqua: [0, _255, _255],
  lime: [0, _255, 0],
  silver: [192, 192, 192],
  black: [0, 0, 0],
  maroon: [128, 0, 0],
  teal: [0, 128, 128],
  blue: [0, 0, _255],
  navy: [0, 0, 128],
  white: [_255, _255, _255],
  olive: [128, 128, 0],
  yellow: [_255, _255, 0],
  orange: [_255, 165, 0],
  gray: [128, 128, 128],
  purple: [128, 0, 128],
  green: [0, 128, 0],
  red: [_255, 0, 0],
  pink: [_255, 192, 203],
  cyan: [0, _255, _255],
  transparent: [_255, _255, _255, 0]
}, _hue = function _hue2(h, m1, m2) {
  h += h < 0 ? 1 : h > 1 ? -1 : 0;
  return (h * 6 < 1 ? m1 + (m2 - m1) * h * 6 : h < 0.5 ? m2 : h * 3 < 2 ? m1 + (m2 - m1) * (2 / 3 - h) * 6 : m1) * _255 + 0.5 | 0;
}, splitColor = function splitColor2(v, toHSL, forceAlpha) {
  var a = !v ? _colorLookup.black : _isNumber(v) ? [v >> 16, v >> 8 & _255, v & _255] : 0, r, g, b, h, s, l, max, min, d, wasHSL;
  if (!a) {
    if (v.substr(-1) === ",") {
      v = v.substr(0, v.length - 1);
    }
    if (_colorLookup[v]) {
      a = _colorLookup[v];
    } else if (v.charAt(0) === "#") {
      if (v.length < 6) {
        r = v.charAt(1);
        g = v.charAt(2);
        b = v.charAt(3);
        v = "#" + r + r + g + g + b + b + (v.length === 5 ? v.charAt(4) + v.charAt(4) : "");
      }
      if (v.length === 9) {
        a = parseInt(v.substr(1, 6), 16);
        return [a >> 16, a >> 8 & _255, a & _255, parseInt(v.substr(7), 16) / 255];
      }
      v = parseInt(v.substr(1), 16);
      a = [v >> 16, v >> 8 & _255, v & _255];
    } else if (v.substr(0, 3) === "hsl") {
      a = wasHSL = v.match(_strictNumExp);
      if (!toHSL) {
        h = +a[0] % 360 / 360;
        s = +a[1] / 100;
        l = +a[2] / 100;
        g = l <= 0.5 ? l * (s + 1) : l + s - l * s;
        r = l * 2 - g;
        a.length > 3 && (a[3] *= 1);
        a[0] = _hue(h + 1 / 3, r, g);
        a[1] = _hue(h, r, g);
        a[2] = _hue(h - 1 / 3, r, g);
      } else if (~v.indexOf("=")) {
        a = v.match(_numExp);
        forceAlpha && a.length < 4 && (a[3] = 1);
        return a;
      }
    } else {
      a = v.match(_strictNumExp) || _colorLookup.transparent;
    }
    a = a.map(Number);
  }
  if (toHSL && !wasHSL) {
    r = a[0] / _255;
    g = a[1] / _255;
    b = a[2] / _255;
    max = Math.max(r, g, b);
    min = Math.min(r, g, b);
    l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    a[0] = ~~(h + 0.5);
    a[1] = ~~(s * 100 + 0.5);
    a[2] = ~~(l * 100 + 0.5);
  }
  forceAlpha && a.length < 4 && (a[3] = 1);
  return a;
}, _colorOrderData = function _colorOrderData2(v) {
  var values = [], c = [], i = -1;
  v.split(_colorExp).forEach(function(v2) {
    var a = v2.match(_numWithUnitExp) || [];
    values.push.apply(values, a);
    c.push(i += a.length + 1);
  });
  values.c = c;
  return values;
}, _formatColors = function _formatColors2(s, toHSL, orderMatchData) {
  var result = "", colors = (s + result).match(_colorExp), type = toHSL ? "hsla(" : "rgba(", i = 0, c, shell, d, l;
  if (!colors) {
    return s;
  }
  colors = colors.map(function(color) {
    return (color = splitColor(color, toHSL, 1)) && type + (toHSL ? color[0] + "," + color[1] + "%," + color[2] + "%," + color[3] : color.join(",")) + ")";
  });
  if (orderMatchData) {
    d = _colorOrderData(s);
    c = orderMatchData.c;
    if (c.join(result) !== d.c.join(result)) {
      shell = s.replace(_colorExp, "1").split(_numWithUnitExp);
      l = shell.length - 1;
      for (; i < l; i++) {
        result += shell[i] + (~c.indexOf(i) ? colors.shift() || type + "0,0,0,0)" : (d.length ? d : colors.length ? colors : orderMatchData).shift());
      }
    }
  }
  if (!shell) {
    shell = s.split(_colorExp);
    l = shell.length - 1;
    for (; i < l; i++) {
      result += shell[i] + colors[i];
    }
  }
  return result + shell[l];
}, _colorExp = (function() {
  var s = "(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#(?:[0-9a-f]{3,4}){1,2}\\b", p;
  for (p in _colorLookup) {
    s += "|" + p + "\\b";
  }
  return new RegExp(s + ")", "gi");
})(), _hslExp = /hsl[a]?\(/, _colorStringFilter = function _colorStringFilter2(a) {
  var combined = a.join(" "), toHSL;
  _colorExp.lastIndex = 0;
  if (_colorExp.test(combined)) {
    toHSL = _hslExp.test(combined);
    a[1] = _formatColors(a[1], toHSL);
    a[0] = _formatColors(a[0], toHSL, _colorOrderData(a[1]));
    return true;
  }
}, _tickerActive, _ticker = (function() {
  var _getTime = Date.now, _lagThreshold = 500, _adjustedLag = 33, _startTime = _getTime(), _lastUpdate = _startTime, _gap = 1e3 / 240, _nextTime = _gap, _listeners2 = [], _id2, _req, _raf, _self, _delta, _i, _tick = function _tick2(v) {
    var elapsed = _getTime() - _lastUpdate, manual = v === true, overlap, dispatch, time, frame;
    (elapsed > _lagThreshold || elapsed < 0) && (_startTime += elapsed - _adjustedLag);
    _lastUpdate += elapsed;
    time = _lastUpdate - _startTime;
    overlap = time - _nextTime;
    if (overlap > 0 || manual) {
      frame = ++_self.frame;
      _delta = time - _self.time * 1e3;
      _self.time = time = time / 1e3;
      _nextTime += overlap + (overlap >= _gap ? 4 : _gap - overlap);
      dispatch = 1;
    }
    manual || (_id2 = _req(_tick2));
    if (dispatch) {
      for (_i = 0; _i < _listeners2.length; _i++) {
        _listeners2[_i](time, _delta, frame, v);
      }
    }
  };
  _self = {
    time: 0,
    frame: 0,
    tick: function tick() {
      _tick(true);
    },
    deltaRatio: function deltaRatio(fps) {
      return _delta / (1e3 / (fps || 60));
    },
    wake: function wake() {
      if (_coreReady) {
        if (!_coreInitted && _windowExists$1()) {
          _win$2 = _coreInitted = window;
          _doc$2 = _win$2.document || {};
          _globals.gsap = gsap$1;
          (_win$2.gsapVersions || (_win$2.gsapVersions = [])).push(gsap$1.version);
          _install(_installScope || _win$2.GreenSockGlobals || !_win$2.gsap && _win$2 || {});
          _registerPluginQueue.forEach(_createPlugin);
        }
        _raf = typeof requestAnimationFrame !== "undefined" && requestAnimationFrame;
        _id2 && _self.sleep();
        _req = _raf || function(f) {
          return setTimeout(f, _nextTime - _self.time * 1e3 + 1 | 0);
        };
        _tickerActive = 1;
        _tick(2);
      }
    },
    sleep: function sleep() {
      (_raf ? cancelAnimationFrame : clearTimeout)(_id2);
      _tickerActive = 0;
      _req = _emptyFunc;
    },
    lagSmoothing: function lagSmoothing(threshold, adjustedLag) {
      _lagThreshold = threshold || Infinity;
      _adjustedLag = Math.min(adjustedLag || 33, _lagThreshold);
    },
    fps: function fps(_fps) {
      _gap = 1e3 / (_fps || 240);
      _nextTime = _self.time * 1e3 + _gap;
    },
    add: function add(callback, once, prioritize) {
      var func = once ? function(t, d, f, v) {
        callback(t, d, f, v);
        _self.remove(func);
      } : callback;
      _self.remove(callback);
      _listeners2[prioritize ? "unshift" : "push"](func);
      _wake();
      return func;
    },
    remove: function remove(callback, i) {
      ~(i = _listeners2.indexOf(callback)) && _listeners2.splice(i, 1) && _i >= i && _i--;
    },
    _listeners: _listeners2
  };
  return _self;
})(), _wake = function _wake2() {
  return !_tickerActive && _ticker.wake();
}, _easeMap = {}, _customEaseExp = /^[\d.\-M][\d.\-,\s]/, _quotesExp = /["']/g, _parseObjectInString = function _parseObjectInString2(value) {
  var obj = {}, split = value.substr(1, value.length - 3).split(":"), key = split[0], i = 1, l = split.length, index, val, parsedVal;
  for (; i < l; i++) {
    val = split[i];
    index = i !== l - 1 ? val.lastIndexOf(",") : val.length;
    parsedVal = val.substr(0, index);
    obj[key] = isNaN(parsedVal) ? parsedVal.replace(_quotesExp, "").trim() : +parsedVal;
    key = val.substr(index + 1).trim();
  }
  return obj;
}, _valueInParentheses = function _valueInParentheses2(value) {
  var open = value.indexOf("(") + 1, close = value.indexOf(")"), nested = value.indexOf("(", open);
  return value.substring(open, ~nested && nested < close ? value.indexOf(")", close + 1) : close);
}, _configEaseFromString = function _configEaseFromString2(name) {
  var split = (name + "").split("("), ease = _easeMap[split[0]];
  return ease && split.length > 1 && ease.config ? ease.config.apply(null, ~name.indexOf("{") ? [_parseObjectInString(split[1])] : _valueInParentheses(name).split(",").map(_numericIfPossible)) : _easeMap._CE && _customEaseExp.test(name) ? _easeMap._CE("", name) : ease;
}, _invertEase = function _invertEase2(ease) {
  return function(p) {
    return 1 - ease(1 - p);
  };
}, _parseEase = function _parseEase2(ease, defaultEase) {
  return !ease ? defaultEase : (_isFunction(ease) ? ease : _easeMap[ease] || _configEaseFromString(ease)) || defaultEase;
}, _insertEase = function _insertEase2(names, easeIn, easeOut, easeInOut) {
  if (easeOut === void 0) {
    easeOut = function easeOut2(p) {
      return 1 - easeIn(1 - p);
    };
  }
  if (easeInOut === void 0) {
    easeInOut = function easeInOut2(p) {
      return p < 0.5 ? easeIn(p * 2) / 2 : 1 - easeIn((1 - p) * 2) / 2;
    };
  }
  var ease = {
    easeIn,
    easeOut,
    easeInOut
  }, lowercaseName;
  _forEachName(names, function(name) {
    _easeMap[name] = _globals[name] = ease;
    _easeMap[lowercaseName = name.toLowerCase()] = easeOut;
    for (var p in ease) {
      _easeMap[lowercaseName + (p === "easeIn" ? ".in" : p === "easeOut" ? ".out" : ".inOut")] = _easeMap[name + "." + p] = ease[p];
    }
  });
  return ease;
}, _easeInOutFromOut = function _easeInOutFromOut2(easeOut) {
  return function(p) {
    return p < 0.5 ? (1 - easeOut(1 - p * 2)) / 2 : 0.5 + easeOut((p - 0.5) * 2) / 2;
  };
}, _configElastic = function _configElastic2(type, amplitude, period) {
  var p1 = amplitude >= 1 ? amplitude : 1, p2 = (period || (type ? 0.3 : 0.45)) / (amplitude < 1 ? amplitude : 1), p3 = p2 / _2PI * (Math.asin(1 / p1) || 0), easeOut = function easeOut2(p) {
    return p === 1 ? 1 : p1 * Math.pow(2, -10 * p) * _sin((p - p3) * p2) + 1;
  }, ease = type === "out" ? easeOut : type === "in" ? function(p) {
    return 1 - easeOut(1 - p);
  } : _easeInOutFromOut(easeOut);
  p2 = _2PI / p2;
  ease.config = function(amplitude2, period2) {
    return _configElastic2(type, amplitude2, period2);
  };
  return ease;
}, _configBack = function _configBack2(type, overshoot) {
  if (overshoot === void 0) {
    overshoot = 1.70158;
  }
  var easeOut = function easeOut2(p) {
    return p ? --p * p * ((overshoot + 1) * p + overshoot) + 1 : 0;
  }, ease = type === "out" ? easeOut : type === "in" ? function(p) {
    return 1 - easeOut(1 - p);
  } : _easeInOutFromOut(easeOut);
  ease.config = function(overshoot2) {
    return _configBack2(type, overshoot2);
  };
  return ease;
};
_forEachName("Linear,Quad,Cubic,Quart,Quint,Strong", function(name, i) {
  var power = i < 5 ? i + 1 : i;
  _insertEase(name + ",Power" + (power - 1), i ? function(p) {
    return Math.pow(p, power);
  } : function(p) {
    return p;
  }, function(p) {
    return 1 - Math.pow(1 - p, power);
  }, function(p) {
    return p < 0.5 ? Math.pow(p * 2, power) / 2 : 1 - Math.pow((1 - p) * 2, power) / 2;
  });
});
_easeMap.Linear.easeNone = _easeMap.none = _easeMap.Linear.easeIn;
_insertEase("Elastic", _configElastic("in"), _configElastic("out"), _configElastic());
(function(n, c) {
  var n1 = 1 / c, n2 = 2 * n1, n3 = 2.5 * n1, easeOut = function easeOut2(p) {
    return p < n1 ? n * p * p : p < n2 ? n * Math.pow(p - 1.5 / c, 2) + 0.75 : p < n3 ? n * (p -= 2.25 / c) * p + 0.9375 : n * Math.pow(p - 2.625 / c, 2) + 0.984375;
  };
  _insertEase("Bounce", function(p) {
    return 1 - easeOut(1 - p);
  }, easeOut);
})(7.5625, 2.75);
_insertEase("Expo", function(p) {
  return Math.pow(2, 10 * (p - 1)) * p + p * p * p * p * p * p * (1 - p);
});
_insertEase("Circ", function(p) {
  return -(_sqrt(1 - p * p) - 1);
});
_insertEase("Sine", function(p) {
  return p === 1 ? 1 : -_cos(p * _HALF_PI) + 1;
});
_insertEase("Back", _configBack("in"), _configBack("out"), _configBack());
_easeMap.SteppedEase = _easeMap.steps = _globals.SteppedEase = {
  config: function config(steps, immediateStart) {
    if (steps === void 0) {
      steps = 1;
    }
    var p1 = 1 / steps, p2 = steps + (immediateStart ? 0 : 1), p3 = immediateStart ? 1 : 0, max = 1 - _tinyNum;
    return function(p) {
      return ((p2 * _clamp(0, max, p) | 0) + p3) * p1;
    };
  }
};
_defaults.ease = _easeMap["quad.out"];
_forEachName("onComplete,onUpdate,onStart,onRepeat,onReverseComplete,onInterrupt", function(name) {
  return _callbackNames += name + "," + name + "Params,";
});
var GSCache = function GSCache2(target, harness) {
  this.id = _gsID++;
  target._gsap = this;
  this.target = target;
  this.harness = harness;
  this.get = harness ? harness.get : _getProperty;
  this.set = harness ? harness.getSetter : _getSetter;
};
var Animation = /* @__PURE__ */ (function() {
  function Animation2(vars) {
    this.vars = vars;
    this._delay = +vars.delay || 0;
    if (this._repeat = vars.repeat === Infinity ? -2 : vars.repeat || 0) {
      this._rDelay = vars.repeatDelay || 0;
      this._yoyo = !!vars.yoyo || !!vars.yoyoEase;
    }
    this._ts = 1;
    _setDuration(this, +vars.duration, 1, 1);
    this.data = vars.data;
    if (_context) {
      this._ctx = _context;
      _context.data.push(this);
    }
    _tickerActive || _ticker.wake();
  }
  var _proto = Animation2.prototype;
  _proto.delay = function delay(value) {
    if (value || value === 0) {
      this.parent && this.parent.smoothChildTiming && this.startTime(this._start + value - this._delay);
      this._delay = value;
      return this;
    }
    return this._delay;
  };
  _proto.duration = function duration(value) {
    return arguments.length ? this.totalDuration(this._repeat > 0 ? value + (value + this._rDelay) * this._repeat : value) : this.totalDuration() && this._dur;
  };
  _proto.totalDuration = function totalDuration(value) {
    if (!arguments.length) {
      return this._tDur;
    }
    this._dirty = 0;
    return _setDuration(this, this._repeat < 0 ? value : (value - this._repeat * this._rDelay) / (this._repeat + 1));
  };
  _proto.totalTime = function totalTime(_totalTime, suppressEvents) {
    _wake();
    if (!arguments.length) {
      return this._tTime;
    }
    var parent = this._dp;
    if (parent && parent.smoothChildTiming && this._ts) {
      _alignPlayhead(this, _totalTime);
      !parent._dp || parent.parent || _postAddChecks(parent, this);
      while (parent && parent.parent) {
        if (parent.parent._time !== parent._start + (parent._ts >= 0 ? parent._tTime / parent._ts : (parent.totalDuration() - parent._tTime) / -parent._ts)) {
          parent.totalTime(parent._tTime, true);
        }
        parent = parent.parent;
      }
      if (!this.parent && this._dp.autoRemoveChildren && (this._ts > 0 && _totalTime < this._tDur || this._ts < 0 && _totalTime > 0 || !this._tDur && !_totalTime)) {
        _addToTimeline(this._dp, this, this._start - this._delay);
      }
    }
    if (this._tTime !== _totalTime || !this._dur && !suppressEvents || this._initted && Math.abs(this._zTime) === _tinyNum || !this._initted && this._dur && _totalTime || !_totalTime && !this._initted && (this.add || this._ptLookup)) {
      this._ts || (this._pTime = _totalTime);
      _lazySafeRender(this, _totalTime, suppressEvents);
    }
    return this;
  };
  _proto.time = function time(value, suppressEvents) {
    return arguments.length ? this.totalTime(Math.min(this.totalDuration(), value + _elapsedCycleDuration(this)) % (this._dur + this._rDelay) || (value ? this._dur : 0), suppressEvents) : this._time;
  };
  _proto.totalProgress = function totalProgress(value, suppressEvents) {
    return arguments.length ? this.totalTime(this.totalDuration() * value, suppressEvents) : this.totalDuration() ? Math.min(1, this._tTime / this._tDur) : this.rawTime() >= 0 && this._initted ? 1 : 0;
  };
  _proto.progress = function progress(value, suppressEvents) {
    return arguments.length ? this.totalTime(this.duration() * (this._yoyo && !(this.iteration() & 1) ? 1 - value : value) + _elapsedCycleDuration(this), suppressEvents) : this.duration() ? Math.min(1, this._time / this._dur) : this.rawTime() > 0 ? 1 : 0;
  };
  _proto.iteration = function iteration(value, suppressEvents) {
    var cycleDuration = this.duration() + this._rDelay;
    return arguments.length ? this.totalTime(this._time + (value - 1) * cycleDuration, suppressEvents) : this._repeat ? _animationCycle(this._tTime, cycleDuration) + 1 : 1;
  };
  _proto.timeScale = function timeScale(value, suppressEvents) {
    if (!arguments.length) {
      return this._rts === -_tinyNum ? 0 : this._rts;
    }
    if (this._rts === value) {
      return this;
    }
    var tTime = this.parent && this._ts ? _parentToChildTotalTime(this.parent._time, this) : this._tTime;
    this._rts = +value || 0;
    this._ts = this._ps || value === -_tinyNum ? 0 : this._rts;
    this.totalTime(_clamp(-Math.abs(this._delay), this.totalDuration(), tTime), suppressEvents !== false);
    _setEnd(this);
    return _recacheAncestors(this);
  };
  _proto.paused = function paused(value) {
    if (!arguments.length) {
      return this._ps;
    }
    if (this._ps !== value) {
      this._ps = value;
      if (value) {
        this._pTime = this._tTime || Math.max(-this._delay, this.rawTime());
        this._ts = this._act = 0;
      } else {
        _wake();
        this._ts = this._rts;
        this.totalTime(this.parent && !this.parent.smoothChildTiming ? this.rawTime() : this._tTime || this._pTime, this.progress() === 1 && Math.abs(this._zTime) !== _tinyNum && (this._tTime -= _tinyNum));
      }
    }
    return this;
  };
  _proto.startTime = function startTime(value) {
    if (arguments.length) {
      this._start = _roundPrecise(value);
      var parent = this.parent || this._dp;
      parent && (parent._sort || !this.parent) && _addToTimeline(parent, this, this._start - this._delay);
      return this;
    }
    return this._start;
  };
  _proto.endTime = function endTime(includeRepeats) {
    return this._start + (_isNotFalse(includeRepeats) ? this.totalDuration() : this.duration()) / Math.abs(this._ts || 1);
  };
  _proto.rawTime = function rawTime(wrapRepeats) {
    var parent = this.parent || this._dp;
    return !parent ? this._tTime : wrapRepeats && (!this._ts || this._repeat && this._time && this.totalProgress() < 1) ? this._tTime % (this._dur + this._rDelay) : !this._ts ? this._tTime : _parentToChildTotalTime(parent.rawTime(wrapRepeats), this);
  };
  _proto.revert = function revert(config3) {
    if (config3 === void 0) {
      config3 = _revertConfig;
    }
    var prevIsReverting = _reverting$1;
    _reverting$1 = config3;
    if (_isRevertWorthy(this)) {
      this.timeline && this.timeline.revert(config3);
      this.totalTime(-0.01, config3.suppressEvents);
    }
    this.data !== "nested" && config3.kill !== false && this.kill();
    _reverting$1 = prevIsReverting;
    return this;
  };
  _proto.globalTime = function globalTime(rawTime) {
    var animation = this, time = arguments.length ? rawTime : animation.rawTime();
    while (animation) {
      time = animation._start + time / (Math.abs(animation._ts) || 1);
      animation = animation._dp;
    }
    return !this.parent && this._sat ? this._sat.globalTime(rawTime) : time;
  };
  _proto.repeat = function repeat(value) {
    if (arguments.length) {
      this._repeat = value === Infinity ? -2 : value;
      return _onUpdateTotalDuration(this);
    }
    return this._repeat === -2 ? Infinity : this._repeat;
  };
  _proto.repeatDelay = function repeatDelay(value) {
    if (arguments.length) {
      var time = this._time;
      this._rDelay = value;
      _onUpdateTotalDuration(this);
      return time ? this.time(time) : this;
    }
    return this._rDelay;
  };
  _proto.yoyo = function yoyo(value) {
    if (arguments.length) {
      this._yoyo = value;
      return this;
    }
    return this._yoyo;
  };
  _proto.seek = function seek(position, suppressEvents) {
    return this.totalTime(_parsePosition(this, position), _isNotFalse(suppressEvents));
  };
  _proto.restart = function restart(includeDelay, suppressEvents) {
    this.play().totalTime(includeDelay ? -this._delay : 0, _isNotFalse(suppressEvents));
    this._dur || (this._zTime = -_tinyNum);
    return this;
  };
  _proto.play = function play(from, suppressEvents) {
    from != null && this.seek(from, suppressEvents);
    return this.reversed(false).paused(false);
  };
  _proto.reverse = function reverse(from, suppressEvents) {
    from != null && this.seek(from || this.totalDuration(), suppressEvents);
    return this.reversed(true).paused(false);
  };
  _proto.pause = function pause(atTime, suppressEvents) {
    atTime != null && this.seek(atTime, suppressEvents);
    return this.paused(true);
  };
  _proto.resume = function resume() {
    return this.paused(false);
  };
  _proto.reversed = function reversed(value) {
    if (arguments.length) {
      !!value !== this.reversed() && this.timeScale(-this._rts || (value ? -_tinyNum : 0));
      return this;
    }
    return this._rts < 0;
  };
  _proto.invalidate = function invalidate() {
    this._initted = this._act = 0;
    this._zTime = -_tinyNum;
    return this;
  };
  _proto.isActive = function isActive() {
    var parent = this.parent || this._dp, start = this._start, rawTime;
    return !!(!parent || this._ts && this._initted && parent.isActive() && (rawTime = parent.rawTime(true)) >= start && rawTime < this.endTime(true) - _tinyNum);
  };
  _proto.eventCallback = function eventCallback(type, callback, params) {
    var vars = this.vars;
    if (arguments.length > 1) {
      if (!callback) {
        delete vars[type];
      } else {
        vars[type] = callback;
        params && (vars[type + "Params"] = params);
        type === "onUpdate" && (this._onUpdate = callback);
      }
      return this;
    }
    return vars[type];
  };
  _proto.then = function then(onFulfilled) {
    var self = this, prevProm = self._prom;
    return new Promise(function(resolve) {
      var f = _isFunction(onFulfilled) ? onFulfilled : _passThrough, _resolve = function _resolve2() {
        var _then = self.then;
        self.then = null;
        prevProm && prevProm();
        _isFunction(f) && (f = f(self)) && (f.then || f === self) && (self.then = _then);
        resolve(f);
        self.then = _then;
      };
      if (self._initted && self.totalProgress() === 1 && self._ts >= 0 || !self._tTime && self._ts < 0) {
        _resolve();
      } else {
        self._prom = _resolve;
      }
    });
  };
  _proto.kill = function kill() {
    _interrupt$1(this);
  };
  return Animation2;
})();
_setDefaults(Animation.prototype, {
  _time: 0,
  _start: 0,
  _end: 0,
  _tTime: 0,
  _tDur: 0,
  _dirty: 0,
  _repeat: 0,
  _yoyo: false,
  parent: null,
  _initted: false,
  _rDelay: 0,
  _ts: 1,
  _dp: 0,
  ratio: 0,
  _zTime: -_tinyNum,
  _prom: 0,
  _ps: false,
  _rts: 1
});
var Timeline = /* @__PURE__ */ (function(_Animation) {
  _inheritsLoose(Timeline2, _Animation);
  function Timeline2(vars, position) {
    var _this;
    if (vars === void 0) {
      vars = {};
    }
    _this = _Animation.call(this, vars) || this;
    _this.labels = {};
    _this.smoothChildTiming = !!vars.smoothChildTiming;
    _this.autoRemoveChildren = !!vars.autoRemoveChildren;
    _this._sort = _isNotFalse(vars.sortChildren);
    _globalTimeline && _addToTimeline(vars.parent || _globalTimeline, _assertThisInitialized(_this), position);
    vars.reversed && _this.reverse();
    vars.paused && _this.paused(true);
    vars.scrollTrigger && _scrollTrigger(_assertThisInitialized(_this), vars.scrollTrigger);
    return _this;
  }
  var _proto2 = Timeline2.prototype;
  _proto2.to = function to(targets, vars, position) {
    _createTweenType(0, arguments, this);
    return this;
  };
  _proto2.from = function from(targets, vars, position) {
    _createTweenType(1, arguments, this);
    return this;
  };
  _proto2.fromTo = function fromTo(targets, fromVars, toVars, position) {
    _createTweenType(2, arguments, this);
    return this;
  };
  _proto2.set = function set(targets, vars, position) {
    vars.duration = 0;
    vars.parent = this;
    _inheritDefaults(vars).repeatDelay || (vars.repeat = 0);
    vars.immediateRender = !!vars.immediateRender;
    new Tween(targets, vars, _parsePosition(this, position), 1);
    return this;
  };
  _proto2.call = function call(callback, params, position) {
    return _addToTimeline(this, Tween.delayedCall(0, callback, params), position);
  };
  _proto2.staggerTo = function staggerTo(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams) {
    vars.duration = duration;
    vars.stagger = vars.stagger || stagger;
    vars.onComplete = onCompleteAll;
    vars.onCompleteParams = onCompleteAllParams;
    vars.parent = this;
    new Tween(targets, vars, _parsePosition(this, position));
    return this;
  };
  _proto2.staggerFrom = function staggerFrom(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams) {
    vars.runBackwards = 1;
    _inheritDefaults(vars).immediateRender = _isNotFalse(vars.immediateRender);
    return this.staggerTo(targets, duration, vars, stagger, position, onCompleteAll, onCompleteAllParams);
  };
  _proto2.staggerFromTo = function staggerFromTo(targets, duration, fromVars, toVars, stagger, position, onCompleteAll, onCompleteAllParams) {
    toVars.startAt = fromVars;
    _inheritDefaults(toVars).immediateRender = _isNotFalse(toVars.immediateRender);
    return this.staggerTo(targets, duration, toVars, stagger, position, onCompleteAll, onCompleteAllParams);
  };
  _proto2.render = function render4(totalTime, suppressEvents, force) {
    var prevTime = this._time, tDur = this._dirty ? this.totalDuration() : this._tDur, dur = this._dur, tTime = totalTime <= 0 ? 0 : _roundPrecise(totalTime), crossingStart = this._zTime < 0 !== totalTime < 0 && (this._initted || !dur), time, child, next, iteration, cycleDuration, prevPaused, pauseTween, timeScale, prevStart, prevIteration, yoyo, isYoyo;
    this !== _globalTimeline && tTime > tDur && totalTime >= 0 && (tTime = tDur);
    if (tTime !== this._tTime || force || crossingStart) {
      if (prevTime !== this._time && dur) {
        tTime += this._time - prevTime;
        totalTime += this._time - prevTime;
      }
      time = tTime;
      prevStart = this._start;
      timeScale = this._ts;
      prevPaused = !timeScale;
      if (crossingStart) {
        dur || (prevTime = this._zTime);
        (totalTime || !suppressEvents) && (this._zTime = totalTime);
      }
      if (this._repeat) {
        yoyo = this._yoyo;
        cycleDuration = dur + this._rDelay;
        if (this._repeat < -1 && totalTime < 0) {
          return this.totalTime(cycleDuration * 100 + totalTime, suppressEvents, force);
        }
        time = _roundPrecise(tTime % cycleDuration);
        if (tTime === tDur) {
          iteration = this._repeat;
          time = dur;
        } else {
          prevIteration = _roundPrecise(tTime / cycleDuration);
          iteration = ~~prevIteration;
          if (iteration && iteration === prevIteration) {
            time = dur;
            iteration--;
          }
          time > dur && (time = dur);
        }
        prevIteration = _animationCycle(this._tTime, cycleDuration);
        !prevTime && this._tTime && prevIteration !== iteration && this._tTime - prevIteration * cycleDuration - this._dur <= 0 && (prevIteration = iteration);
        if (yoyo && iteration & 1) {
          time = dur - time;
          isYoyo = 1;
        }
        if (iteration !== prevIteration && !this._lock) {
          var rewinding = yoyo && prevIteration & 1, doesWrap = rewinding === (yoyo && iteration & 1);
          iteration < prevIteration && (rewinding = !rewinding);
          prevTime = rewinding ? 0 : tTime % dur ? dur : tTime;
          this._lock = 1;
          this.render(prevTime || (isYoyo ? 0 : _roundPrecise(iteration * cycleDuration)), suppressEvents, !dur)._lock = 0;
          this._tTime = tTime;
          !suppressEvents && this.parent && _callback(this, "onRepeat");
          if (this.vars.repeatRefresh && !isYoyo) {
            this.invalidate()._lock = 1;
            prevIteration = iteration;
          }
          if (prevTime && prevTime !== this._time || prevPaused !== !this._ts || this.vars.onRepeat && !this.parent && !this._act) {
            return this;
          }
          dur = this._dur;
          tDur = this._tDur;
          if (doesWrap) {
            this._lock = 2;
            prevTime = rewinding ? dur : -1e-4;
            this.render(prevTime, true);
            this.vars.repeatRefresh && !isYoyo && this.invalidate();
          }
          this._lock = 0;
          if (!this._ts && !prevPaused) {
            return this;
          }
        }
      }
      if (this._hasPause && !this._forcing && this._lock < 2) {
        pauseTween = _findNextPauseTween(this, _roundPrecise(prevTime), _roundPrecise(time));
        if (pauseTween) {
          tTime -= time - (time = pauseTween._start);
        }
      }
      this._tTime = tTime;
      this._time = time;
      this._act = !!timeScale;
      if (!this._initted) {
        this._onUpdate = this.vars.onUpdate;
        this._initted = 1;
        this._zTime = totalTime;
        prevTime = 0;
      }
      if (!prevTime && tTime && dur && !suppressEvents && !prevIteration) {
        _callback(this, "onStart");
        if (this._tTime !== tTime) {
          return this;
        }
      }
      if (time >= prevTime && totalTime >= 0) {
        child = this._first;
        while (child) {
          next = child._next;
          if ((child._act || time >= child._start) && child._ts && pauseTween !== child) {
            if (child.parent !== this) {
              return this.render(totalTime, suppressEvents, force);
            }
            child.render(child._ts > 0 ? (time - child._start) * child._ts : (child._dirty ? child.totalDuration() : child._tDur) + (time - child._start) * child._ts, suppressEvents, force);
            if (time !== this._time || !this._ts && !prevPaused) {
              pauseTween = 0;
              next && (tTime += this._zTime = -_tinyNum);
              break;
            }
          }
          child = next;
        }
      } else {
        child = this._last;
        var adjustedTime = totalTime < 0 ? totalTime : time;
        while (child) {
          next = child._prev;
          if ((child._act || adjustedTime <= child._end) && child._ts && pauseTween !== child) {
            if (child.parent !== this) {
              return this.render(totalTime, suppressEvents, force);
            }
            child.render(child._ts > 0 ? (adjustedTime - child._start) * child._ts : (child._dirty ? child.totalDuration() : child._tDur) + (adjustedTime - child._start) * child._ts, suppressEvents, force || _reverting$1 && _isRevertWorthy(child));
            if (time !== this._time || !this._ts && !prevPaused) {
              pauseTween = 0;
              next && (tTime += this._zTime = adjustedTime ? -_tinyNum : _tinyNum);
              break;
            }
          }
          child = next;
        }
      }
      if (pauseTween && !suppressEvents) {
        this.pause();
        pauseTween.render(time >= prevTime ? 0 : -_tinyNum)._zTime = time >= prevTime ? 1 : -1;
        if (this._ts) {
          this._start = prevStart;
          _setEnd(this);
          return this.render(totalTime, suppressEvents, force);
        }
      }
      this._onUpdate && !suppressEvents && _callback(this, "onUpdate", true);
      if (tTime === tDur && this._tTime >= this.totalDuration() || !tTime && prevTime) {
        if (prevStart === this._start || Math.abs(timeScale) !== Math.abs(this._ts)) {
          if (!this._lock) {
            (totalTime || !dur) && (tTime === tDur && this._ts > 0 || !tTime && this._ts < 0) && _removeFromParent(this, 1);
            if (!suppressEvents && !(totalTime < 0 && !prevTime) && (tTime || prevTime || !tDur)) {
              _callback(this, tTime === tDur && totalTime >= 0 ? "onComplete" : "onReverseComplete", true);
              this._prom && !(tTime < tDur && this.timeScale() > 0) && this._prom();
            }
          }
        }
      }
    }
    return this;
  };
  _proto2.add = function add(child, position) {
    var _this2 = this;
    _isNumber(position) || (position = _parsePosition(this, position, child));
    if (!(child instanceof Animation)) {
      if (_isArray(child)) {
        child.forEach(function(obj) {
          return _this2.add(obj, position);
        });
        return this;
      }
      if (_isString(child)) {
        return this.addLabel(child, position);
      }
      if (_isFunction(child)) {
        child = Tween.delayedCall(0, child);
      } else {
        return this;
      }
    }
    return this !== child ? _addToTimeline(this, child, position) : this;
  };
  _proto2.getChildren = function getChildren(nested, tweens, timelines, ignoreBeforeTime) {
    if (nested === void 0) {
      nested = true;
    }
    if (tweens === void 0) {
      tweens = true;
    }
    if (timelines === void 0) {
      timelines = true;
    }
    if (ignoreBeforeTime === void 0) {
      ignoreBeforeTime = -_bigNum$1;
    }
    var a = [], child = this._first;
    while (child) {
      if (child._start >= ignoreBeforeTime) {
        if (child instanceof Tween) {
          tweens && a.push(child);
        } else {
          timelines && a.push(child);
          nested && a.push.apply(a, child.getChildren(true, tweens, timelines));
        }
      }
      child = child._next;
    }
    return a;
  };
  _proto2.getById = function getById2(id) {
    var animations = this.getChildren(1, 1, 1), i = animations.length;
    while (i--) {
      if (animations[i].vars.id === id) {
        return animations[i];
      }
    }
  };
  _proto2.remove = function remove(child) {
    if (_isString(child)) {
      return this.removeLabel(child);
    }
    if (_isFunction(child)) {
      return this.killTweensOf(child);
    }
    child.parent === this && _removeLinkedListItem(this, child);
    if (child === this._recent) {
      this._recent = this._last;
    }
    return _uncache(this);
  };
  _proto2.totalTime = function totalTime(_totalTime2, suppressEvents) {
    if (!arguments.length) {
      return this._tTime;
    }
    this._forcing = 1;
    if (!this._dp && this._ts) {
      this._start = _roundPrecise(_ticker.time - (this._ts > 0 ? _totalTime2 / this._ts : (this.totalDuration() - _totalTime2) / -this._ts));
    }
    _Animation.prototype.totalTime.call(this, _totalTime2, suppressEvents);
    this._forcing = 0;
    return this;
  };
  _proto2.addLabel = function addLabel(label, position) {
    this.labels[label] = _parsePosition(this, position);
    return this;
  };
  _proto2.removeLabel = function removeLabel(label) {
    delete this.labels[label];
    return this;
  };
  _proto2.addPause = function addPause(position, callback, params) {
    var t = Tween.delayedCall(0, callback || _emptyFunc, params);
    t.data = "isPause";
    this._hasPause = 1;
    return _addToTimeline(this, t, _parsePosition(this, position));
  };
  _proto2.removePause = function removePause(position) {
    var child = this._first;
    position = _parsePosition(this, position);
    while (child) {
      if (child._start === position && child.data === "isPause") {
        _removeFromParent(child);
      }
      child = child._next;
    }
  };
  _proto2.killTweensOf = function killTweensOf(targets, props, onlyActive) {
    var tweens = this.getTweensOf(targets, onlyActive), i = tweens.length;
    while (i--) {
      _overwritingTween !== tweens[i] && tweens[i].kill(targets, props);
    }
    return this;
  };
  _proto2.getTweensOf = function getTweensOf2(targets, onlyActive) {
    var a = [], parsedTargets = toArray(targets), child = this._first, isGlobalTime = _isNumber(onlyActive), children2;
    while (child) {
      if (child instanceof Tween) {
        if (_arrayContainsAny(child._targets, parsedTargets) && (isGlobalTime ? (!_overwritingTween || child._initted && child._ts) && child.globalTime(0) <= onlyActive && child.globalTime(child.totalDuration()) > onlyActive : !onlyActive || child.isActive())) {
          a.push(child);
        }
      } else if ((children2 = child.getTweensOf(parsedTargets, onlyActive)).length) {
        a.push.apply(a, children2);
      }
      child = child._next;
    }
    return a;
  };
  _proto2.tweenTo = function tweenTo(position, vars) {
    vars = vars || {};
    var tl = this, endTime = _parsePosition(tl, position), _vars = vars, startAt = _vars.startAt, _onStart = _vars.onStart, onStartParams = _vars.onStartParams, immediateRender = _vars.immediateRender, initted, tween = Tween.to(tl, _setDefaults({
      ease: vars.ease || "none",
      lazy: false,
      immediateRender: false,
      time: endTime,
      overwrite: "auto",
      duration: vars.duration || Math.abs((endTime - (startAt && "time" in startAt ? startAt.time : tl._time)) / tl.timeScale()) || _tinyNum,
      onStart: function onStart() {
        tl.pause();
        if (!initted) {
          var duration = vars.duration || Math.abs((endTime - (startAt && "time" in startAt ? startAt.time : tl._time)) / tl.timeScale());
          tween._dur !== duration && _setDuration(tween, duration, 0, 1).render(tween._time, true, true);
          initted = 1;
        }
        _onStart && _onStart.apply(tween, onStartParams || []);
      }
    }, vars));
    return immediateRender ? tween.render(0) : tween;
  };
  _proto2.tweenFromTo = function tweenFromTo(fromPosition, toPosition, vars) {
    return this.tweenTo(toPosition, _setDefaults({
      startAt: {
        time: _parsePosition(this, fromPosition)
      }
    }, vars));
  };
  _proto2.recent = function recent() {
    return this._recent;
  };
  _proto2.nextLabel = function nextLabel(afterTime) {
    if (afterTime === void 0) {
      afterTime = this._time;
    }
    return _getLabelInDirection(this, _parsePosition(this, afterTime));
  };
  _proto2.previousLabel = function previousLabel(beforeTime) {
    if (beforeTime === void 0) {
      beforeTime = this._time;
    }
    return _getLabelInDirection(this, _parsePosition(this, beforeTime), 1);
  };
  _proto2.currentLabel = function currentLabel(value) {
    return arguments.length ? this.seek(value, true) : this.previousLabel(this._time + _tinyNum);
  };
  _proto2.shiftChildren = function shiftChildren(amount, adjustLabels, ignoreBeforeTime) {
    if (ignoreBeforeTime === void 0) {
      ignoreBeforeTime = 0;
    }
    var child = this._first, labels = this.labels, p;
    amount = _roundPrecise(amount);
    while (child) {
      if (child._start >= ignoreBeforeTime) {
        child._start += amount;
        child._end += amount;
      }
      child = child._next;
    }
    if (adjustLabels) {
      for (p in labels) {
        if (labels[p] >= ignoreBeforeTime) {
          labels[p] += amount;
        }
      }
    }
    return _uncache(this);
  };
  _proto2.invalidate = function invalidate(soft) {
    var child = this._first;
    this._lock = 0;
    while (child) {
      child.invalidate(soft);
      child = child._next;
    }
    return _Animation.prototype.invalidate.call(this, soft);
  };
  _proto2.clear = function clear(includeLabels) {
    if (includeLabels === void 0) {
      includeLabels = true;
    }
    var child = this._first, next;
    while (child) {
      next = child._next;
      this.remove(child);
      child = next;
    }
    this._dp && (this._time = this._tTime = this._pTime = 0);
    includeLabels && (this.labels = {});
    return _uncache(this);
  };
  _proto2.totalDuration = function totalDuration(value) {
    var max = 0, self = this, child = self._last, prevStart = _bigNum$1, prev, start, parent;
    if (arguments.length) {
      return self.timeScale((self._repeat < 0 ? self.duration() : self.totalDuration()) / (self.reversed() ? -value : value));
    }
    if (self._dirty) {
      parent = self.parent;
      while (child) {
        prev = child._prev;
        child._dirty && child.totalDuration();
        start = child._start;
        if (start > prevStart && self._sort && child._ts && !self._lock) {
          self._lock = 1;
          _addToTimeline(self, child, start - child._delay, 1)._lock = 0;
        } else {
          prevStart = start;
        }
        if (start < 0 && child._ts) {
          max -= start;
          if (!parent && !self._dp || parent && parent.smoothChildTiming) {
            self._start += _roundPrecise(start / self._ts);
            self._time -= start;
            self._tTime -= start;
          }
          self.shiftChildren(-start, false, -Infinity);
          prevStart = 0;
        }
        child._end > max && child._ts && (max = child._end);
        child = prev;
      }
      _setDuration(self, self === _globalTimeline && self._time > max ? self._time : max, 1, 1);
      self._dirty = 0;
    }
    return self._tDur;
  };
  Timeline2.updateRoot = function updateRoot(time) {
    if (_globalTimeline._ts) {
      _lazySafeRender(_globalTimeline, _parentToChildTotalTime(time, _globalTimeline));
      _lastRenderedFrame = _ticker.frame;
    }
    if (_ticker.frame >= _nextGCFrame) {
      _nextGCFrame += _config.autoSleep || 120;
      var child = _globalTimeline._first;
      if (!child || !child._ts) {
        if (_config.autoSleep && _ticker._listeners.length < 2) {
          while (child && !child._ts) {
            child = child._next;
          }
          child || _ticker.sleep();
        }
      }
    }
  };
  return Timeline2;
})(Animation);
_setDefaults(Timeline.prototype, {
  _lock: 0,
  _hasPause: 0,
  _forcing: 0
});
var _addComplexStringPropTween = function _addComplexStringPropTween2(target, prop, start, end, setter, stringFilter, funcParam) {
  var pt = new PropTween(this._pt, target, prop, 0, 1, _renderComplexString, null, setter), index = 0, matchIndex = 0, result, startNums, color, endNum, chunk, startNum, hasRandom, a;
  pt.b = start;
  pt.e = end;
  start += "";
  end += "";
  if (hasRandom = ~end.indexOf("random(")) {
    end = _replaceRandom(end);
  }
  if (stringFilter) {
    a = [start, end];
    stringFilter(a, target, prop);
    start = a[0];
    end = a[1];
  }
  startNums = start.match(_complexStringNumExp) || [];
  while (result = _complexStringNumExp.exec(end)) {
    endNum = result[0];
    chunk = end.substring(index, result.index);
    if (color) {
      color = (color + 1) % 5;
    } else if (chunk.substr(-5) === "rgba(") {
      color = 1;
    }
    if (endNum !== startNums[matchIndex++]) {
      startNum = parseFloat(startNums[matchIndex - 1]) || 0;
      pt._pt = {
        _next: pt._pt,
        p: chunk || matchIndex === 1 ? chunk : ",",
        //note: SVG spec allows omission of comma/space when a negative sign is wedged between two numbers, like 2.5-5.3 instead of 2.5,-5.3 but when tweening, the negative value may switch to positive, so we insert the comma just in case.
        s: startNum,
        c: endNum.charAt(1) === "=" ? _parseRelative(startNum, endNum) - startNum : parseFloat(endNum) - startNum,
        m: color && color < 4 ? Math.round : 0
      };
      index = _complexStringNumExp.lastIndex;
    }
  }
  pt.c = index < end.length ? end.substring(index, end.length) : "";
  pt.fp = funcParam;
  if (_relExp.test(end) || hasRandom) {
    pt.e = 0;
  }
  this._pt = pt;
  return pt;
}, _addPropTween = function _addPropTween2(target, prop, start, end, index, targets, modifier, stringFilter, funcParam, optional) {
  _isFunction(end) && (end = end(index || 0, target, targets));
  var currentValue = target[prop], parsedStart = start !== "get" ? start : !_isFunction(currentValue) ? currentValue : funcParam ? target[prop.indexOf("set") || !_isFunction(target["get" + prop.substr(3)]) ? prop : "get" + prop.substr(3)](funcParam) : target[prop](), setter = !_isFunction(currentValue) ? _setterPlain : funcParam ? _setterFuncWithParam : _setterFunc, pt;
  if (_isString(end)) {
    if (~end.indexOf("random(")) {
      end = _replaceRandom(end);
    }
    if (end.charAt(1) === "=") {
      pt = _parseRelative(parsedStart, end) + (getUnit(parsedStart) || 0);
      if (pt || pt === 0) {
        end = pt;
      }
    }
  }
  if (!optional || parsedStart !== end || _forceAllPropTweens) {
    if (!isNaN(parsedStart * end) && end !== "") {
      pt = new PropTween(this._pt, target, prop, +parsedStart || 0, end - (parsedStart || 0), typeof currentValue === "boolean" ? _renderBoolean : _renderPlain, 0, setter);
      funcParam && (pt.fp = funcParam);
      modifier && pt.modifier(modifier, this, target);
      return this._pt = pt;
    }
    !currentValue && !(prop in target) && _missingPlugin(prop, end);
    return _addComplexStringPropTween.call(this, target, prop, parsedStart, end, setter, stringFilter || _config.stringFilter, funcParam);
  }
}, _processVars = function _processVars2(vars, index, target, targets, tween) {
  _isFunction(vars) && (vars = _parseFuncOrString(vars, tween, index, target, targets));
  if (!_isObject(vars) || vars.style && vars.nodeType || _isArray(vars) || _isTypedArray(vars)) {
    return _isString(vars) ? _parseFuncOrString(vars, tween, index, target, targets) : vars;
  }
  var copy = {}, p;
  for (p in vars) {
    copy[p] = _parseFuncOrString(vars[p], tween, index, target, targets);
  }
  return copy;
}, _checkPlugin = function _checkPlugin2(property, vars, tween, index, target, targets) {
  var plugin, pt, ptLookup, i;
  if (_plugins[property] && (plugin = new _plugins[property]()).init(target, plugin.rawVars ? vars[property] : _processVars(vars[property], index, target, targets, tween), tween, index, targets) !== false) {
    tween._pt = pt = new PropTween(tween._pt, target, property, 0, 1, plugin.render, plugin, 0, plugin.priority);
    if (tween !== _quickTween) {
      ptLookup = tween._ptLookup[tween._targets.indexOf(target)];
      i = plugin._props.length;
      while (i--) {
        ptLookup[plugin._props[i]] = pt;
      }
    }
  }
  return plugin;
}, _overwritingTween, _forceAllPropTweens, _initTween = function _initTween2(tween, time, tTime) {
  var vars = tween.vars, ease = vars.ease, startAt = vars.startAt, immediateRender = vars.immediateRender, lazy = vars.lazy, onUpdate = vars.onUpdate, runBackwards = vars.runBackwards, yoyoEase = vars.yoyoEase, keyframes = vars.keyframes, autoRevert = vars.autoRevert, dur = tween._dur, prevStartAt = tween._startAt, targets = tween._targets, parent = tween.parent, fullTargets = parent && parent.data === "nested" ? parent.vars.targets : targets, autoOverwrite = tween._overwrite === "auto" && !_suppressOverwrites, tl = tween.timeline, reverseEase = vars.easeReverse || yoyoEase, cleanVars, i, p, pt, target, hasPriority, gsData, harness, plugin, ptLookup, index, harnessVars, overwritten;
  tl && (!keyframes || !ease) && (ease = "none");
  tween._ease = _parseEase(ease, _defaults.ease);
  tween._rEase = reverseEase && (_parseEase(reverseEase) || tween._ease);
  tween._from = !tl && !!vars.runBackwards;
  if (tween._from) tween.ratio = 1;
  if (!tl || keyframes && !vars.stagger) {
    harness = targets[0] ? _getCache(targets[0]).harness : 0;
    harnessVars = harness && vars[harness.prop];
    cleanVars = _copyExcluding(vars, _reservedProps);
    if (prevStartAt) {
      prevStartAt._zTime < 0 && prevStartAt.progress(1);
      time < 0 && runBackwards && immediateRender && !autoRevert ? prevStartAt.render(-1, true) : prevStartAt.revert(runBackwards && dur ? _revertConfigNoKill : _startAtRevertConfig);
      prevStartAt._lazy = 0;
    }
    if (startAt) {
      _removeFromParent(tween._startAt = Tween.set(targets, _setDefaults({
        data: "isStart",
        overwrite: false,
        parent,
        immediateRender: true,
        lazy: !prevStartAt && _isNotFalse(lazy),
        startAt: null,
        delay: 0,
        onUpdate: onUpdate && function() {
          return _callback(tween, "onUpdate");
        },
        stagger: 0
      }, startAt)));
      tween._startAt._dp = 0;
      tween._startAt._sat = tween;
      time < 0 && (_reverting$1 || !immediateRender && !autoRevert) && tween._startAt.revert(_revertConfigNoKill);
      if (immediateRender) {
        if (dur && time <= 0 && tTime <= 0) {
          time && (tween._zTime = time);
          return;
        }
      }
    } else if (runBackwards && dur) {
      if (!prevStartAt) {
        time && (immediateRender = false);
        p = _setDefaults({
          overwrite: false,
          data: "isFromStart",
          //we tag the tween with as "isFromStart" so that if [inside a plugin] we need to only do something at the very END of a tween, we have a way of identifying this tween as merely the one that's setting the beginning values for a "from()" tween. For example, clearProps in CSSPlugin should only get applied at the very END of a tween and without this tag, from(...{height:100, clearProps:"height", delay:1}) would wipe the height at the beginning of the tween and after 1 second, it'd kick back in.
          lazy: immediateRender && !prevStartAt && _isNotFalse(lazy),
          immediateRender,
          //zero-duration tweens render immediately by default, but if we're not specifically instructed to render this tween immediately, we should skip this and merely _init() to record the starting values (rendering them immediately would push them to completion which is wasteful in that case - we'd have to render(-1) immediately after)
          stagger: 0,
          parent
          //ensures that nested tweens that had a stagger are handled properly, like gsap.from(".class", {y: gsap.utils.wrap([-100,100]), stagger: 0.5})
        }, cleanVars);
        harnessVars && (p[harness.prop] = harnessVars);
        _removeFromParent(tween._startAt = Tween.set(targets, p));
        tween._startAt._dp = 0;
        tween._startAt._sat = tween;
        time < 0 && (_reverting$1 ? tween._startAt.revert(_revertConfigNoKill) : tween._startAt.render(-1, true));
        tween._zTime = time;
        if (!immediateRender) {
          _initTween2(tween._startAt, _tinyNum, _tinyNum);
        } else if (!time) {
          return;
        }
      }
    }
    tween._pt = tween._ptCache = 0;
    lazy = dur && _isNotFalse(lazy) || lazy && !dur;
    for (i = 0; i < targets.length; i++) {
      target = targets[i];
      gsData = target._gsap || _harness(targets)[i]._gsap;
      tween._ptLookup[i] = ptLookup = {};
      _lazyLookup[gsData.id] && _lazyTweens.length && _lazyRender();
      index = fullTargets === targets ? i : fullTargets.indexOf(target);
      if (harness && (plugin = new harness()).init(target, harnessVars || cleanVars, tween, index, fullTargets) !== false) {
        tween._pt = pt = new PropTween(tween._pt, target, plugin.name, 0, 1, plugin.render, plugin, 0, plugin.priority);
        plugin._props.forEach(function(name) {
          ptLookup[name] = pt;
        });
        plugin.priority && (hasPriority = 1);
      }
      if (!harness || harnessVars) {
        for (p in cleanVars) {
          if (_plugins[p] && (plugin = _checkPlugin(p, cleanVars, tween, index, target, fullTargets))) {
            plugin.priority && (hasPriority = 1);
          } else {
            ptLookup[p] = pt = _addPropTween.call(tween, target, p, "get", cleanVars[p], index, fullTargets, 0, vars.stringFilter);
          }
        }
      }
      tween._op && tween._op[i] && tween.kill(target, tween._op[i]);
      if (autoOverwrite && tween._pt) {
        _overwritingTween = tween;
        _globalTimeline.killTweensOf(target, ptLookup, tween.globalTime(time));
        overwritten = !tween.parent;
        _overwritingTween = 0;
      }
      tween._pt && lazy && (_lazyLookup[gsData.id] = 1);
    }
    hasPriority && _sortPropTweensByPriority(tween);
    tween._onInit && tween._onInit(tween);
  }
  tween._onUpdate = onUpdate;
  tween._initted = (!tween._op || tween._pt) && !overwritten;
  keyframes && time <= 0 && tl.render(_bigNum$1, true, true);
}, _updatePropTweens = function _updatePropTweens2(tween, property, value, start, startIsRelative, ratio, time, skipRecursion) {
  var ptCache = (tween._pt && tween._ptCache || (tween._ptCache = {}))[property], pt, rootPT, lookup, i;
  if (!ptCache) {
    ptCache = tween._ptCache[property] = [];
    lookup = tween._ptLookup;
    i = tween._targets.length;
    while (i--) {
      pt = lookup[i][property];
      if (pt && pt.d && pt.d._pt) {
        pt = pt.d._pt;
        while (pt && pt.p !== property && pt.fp !== property) {
          pt = pt._next;
        }
      }
      if (!pt) {
        _forceAllPropTweens = 1;
        tween.vars[property] = "+=0";
        _initTween(tween, time);
        _forceAllPropTweens = 0;
        return skipRecursion ? _warn(property + " not eligible for reset. Try splitting into individual properties") : 1;
      }
      ptCache.push(pt);
    }
  }
  i = ptCache.length;
  while (i--) {
    rootPT = ptCache[i];
    pt = rootPT._pt || rootPT;
    pt.s = (start || start === 0) && !startIsRelative ? start : pt.s + (start || 0) + ratio * pt.c;
    pt.c = value - pt.s;
    rootPT.e && (rootPT.e = _round$1(value) + getUnit(rootPT.e));
    rootPT.b && (rootPT.b = pt.s + getUnit(rootPT.b));
  }
}, _addAliasesToVars = function _addAliasesToVars2(targets, vars) {
  var harness = targets[0] ? _getCache(targets[0]).harness : 0, propertyAliases = harness && harness.aliases, copy, p, i, aliases;
  if (!propertyAliases) {
    return vars;
  }
  copy = _merge({}, vars);
  for (p in propertyAliases) {
    if (p in copy) {
      aliases = propertyAliases[p].split(",");
      i = aliases.length;
      while (i--) {
        copy[aliases[i]] = copy[p];
      }
    }
  }
  return copy;
}, _parseKeyframe = function _parseKeyframe2(prop, obj, allProps, easeEach) {
  var ease = obj.ease || easeEach || "power1.inOut", p, a;
  if (_isArray(obj)) {
    a = allProps[prop] || (allProps[prop] = []);
    obj.forEach(function(value, i) {
      return a.push({
        t: i / (obj.length - 1) * 100,
        v: value,
        e: ease
      });
    });
  } else {
    for (p in obj) {
      a = allProps[p] || (allProps[p] = []);
      p === "ease" || a.push({
        t: parseFloat(prop),
        v: obj[p],
        e: ease
      });
    }
  }
}, _parseFuncOrString = function _parseFuncOrString2(value, tween, i, target, targets) {
  return _isFunction(value) ? value.call(tween, i, target, targets) : _isString(value) && ~value.indexOf("random(") ? _replaceRandom(value) : value;
}, _staggerTweenProps = _callbackNames + "repeat,repeatDelay,yoyo,repeatRefresh,yoyoEase,easeReverse,autoRevert", _staggerPropsToSkip = {};
_forEachName(_staggerTweenProps + ",id,stagger,delay,duration,paused,scrollTrigger", function(name) {
  return _staggerPropsToSkip[name] = 1;
});
var Tween = /* @__PURE__ */ (function(_Animation2) {
  _inheritsLoose(Tween2, _Animation2);
  function Tween2(targets, vars, position, skipInherit) {
    var _this3;
    if (typeof vars === "number") {
      position.duration = vars;
      vars = position;
      position = null;
    }
    _this3 = _Animation2.call(this, skipInherit ? vars : _inheritDefaults(vars)) || this;
    var _this3$vars = _this3.vars, duration = _this3$vars.duration, delay = _this3$vars.delay, immediateRender = _this3$vars.immediateRender, stagger = _this3$vars.stagger, overwrite = _this3$vars.overwrite, keyframes = _this3$vars.keyframes, defaults2 = _this3$vars.defaults, scrollTrigger = _this3$vars.scrollTrigger, parent = vars.parent || _globalTimeline, parsedTargets = (_isArray(targets) || _isTypedArray(targets) ? _isNumber(targets[0]) : "length" in vars) ? [targets] : toArray(targets), tl, i, copy, l, p, curTarget, staggerFunc, staggerVarsToMerge;
    _this3._targets = parsedTargets.length ? _harness(parsedTargets) : _warn("GSAP target " + targets + " not found. https://gsap.com", !_config.nullTargetWarn) || [];
    _this3._ptLookup = [];
    _this3._overwrite = overwrite;
    if (keyframes || stagger || _isFuncOrString(duration) || _isFuncOrString(delay)) {
      vars = _this3.vars;
      var easeReverse = vars.easeReverse || vars.yoyoEase;
      tl = _this3.timeline = new Timeline({
        data: "nested",
        defaults: defaults2 || {},
        targets: parent && parent.data === "nested" ? parent.vars.targets : parsedTargets
      });
      tl.kill();
      tl.parent = tl._dp = _assertThisInitialized(_this3);
      tl._start = 0;
      if (stagger || _isFuncOrString(duration) || _isFuncOrString(delay)) {
        l = parsedTargets.length;
        staggerFunc = stagger && distribute(stagger);
        if (_isObject(stagger)) {
          for (p in stagger) {
            if (~_staggerTweenProps.indexOf(p)) {
              staggerVarsToMerge || (staggerVarsToMerge = {});
              staggerVarsToMerge[p] = stagger[p];
            }
          }
        }
        for (i = 0; i < l; i++) {
          copy = _copyExcluding(vars, _staggerPropsToSkip);
          copy.stagger = 0;
          easeReverse && (copy.easeReverse = easeReverse);
          staggerVarsToMerge && _merge(copy, staggerVarsToMerge);
          curTarget = parsedTargets[i];
          copy.duration = +_parseFuncOrString(duration, _assertThisInitialized(_this3), i, curTarget, parsedTargets);
          copy.delay = (+_parseFuncOrString(delay, _assertThisInitialized(_this3), i, curTarget, parsedTargets) || 0) - _this3._delay;
          if (!stagger && l === 1 && copy.delay) {
            _this3._delay = delay = copy.delay;
            _this3._start += delay;
            copy.delay = 0;
          }
          tl.to(curTarget, copy, staggerFunc ? staggerFunc(i, curTarget, parsedTargets) : 0);
          tl._ease = _easeMap.none;
        }
        tl.duration() ? duration = delay = 0 : _this3.timeline = 0;
      } else if (keyframes) {
        _inheritDefaults(_setDefaults(tl.vars.defaults, {
          ease: "none"
        }));
        tl._ease = _parseEase(keyframes.ease || vars.ease || "none");
        var time = 0, a, kf, v;
        if (_isArray(keyframes)) {
          keyframes.forEach(function(frame) {
            return tl.to(parsedTargets, frame, ">");
          });
          tl.duration();
        } else {
          copy = {};
          for (p in keyframes) {
            p === "ease" || p === "easeEach" || _parseKeyframe(p, keyframes[p], copy, keyframes.easeEach);
          }
          for (p in copy) {
            a = copy[p].sort(function(a2, b) {
              return a2.t - b.t;
            });
            time = 0;
            for (i = 0; i < a.length; i++) {
              kf = a[i];
              v = {
                ease: kf.e,
                duration: (kf.t - (i ? a[i - 1].t : 0)) / 100 * duration
              };
              v[p] = kf.v;
              tl.to(parsedTargets, v, time);
              time += v.duration;
            }
          }
          tl.duration() < duration && tl.to({}, {
            duration: duration - tl.duration()
          });
        }
      }
      duration || _this3.duration(duration = tl.duration());
    } else {
      _this3.timeline = 0;
    }
    if (overwrite === true && !_suppressOverwrites) {
      _overwritingTween = _assertThisInitialized(_this3);
      _globalTimeline.killTweensOf(parsedTargets);
      _overwritingTween = 0;
    }
    _addToTimeline(parent, _assertThisInitialized(_this3), position);
    vars.reversed && _this3.reverse();
    vars.paused && _this3.paused(true);
    if (immediateRender || !duration && !keyframes && _this3._start === _roundPrecise(parent._time) && _isNotFalse(immediateRender) && _hasNoPausedAncestors(_assertThisInitialized(_this3)) && parent.data !== "nested") {
      _this3._tTime = -_tinyNum;
      _this3.render(Math.max(0, -delay) || 0);
    }
    scrollTrigger && _scrollTrigger(_assertThisInitialized(_this3), scrollTrigger);
    return _this3;
  }
  var _proto3 = Tween2.prototype;
  _proto3.render = function render4(totalTime, suppressEvents, force) {
    var prevTime = this._time, tDur = this._tDur, dur = this._dur, isNegative = totalTime < 0, tTime = totalTime > tDur - _tinyNum && !isNegative ? tDur : totalTime < _tinyNum ? 0 : totalTime, time, pt, iteration, cycleDuration, prevIteration, isYoyo, ratio, timeline2;
    if (!dur) {
      _renderZeroDurationTween(this, totalTime, suppressEvents, force);
    } else if (tTime !== this._tTime || !totalTime || force || !this._initted && this._tTime || this._startAt && this._zTime < 0 !== isNegative || this._lazy) {
      time = tTime;
      timeline2 = this.timeline;
      if (this._repeat) {
        cycleDuration = dur + this._rDelay;
        if (this._repeat < -1 && isNegative) {
          return this.totalTime(cycleDuration * 100 + totalTime, suppressEvents, force);
        }
        time = _roundPrecise(tTime % cycleDuration);
        if (tTime === tDur) {
          iteration = this._repeat;
          time = dur;
        } else {
          prevIteration = _roundPrecise(tTime / cycleDuration);
          iteration = ~~prevIteration;
          if (iteration && iteration === prevIteration) {
            time = dur;
            iteration--;
          } else if (time > dur) {
            time = dur;
          }
        }
        isYoyo = this._yoyo && iteration & 1;
        if (isYoyo) time = dur - time;
        prevIteration = _animationCycle(this._tTime, cycleDuration);
        if (time === prevTime && !force && this._initted && iteration === prevIteration) {
          this._tTime = tTime;
          return this;
        }
        if (iteration !== prevIteration) {
          if (this.vars.repeatRefresh && !isYoyo && !this._lock && time !== cycleDuration && this._initted) {
            this._lock = force = 1;
            this.render(_roundPrecise(cycleDuration * iteration), true).invalidate()._lock = 0;
          }
        }
      }
      if (!this._initted) {
        if (_attemptInitTween(this, isNegative ? totalTime : time, force, suppressEvents, tTime)) {
          this._tTime = 0;
          return this;
        }
        if (prevTime !== this._time && !(force && this.vars.repeatRefresh && iteration !== prevIteration)) {
          return this;
        }
        if (dur !== this._dur) {
          return this.render(totalTime, suppressEvents, force);
        }
      }
      if (this._rEase) {
        var inv = time < prevTime;
        if (inv !== this._inv) {
          var segDur = inv ? prevTime : dur - prevTime;
          this._inv = inv;
          if (this._from) this.ratio = 1 - this.ratio;
          this._invRatio = this.ratio;
          this._invTime = prevTime;
          this._invRecip = segDur ? (inv ? -1 : 1) / segDur : 0;
          this._invScale = inv ? -this.ratio : 1 - this.ratio;
          this._invEase = inv ? this._rEase : this._ease;
        }
        this.ratio = ratio = this._invRatio + this._invScale * this._invEase((time - this._invTime) * this._invRecip);
      } else {
        this.ratio = ratio = this._ease(time / dur);
      }
      if (this._from) this.ratio = ratio = 1 - ratio;
      this._tTime = tTime;
      this._time = time;
      if (!this._act && this._ts) {
        this._act = 1;
        this._lazy = 0;
      }
      if (!prevTime && tTime && !suppressEvents && !prevIteration) {
        _callback(this, "onStart");
        if (this._tTime !== tTime) {
          return this;
        }
      }
      pt = this._pt;
      while (pt) {
        pt.r(ratio, pt.d);
        pt = pt._next;
      }
      timeline2 && timeline2.render(totalTime < 0 ? totalTime : timeline2._dur * timeline2._ease(time / this._dur), suppressEvents, force) || this._startAt && (this._zTime = totalTime);
      if (this._onUpdate && !suppressEvents) {
        isNegative && _rewindStartAt(this, totalTime, suppressEvents, force);
        _callback(this, "onUpdate");
      }
      this._repeat && iteration !== prevIteration && this.vars.onRepeat && !suppressEvents && this.parent && _callback(this, "onRepeat");
      if ((tTime === this._tDur || !tTime) && this._tTime === tTime) {
        isNegative && !this._onUpdate && _rewindStartAt(this, totalTime, true, true);
        (totalTime || !dur) && (tTime === this._tDur && this._ts > 0 || !tTime && this._ts < 0) && _removeFromParent(this, 1);
        if (!suppressEvents && !(isNegative && !prevTime) && (tTime || prevTime || isYoyo)) {
          _callback(this, tTime === tDur ? "onComplete" : "onReverseComplete", true);
          this._prom && !(tTime < tDur && this.timeScale() > 0) && this._prom();
        }
      }
    }
    return this;
  };
  _proto3.targets = function targets() {
    return this._targets;
  };
  _proto3.invalidate = function invalidate(soft) {
    (!soft || !this.vars.runBackwards) && (this._startAt = 0);
    this._pt = this._op = this._onUpdate = this._lazy = this.ratio = 0;
    this._ptLookup = [];
    this.timeline && this.timeline.invalidate(soft);
    return _Animation2.prototype.invalidate.call(this, soft);
  };
  _proto3.resetTo = function resetTo(property, value, start, startIsRelative, skipRecursion) {
    _tickerActive || _ticker.wake();
    this._ts || this.play();
    var time = Math.min(this._dur, (this._dp._time - this._start) * this._ts), ratio;
    this._initted || _initTween(this, time);
    ratio = this._ease(time / this._dur);
    if (_updatePropTweens(this, property, value, start, startIsRelative, ratio, time, skipRecursion)) {
      return this.resetTo(property, value, start, startIsRelative, 1);
    }
    _alignPlayhead(this, 0);
    this.parent || _addLinkedListItem(this._dp, this, "_first", "_last", this._dp._sort ? "_start" : 0);
    return this.render(0);
  };
  _proto3.kill = function kill(targets, vars) {
    if (vars === void 0) {
      vars = "all";
    }
    if (!targets && (!vars || vars === "all")) {
      this._lazy = this._pt = 0;
      this.parent ? _interrupt$1(this) : this.scrollTrigger && this.scrollTrigger.kill(!!_reverting$1);
      return this;
    }
    if (this.timeline) {
      var tDur = this.timeline.totalDuration();
      this.timeline.killTweensOf(targets, vars, _overwritingTween && _overwritingTween.vars.overwrite !== true)._first || _interrupt$1(this);
      this.parent && tDur !== this.timeline.totalDuration() && _setDuration(this, this._dur * this.timeline._tDur / tDur, 0, 1);
      return this;
    }
    var parsedTargets = this._targets, killingTargets = targets ? toArray(targets) : parsedTargets, propTweenLookup = this._ptLookup, firstPT = this._pt, overwrittenProps, curLookup, curOverwriteProps, props, p, pt, i;
    if ((!vars || vars === "all") && _arraysMatch(parsedTargets, killingTargets)) {
      vars === "all" && (this._pt = 0);
      return _interrupt$1(this);
    }
    overwrittenProps = this._op = this._op || [];
    if (vars !== "all") {
      if (_isString(vars)) {
        p = {};
        _forEachName(vars, function(name) {
          return p[name] = 1;
        });
        vars = p;
      }
      vars = _addAliasesToVars(parsedTargets, vars);
    }
    i = parsedTargets.length;
    while (i--) {
      if (~killingTargets.indexOf(parsedTargets[i])) {
        curLookup = propTweenLookup[i];
        if (vars === "all") {
          overwrittenProps[i] = vars;
          props = curLookup;
          curOverwriteProps = {};
        } else {
          curOverwriteProps = overwrittenProps[i] = overwrittenProps[i] || {};
          props = vars;
        }
        for (p in props) {
          pt = curLookup && curLookup[p];
          if (pt) {
            if (!("kill" in pt.d) || pt.d.kill(p) === true) {
              _removeLinkedListItem(this, pt, "_pt");
            }
            delete curLookup[p];
          }
          if (curOverwriteProps !== "all") {
            curOverwriteProps[p] = 1;
          }
        }
      }
    }
    this._initted && !this._pt && firstPT && _interrupt$1(this);
    return this;
  };
  Tween2.to = function to(targets, vars) {
    return new Tween2(targets, vars, arguments[2]);
  };
  Tween2.from = function from(targets, vars) {
    return _createTweenType(1, arguments);
  };
  Tween2.delayedCall = function delayedCall(delay, callback, params, scope) {
    return new Tween2(callback, 0, {
      immediateRender: false,
      lazy: false,
      overwrite: false,
      delay,
      onComplete: callback,
      onReverseComplete: callback,
      onCompleteParams: params,
      onReverseCompleteParams: params,
      callbackScope: scope
    });
  };
  Tween2.fromTo = function fromTo(targets, fromVars, toVars) {
    return _createTweenType(2, arguments);
  };
  Tween2.set = function set(targets, vars) {
    vars.duration = 0;
    vars.repeatDelay || (vars.repeat = 0);
    return new Tween2(targets, vars);
  };
  Tween2.killTweensOf = function killTweensOf(targets, props, onlyActive) {
    return _globalTimeline.killTweensOf(targets, props, onlyActive);
  };
  return Tween2;
})(Animation);
_setDefaults(Tween.prototype, {
  _targets: [],
  _lazy: 0,
  _startAt: 0,
  _op: 0,
  _onInit: 0
});
_forEachName("staggerTo,staggerFrom,staggerFromTo", function(name) {
  Tween[name] = function() {
    var tl = new Timeline(), params = _slice.call(arguments, 0);
    params.splice(name === "staggerFromTo" ? 5 : 4, 0, 0);
    return tl[name].apply(tl, params);
  };
});
var _setterPlain = function _setterPlain2(target, property, value) {
  return target[property] = value;
}, _setterFunc = function _setterFunc2(target, property, value) {
  return target[property](value);
}, _setterFuncWithParam = function _setterFuncWithParam2(target, property, value, data) {
  return target[property](data.fp, value);
}, _setterAttribute = function _setterAttribute2(target, property, value) {
  return target.setAttribute(property, value);
}, _getSetter = function _getSetter2(target, property) {
  return _isFunction(target[property]) ? _setterFunc : _isUndefined(target[property]) && target.setAttribute ? _setterAttribute : _setterPlain;
}, _renderPlain = function _renderPlain2(ratio, data) {
  return data.set(data.t, data.p, Math.round((data.s + data.c * ratio) * 1e6) / 1e6, data);
}, _renderBoolean = function _renderBoolean2(ratio, data) {
  return data.set(data.t, data.p, !!(data.s + data.c * ratio), data);
}, _renderComplexString = function _renderComplexString2(ratio, data) {
  var pt = data._pt, s = "";
  if (!ratio && data.b) {
    s = data.b;
  } else if (ratio === 1 && data.e) {
    s = data.e;
  } else {
    while (pt) {
      s = pt.p + (pt.m ? pt.m(pt.s + pt.c * ratio) : Math.round((pt.s + pt.c * ratio) * 1e4) / 1e4) + s;
      pt = pt._next;
    }
    s += data.c;
  }
  data.set(data.t, data.p, s, data);
}, _renderPropTweens = function _renderPropTweens2(ratio, data) {
  var pt = data._pt;
  while (pt) {
    pt.r(ratio, pt.d);
    pt = pt._next;
  }
}, _addPluginModifier = function _addPluginModifier2(modifier, tween, target, property) {
  var pt = this._pt, next;
  while (pt) {
    next = pt._next;
    pt.p === property && pt.modifier(modifier, tween, target);
    pt = next;
  }
}, _killPropTweensOf = function _killPropTweensOf2(property) {
  var pt = this._pt, hasNonDependentRemaining, next;
  while (pt) {
    next = pt._next;
    if (pt.p === property && !pt.op || pt.op === property) {
      _removeLinkedListItem(this, pt, "_pt");
    } else if (!pt.dep) {
      hasNonDependentRemaining = 1;
    }
    pt = next;
  }
  return !hasNonDependentRemaining;
}, _setterWithModifier = function _setterWithModifier2(target, property, value, data) {
  data.mSet(target, property, data.m.call(data.tween, value, data.mt), data);
}, _sortPropTweensByPriority = function _sortPropTweensByPriority2(parent) {
  var pt = parent._pt, next, pt2, first, last;
  while (pt) {
    next = pt._next;
    pt2 = first;
    while (pt2 && pt2.pr > pt.pr) {
      pt2 = pt2._next;
    }
    if (pt._prev = pt2 ? pt2._prev : last) {
      pt._prev._next = pt;
    } else {
      first = pt;
    }
    if (pt._next = pt2) {
      pt2._prev = pt;
    } else {
      last = pt;
    }
    pt = next;
  }
  parent._pt = first;
};
var PropTween = /* @__PURE__ */ (function() {
  function PropTween2(next, target, prop, start, change, renderer, data, setter, priority) {
    this.t = target;
    this.s = start;
    this.c = change;
    this.p = prop;
    this.r = renderer || _renderPlain;
    this.d = data || this;
    this.set = setter || _setterPlain;
    this.pr = priority || 0;
    this._next = next;
    if (next) {
      next._prev = this;
    }
  }
  var _proto4 = PropTween2.prototype;
  _proto4.modifier = function modifier(func, tween, target) {
    this.mSet = this.mSet || this.set;
    this.set = _setterWithModifier;
    this.m = func;
    this.mt = target;
    this.tween = tween;
  };
  return PropTween2;
})();
_forEachName(_callbackNames + "parent,duration,ease,delay,overwrite,runBackwards,startAt,yoyo,immediateRender,repeat,repeatDelay,data,paused,reversed,lazy,callbackScope,stringFilter,id,yoyoEase,stagger,inherit,repeatRefresh,keyframes,autoRevert,scrollTrigger,easeReverse", function(name) {
  return _reservedProps[name] = 1;
});
_globals.TweenMax = _globals.TweenLite = Tween;
_globals.TimelineLite = _globals.TimelineMax = Timeline;
_globalTimeline = new Timeline({
  sortChildren: false,
  defaults: _defaults,
  autoRemoveChildren: true,
  id: "root",
  smoothChildTiming: true
});
_config.stringFilter = _colorStringFilter;
var _media = [], _listeners = {}, _emptyArray = [], _lastMediaTime = 0, _contextID = 0, _dispatch = function _dispatch2(type) {
  return (_listeners[type] || _emptyArray).map(function(f) {
    return f();
  });
}, _onMediaChange = function _onMediaChange2() {
  var time = Date.now(), matches = [];
  if (time - _lastMediaTime > 2) {
    _dispatch("matchMediaInit");
    _media.forEach(function(c) {
      var queries = c.queries, conditions = c.conditions, match, p, anyMatch, toggled;
      for (p in queries) {
        match = _win$2.matchMedia(queries[p]).matches;
        match && (anyMatch = 1);
        if (match !== conditions[p]) {
          conditions[p] = match;
          toggled = 1;
        }
      }
      if (toggled) {
        c.revert();
        anyMatch && matches.push(c);
      }
    });
    _dispatch("matchMediaRevert");
    matches.forEach(function(c) {
      return c.onMatch(c, function(func) {
        return c.add(null, func);
      });
    });
    _lastMediaTime = time;
    _dispatch("matchMedia");
  }
};
var Context = /* @__PURE__ */ (function() {
  function Context2(func, scope) {
    this.selector = scope && selector(scope);
    this.data = [];
    this._r = [];
    this.isReverted = false;
    this.id = _contextID++;
    func && this.add(func);
  }
  var _proto5 = Context2.prototype;
  _proto5.add = function add(name, func, scope) {
    if (_isFunction(name)) {
      scope = func;
      func = name;
      name = _isFunction;
    }
    var self = this, f = function f2() {
      var prev = _context, prevSelector = self.selector, result;
      prev && prev !== self && prev.data.push(self);
      scope && (self.selector = selector(scope));
      _context = self;
      result = func.apply(self, arguments);
      _isFunction(result) && self._r.push(result);
      _context = prev;
      self.selector = prevSelector;
      self.isReverted = false;
      return result;
    };
    self.last = f;
    return name === _isFunction ? f(self, function(func2) {
      return self.add(null, func2);
    }) : name ? self[name] = f : f;
  };
  _proto5.ignore = function ignore(func) {
    var prev = _context;
    _context = null;
    func(this);
    _context = prev;
  };
  _proto5.getTweens = function getTweens() {
    var a = [];
    this.data.forEach(function(e) {
      return e instanceof Context2 ? a.push.apply(a, e.getTweens()) : e instanceof Tween && !(e.parent && e.parent.data === "nested") && a.push(e);
    });
    return a;
  };
  _proto5.clear = function clear() {
    this._r.length = this.data.length = 0;
  };
  _proto5.kill = function kill(revert, matchMedia2) {
    var _this4 = this;
    if (revert) {
      (function() {
        var tweens = _this4.getTweens(), i2 = _this4.data.length, t;
        while (i2--) {
          t = _this4.data[i2];
          if (t.data === "isFlip") {
            t.revert();
            t.getChildren(true, true, false).forEach(function(tween) {
              return tweens.splice(tweens.indexOf(tween), 1);
            });
          }
        }
        tweens.map(function(t2) {
          return {
            g: t2._dur || t2._delay || t2._sat && !t2._sat.vars.immediateRender ? t2.globalTime(0) : -Infinity,
            t: t2
          };
        }).sort(function(a, b) {
          return b.g - a.g || -Infinity;
        }).forEach(function(o) {
          return o.t.revert(revert);
        });
        i2 = _this4.data.length;
        while (i2--) {
          t = _this4.data[i2];
          if (t instanceof Timeline) {
            if (t.data !== "nested") {
              t.scrollTrigger && t.scrollTrigger.revert();
              t.kill();
            }
          } else {
            !(t instanceof Tween) && t.revert && t.revert(revert);
          }
        }
        _this4._r.forEach(function(f) {
          return f(revert, _this4);
        });
        _this4.isReverted = true;
      })();
    } else {
      this.data.forEach(function(e) {
        return e.kill && e.kill();
      });
    }
    this.clear();
    if (matchMedia2) {
      var i = _media.length;
      while (i--) {
        _media[i].id === this.id && _media.splice(i, 1);
      }
    }
  };
  _proto5.revert = function revert(config3) {
    this.kill(config3 || {});
  };
  return Context2;
})();
var MatchMedia = /* @__PURE__ */ (function() {
  function MatchMedia2(scope) {
    this.contexts = [];
    this.scope = scope;
    _context && _context.data.push(this);
  }
  var _proto6 = MatchMedia2.prototype;
  _proto6.add = function add(conditions, func, scope) {
    _isObject(conditions) || (conditions = {
      matches: conditions
    });
    var context3 = new Context(0, scope || this.scope), cond = context3.conditions = {}, mq, p, active;
    _context && !context3.selector && (context3.selector = _context.selector);
    this.contexts.push(context3);
    func = context3.add("onMatch", func);
    context3.queries = conditions;
    for (p in conditions) {
      if (p === "all") {
        active = 1;
      } else {
        mq = _win$2.matchMedia(conditions[p]);
        if (mq) {
          _media.indexOf(context3) < 0 && _media.push(context3);
          (cond[p] = mq.matches) && (active = 1);
          mq.addListener ? mq.addListener(_onMediaChange) : mq.addEventListener("change", _onMediaChange);
        }
      }
    }
    active && func(context3, function(f) {
      return context3.add(null, f);
    });
    return this;
  };
  _proto6.revert = function revert(config3) {
    this.kill(config3 || {});
  };
  _proto6.kill = function kill(revert) {
    this.contexts.forEach(function(c) {
      return c.kill(revert, true);
    });
  };
  return MatchMedia2;
})();
var _gsap = {
  registerPlugin: function registerPlugin() {
    for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      args[_key2] = arguments[_key2];
    }
    args.forEach(function(config3) {
      return _createPlugin(config3);
    });
  },
  timeline: function timeline(vars) {
    return new Timeline(vars);
  },
  getTweensOf: function getTweensOf(targets, onlyActive) {
    return _globalTimeline.getTweensOf(targets, onlyActive);
  },
  getProperty: function getProperty(target, property, unit, uncache) {
    _isString(target) && (target = toArray(target)[0]);
    var getter = _getCache(target || {}).get, format = unit ? _passThrough : _numericIfPossible;
    unit === "native" && (unit = "");
    return !target ? target : !property ? function(property2, unit2, uncache2) {
      return format((_plugins[property2] && _plugins[property2].get || getter)(target, property2, unit2, uncache2));
    } : format((_plugins[property] && _plugins[property].get || getter)(target, property, unit, uncache));
  },
  quickSetter: function quickSetter(target, property, unit) {
    target = toArray(target);
    if (target.length > 1) {
      var setters = target.map(function(t) {
        return gsap$1.quickSetter(t, property, unit);
      }), l = setters.length;
      return function(value) {
        var i = l;
        while (i--) {
          setters[i](value);
        }
      };
    }
    target = target[0] || {};
    var Plugin = _plugins[property], cache = _getCache(target), p = cache.harness && (cache.harness.aliases || {})[property] || property, setter = Plugin ? function(value) {
      var p2 = new Plugin();
      _quickTween._pt = 0;
      p2.init(target, unit ? value + unit : value, _quickTween, 0, [target]);
      p2.render(1, p2);
      _quickTween._pt && _renderPropTweens(1, _quickTween);
    } : cache.set(target, p);
    return Plugin ? setter : function(value) {
      return setter(target, p, unit ? value + unit : value, cache, 1);
    };
  },
  quickTo: function quickTo(target, property, vars) {
    var _setDefaults22;
    var tween = gsap$1.to(target, _setDefaults((_setDefaults22 = {}, _setDefaults22[property] = "+=0.1", _setDefaults22.paused = true, _setDefaults22.stagger = 0, _setDefaults22), vars || {})), func = function func2(value, start, startIsRelative) {
      return tween.resetTo(property, value, start, startIsRelative);
    };
    func.tween = tween;
    return func;
  },
  isTweening: function isTweening(targets) {
    return _globalTimeline.getTweensOf(targets, true).length > 0;
  },
  defaults: function defaults(value) {
    value && value.ease && (value.ease = _parseEase(value.ease, _defaults.ease));
    return _mergeDeep(_defaults, value || {});
  },
  config: function config2(value) {
    return _mergeDeep(_config, value || {});
  },
  registerEffect: function registerEffect(_ref3) {
    var name = _ref3.name, effect = _ref3.effect, plugins = _ref3.plugins, defaults2 = _ref3.defaults, extendTimeline = _ref3.extendTimeline;
    (plugins || "").split(",").forEach(function(pluginName) {
      return pluginName && !_plugins[pluginName] && !_globals[pluginName] && _warn(name + " effect requires " + pluginName + " plugin.");
    });
    _effects[name] = function(targets, vars, tl) {
      return effect(toArray(targets), _setDefaults(vars || {}, defaults2), tl);
    };
    if (extendTimeline) {
      Timeline.prototype[name] = function(targets, vars, position) {
        return this.add(_effects[name](targets, _isObject(vars) ? vars : (position = vars) && {}, this), position);
      };
    }
  },
  registerEase: function registerEase(name, ease) {
    _easeMap[name] = _parseEase(ease);
  },
  parseEase: function parseEase(ease, defaultEase) {
    return arguments.length ? _parseEase(ease, defaultEase) : _easeMap;
  },
  getById: function getById(id) {
    return _globalTimeline.getById(id);
  },
  exportRoot: function exportRoot(vars, includeDelayedCalls) {
    if (vars === void 0) {
      vars = {};
    }
    var tl = new Timeline(vars), child, next;
    tl.smoothChildTiming = _isNotFalse(vars.smoothChildTiming);
    _globalTimeline.remove(tl);
    tl._dp = 0;
    tl._time = tl._tTime = _globalTimeline._time;
    child = _globalTimeline._first;
    while (child) {
      next = child._next;
      if (includeDelayedCalls || !(!child._dur && child instanceof Tween && child.vars.onComplete === child._targets[0])) {
        _addToTimeline(tl, child, child._start - child._delay);
      }
      child = next;
    }
    _addToTimeline(_globalTimeline, tl, 0);
    return tl;
  },
  context: function context(func, scope) {
    return func ? new Context(func, scope) : _context;
  },
  matchMedia: function matchMedia(scope) {
    return new MatchMedia(scope);
  },
  matchMediaRefresh: function matchMediaRefresh() {
    return _media.forEach(function(c) {
      var cond = c.conditions, found, p;
      for (p in cond) {
        if (cond[p]) {
          cond[p] = false;
          found = 1;
        }
      }
      found && c.revert();
    }) || _onMediaChange();
  },
  addEventListener: function addEventListener2(type, callback) {
    var a = _listeners[type] || (_listeners[type] = []);
    ~a.indexOf(callback) || a.push(callback);
  },
  removeEventListener: function removeEventListener(type, callback) {
    var a = _listeners[type], i = a && a.indexOf(callback);
    i >= 0 && a.splice(i, 1);
  },
  utils: {
    wrap,
    wrapYoyo,
    distribute,
    random,
    snap,
    normalize,
    getUnit,
    clamp,
    splitColor,
    toArray,
    selector,
    mapRange,
    pipe,
    unitize,
    interpolate,
    shuffle
  },
  install: _install,
  effects: _effects,
  ticker: _ticker,
  updateRoot: Timeline.updateRoot,
  plugins: _plugins,
  globalTimeline: _globalTimeline,
  core: {
    PropTween,
    globals: _addGlobal,
    Tween,
    Timeline,
    Animation,
    getCache: _getCache,
    _removeLinkedListItem,
    reverting: function reverting() {
      return _reverting$1;
    },
    context: function context2(toAdd) {
      if (toAdd && _context) {
        _context.data.push(toAdd);
        toAdd._ctx = _context;
      }
      return _context;
    },
    suppressOverwrites: function suppressOverwrites(value) {
      return _suppressOverwrites = value;
    }
  }
};
_forEachName("to,from,fromTo,delayedCall,set,killTweensOf", function(name) {
  return _gsap[name] = Tween[name];
});
_ticker.add(Timeline.updateRoot);
_quickTween = _gsap.to({}, {
  duration: 0
});
var _getPluginPropTween = function _getPluginPropTween2(plugin, prop) {
  var pt = plugin._pt;
  while (pt && pt.p !== prop && pt.op !== prop && pt.fp !== prop) {
    pt = pt._next;
  }
  return pt;
}, _addModifiers = function _addModifiers2(tween, modifiers) {
  var targets = tween._targets, p, i, pt;
  for (p in modifiers) {
    i = targets.length;
    while (i--) {
      pt = tween._ptLookup[i][p];
      if (pt && (pt = pt.d)) {
        if (pt._pt) {
          pt = _getPluginPropTween(pt, p);
        }
        pt && pt.modifier && pt.modifier(modifiers[p], tween, targets[i], p);
      }
    }
  }
}, _buildModifierPlugin = function _buildModifierPlugin2(name, modifier) {
  return {
    name,
    headless: 1,
    rawVars: 1,
    //don't pre-process function-based values or "random()" strings.
    init: function init4(target, vars, tween) {
      tween._onInit = function(tween2) {
        var temp, p;
        if (_isString(vars)) {
          temp = {};
          _forEachName(vars, function(name2) {
            return temp[name2] = 1;
          });
          vars = temp;
        }
        if (modifier) {
          temp = {};
          for (p in vars) {
            temp[p] = modifier(vars[p]);
          }
          vars = temp;
        }
        _addModifiers(tween2, vars);
      };
    }
  };
};
var gsap$1 = _gsap.registerPlugin({
  name: "attr",
  init: function init(target, vars, tween, index, targets) {
    var p, pt, v;
    this.tween = tween;
    for (p in vars) {
      v = target.getAttribute(p) || "";
      pt = this.add(target, "setAttribute", (v || 0) + "", vars[p], index, targets, 0, 0, p);
      pt.op = p;
      pt.b = v;
      this._props.push(p);
    }
  },
  render: function render2(ratio, data) {
    var pt = data._pt;
    while (pt) {
      _reverting$1 ? pt.set(pt.t, pt.p, pt.b, pt) : pt.r(ratio, pt.d);
      pt = pt._next;
    }
  }
}, {
  name: "endArray",
  headless: 1,
  init: function init2(target, value) {
    var i = value.length;
    while (i--) {
      this.add(target, i, target[i] || 0, value[i], 0, 0, 0, 0, 0, 1);
    }
  }
}, _buildModifierPlugin("roundProps", _roundModifier), _buildModifierPlugin("modifiers"), _buildModifierPlugin("snap", snap)) || _gsap;
Tween.version = Timeline.version = gsap$1.version = "3.15.0";
_coreReady = 1;
_windowExists$1() && _wake();
_easeMap.Power0;
_easeMap.Power1;
_easeMap.Power2;
_easeMap.Power3;
_easeMap.Power4;
_easeMap.Linear;
_easeMap.Quad;
_easeMap.Cubic;
_easeMap.Quart;
_easeMap.Quint;
_easeMap.Strong;
_easeMap.Elastic;
_easeMap.Back;
_easeMap.SteppedEase;
_easeMap.Bounce;
_easeMap.Sine;
_easeMap.Expo;
_easeMap.Circ;
/*!
 * CSSPlugin 3.15.0
 * https://gsap.com
 *
 * Copyright 2008-2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license
 * @author: Jack Doyle, jack@greensock.com
*/
var _win$1, _doc$1, _docElement$1, _pluginInitted, _tempDiv, _recentSetterPlugin, _reverting, _windowExists2 = function _windowExists3() {
  return typeof window !== "undefined";
}, _transformProps = {}, _RAD2DEG$1 = 180 / Math.PI, _DEG2RAD$1 = Math.PI / 180, _atan2 = Math.atan2, _bigNum = 1e8, _capsExp = /([A-Z])/g, _horizontalExp = /(left|right|width|margin|padding|x)/i, _complexExp = /[\s,\(]\S/, _propertyAliases = {
  autoAlpha: "opacity,visibility",
  scale: "scaleX,scaleY",
  alpha: "opacity"
}, _renderCSSProp = function _renderCSSProp2(ratio, data) {
  return data.set(data.t, data.p, Math.round((data.s + data.c * ratio) * 1e4) / 1e4 + data.u, data);
}, _renderPropWithEnd = function _renderPropWithEnd2(ratio, data) {
  return data.set(data.t, data.p, ratio === 1 ? data.e : Math.round((data.s + data.c * ratio) * 1e4) / 1e4 + data.u, data);
}, _renderCSSPropWithBeginning = function _renderCSSPropWithBeginning2(ratio, data) {
  return data.set(data.t, data.p, ratio ? Math.round((data.s + data.c * ratio) * 1e4) / 1e4 + data.u : data.b, data);
}, _renderCSSPropWithBeginningAndEnd = function _renderCSSPropWithBeginningAndEnd2(ratio, data) {
  return data.set(data.t, data.p, ratio === 1 ? data.e : ratio ? Math.round((data.s + data.c * ratio) * 1e4) / 1e4 + data.u : data.b, data);
}, _renderRoundedCSSProp = function _renderRoundedCSSProp2(ratio, data) {
  var value = data.s + data.c * ratio;
  data.set(data.t, data.p, ~~(value + (value < 0 ? -0.5 : 0.5)) + data.u, data);
}, _renderNonTweeningValue = function _renderNonTweeningValue2(ratio, data) {
  return data.set(data.t, data.p, ratio ? data.e : data.b, data);
}, _renderNonTweeningValueOnlyAtEnd = function _renderNonTweeningValueOnlyAtEnd2(ratio, data) {
  return data.set(data.t, data.p, ratio !== 1 ? data.b : data.e, data);
}, _setterCSSStyle = function _setterCSSStyle2(target, property, value) {
  return target.style[property] = value;
}, _setterCSSProp = function _setterCSSProp2(target, property, value) {
  return target.style.setProperty(property, value);
}, _setterTransform = function _setterTransform2(target, property, value) {
  return target._gsap[property] = value;
}, _setterScale = function _setterScale2(target, property, value) {
  return target._gsap.scaleX = target._gsap.scaleY = value;
}, _setterScaleWithRender = function _setterScaleWithRender2(target, property, value, data, ratio) {
  var cache = target._gsap;
  cache.scaleX = cache.scaleY = value;
  cache.renderTransform(ratio, cache);
}, _setterTransformWithRender = function _setterTransformWithRender2(target, property, value, data, ratio) {
  var cache = target._gsap;
  cache[property] = value;
  cache.renderTransform(ratio, cache);
}, _transformProp$1 = "transform", _transformOriginProp$1 = _transformProp$1 + "Origin", _saveStyle = function _saveStyle2(property, isNotCSS) {
  var _this = this;
  var target = this.target, style2 = target.style, cache = target._gsap;
  if (property in _transformProps && style2) {
    this.tfm = this.tfm || {};
    if (property !== "transform") {
      property = _propertyAliases[property] || property;
      ~property.indexOf(",") ? property.split(",").forEach(function(a) {
        return _this.tfm[a] = _get(target, a);
      }) : this.tfm[property] = cache.x ? cache[property] : _get(target, property);
      property === _transformOriginProp$1 && (this.tfm.zOrigin = cache.zOrigin);
    } else {
      return _propertyAliases.transform.split(",").forEach(function(p) {
        return _saveStyle2.call(_this, p, isNotCSS);
      });
    }
    if (this.props.indexOf(_transformProp$1) >= 0) {
      return;
    }
    if (cache.svg) {
      this.svgo = target.getAttribute("data-svg-origin");
      this.props.push(_transformOriginProp$1, isNotCSS, "");
    }
    property = _transformProp$1;
  }
  (style2 || isNotCSS) && this.props.push(property, isNotCSS, style2[property]);
}, _removeIndependentTransforms = function _removeIndependentTransforms2(style2) {
  if (style2.translate) {
    style2.removeProperty("translate");
    style2.removeProperty("scale");
    style2.removeProperty("rotate");
  }
}, _revertStyle = function _revertStyle2() {
  var props = this.props, target = this.target, style2 = target.style, cache = target._gsap, i, p;
  for (i = 0; i < props.length; i += 3) {
    if (!props[i + 1]) {
      props[i + 2] ? style2[props[i]] = props[i + 2] : style2.removeProperty(props[i].substr(0, 2) === "--" ? props[i] : props[i].replace(_capsExp, "-$1").toLowerCase());
    } else if (props[i + 1] === 2) {
      target[props[i]](props[i + 2]);
    } else {
      target[props[i]] = props[i + 2];
    }
  }
  if (this.tfm) {
    for (p in this.tfm) {
      cache[p] = this.tfm[p];
    }
    if (cache.svg) {
      cache.renderTransform();
      target.setAttribute("data-svg-origin", this.svgo || "");
    }
    i = _reverting();
    if ((!i || !i.isStart) && !style2[_transformProp$1]) {
      _removeIndependentTransforms(style2);
      if (cache.zOrigin && style2[_transformOriginProp$1]) {
        style2[_transformOriginProp$1] += " " + cache.zOrigin + "px";
        cache.zOrigin = 0;
        cache.renderTransform();
      }
      cache.uncache = 1;
    }
  }
}, _getStyleSaver$1 = function _getStyleSaver(target, properties) {
  var saver = {
    target,
    props: [],
    revert: _revertStyle,
    save: _saveStyle
  };
  target._gsap || gsap$1.core.getCache(target);
  properties && target.style && target.nodeType && properties.split(",").forEach(function(p) {
    return saver.save(p);
  });
  return saver;
}, _supports3D, _createElement = function _createElement2(type, ns) {
  var e = _doc$1.createElementNS ? _doc$1.createElementNS((ns || "http://www.w3.org/1999/xhtml").replace(/^https/, "http"), type) : _doc$1.createElement(type);
  return e && e.style ? e : _doc$1.createElement(type);
}, _getComputedProperty = function _getComputedProperty2(target, property, skipPrefixFallback) {
  var cs = getComputedStyle(target);
  return cs[property] || cs.getPropertyValue(property.replace(_capsExp, "-$1").toLowerCase()) || cs.getPropertyValue(property) || !skipPrefixFallback && _getComputedProperty2(target, _checkPropPrefix(property) || property, 1) || "";
}, _prefixes = "O,Moz,ms,Ms,Webkit".split(","), _checkPropPrefix = function _checkPropPrefix2(property, element, preferPrefix) {
  var e = element || _tempDiv, s = e.style, i = 5;
  if (property in s && !preferPrefix) {
    return property;
  }
  property = property.charAt(0).toUpperCase() + property.substr(1);
  while (i-- && !(_prefixes[i] + property in s)) {
  }
  return i < 0 ? null : (i === 3 ? "ms" : i >= 0 ? _prefixes[i] : "") + property;
}, _initCore = function _initCore2() {
  if (_windowExists2() && window.document) {
    _win$1 = window;
    _doc$1 = _win$1.document;
    _docElement$1 = _doc$1.documentElement;
    _tempDiv = _createElement("div") || {
      style: {}
    };
    _createElement("div");
    _transformProp$1 = _checkPropPrefix(_transformProp$1);
    _transformOriginProp$1 = _transformProp$1 + "Origin";
    _tempDiv.style.cssText = "border-width:0;line-height:0;position:absolute;padding:0";
    _supports3D = !!_checkPropPrefix("perspective");
    _reverting = gsap$1.core.reverting;
    _pluginInitted = 1;
  }
}, _getReparentedCloneBBox = function _getReparentedCloneBBox2(target) {
  var owner = target.ownerSVGElement, svg = _createElement("svg", owner && owner.getAttribute("xmlns") || "http://www.w3.org/2000/svg"), clone = target.cloneNode(true), bbox;
  clone.style.display = "block";
  svg.appendChild(clone);
  _docElement$1.appendChild(svg);
  try {
    bbox = clone.getBBox();
  } catch (e) {
  }
  svg.removeChild(clone);
  _docElement$1.removeChild(svg);
  return bbox;
}, _getAttributeFallbacks = function _getAttributeFallbacks2(target, attributesArray) {
  var i = attributesArray.length;
  while (i--) {
    if (target.hasAttribute(attributesArray[i])) {
      return target.getAttribute(attributesArray[i]);
    }
  }
}, _getBBox = function _getBBox2(target) {
  var bounds, cloned;
  try {
    bounds = target.getBBox();
  } catch (error) {
    bounds = _getReparentedCloneBBox(target);
    cloned = 1;
  }
  bounds && (bounds.width || bounds.height) || cloned || (bounds = _getReparentedCloneBBox(target));
  return bounds && !bounds.width && !bounds.x && !bounds.y ? {
    x: +_getAttributeFallbacks(target, ["x", "cx", "x1"]) || 0,
    y: +_getAttributeFallbacks(target, ["y", "cy", "y1"]) || 0,
    width: 0,
    height: 0
  } : bounds;
}, _isSVG = function _isSVG2(e) {
  return !!(e.getCTM && (!e.parentNode || e.ownerSVGElement) && _getBBox(e));
}, _removeProperty = function _removeProperty2(target, property) {
  if (property) {
    var style2 = target.style, first2Chars;
    if (property in _transformProps && property !== _transformOriginProp$1) {
      property = _transformProp$1;
    }
    if (style2.removeProperty) {
      first2Chars = property.substr(0, 2);
      if (first2Chars === "ms" || property.substr(0, 6) === "webkit") {
        property = "-" + property;
      }
      style2.removeProperty(first2Chars === "--" ? property : property.replace(_capsExp, "-$1").toLowerCase());
    } else {
      style2.removeAttribute(property);
    }
  }
}, _addNonTweeningPT = function _addNonTweeningPT2(plugin, target, property, beginning, end, onlySetAtEnd) {
  var pt = new PropTween(plugin._pt, target, property, 0, 1, onlySetAtEnd ? _renderNonTweeningValueOnlyAtEnd : _renderNonTweeningValue);
  plugin._pt = pt;
  pt.b = beginning;
  pt.e = end;
  plugin._props.push(property);
  return pt;
}, _nonConvertibleUnits = {
  deg: 1,
  rad: 1,
  turn: 1
}, _nonStandardLayouts = {
  grid: 1,
  flex: 1
}, _convertToUnit = function _convertToUnit2(target, property, value, unit) {
  var curValue = parseFloat(value) || 0, curUnit = (value + "").trim().substr((curValue + "").length) || "px", style2 = _tempDiv.style, horizontal = _horizontalExp.test(property), isRootSVG = target.tagName.toLowerCase() === "svg", measureProperty = (isRootSVG ? "client" : "offset") + (horizontal ? "Width" : "Height"), amount = 100, toPixels = unit === "px", toPercent = unit === "%", px, parent, cache, isSVG;
  if (unit === curUnit || !curValue || _nonConvertibleUnits[unit] || _nonConvertibleUnits[curUnit]) {
    return curValue;
  }
  curUnit !== "px" && !toPixels && (curValue = _convertToUnit2(target, property, value, "px"));
  isSVG = target.getCTM && _isSVG(target);
  if ((toPercent || curUnit === "%") && (_transformProps[property] || ~property.indexOf("adius"))) {
    px = isSVG ? target.getBBox()[horizontal ? "width" : "height"] : target[measureProperty];
    return _round$1(toPercent ? curValue / px * amount : curValue / 100 * px);
  }
  style2[horizontal ? "width" : "height"] = amount + (toPixels ? curUnit : unit);
  parent = unit !== "rem" && ~property.indexOf("adius") || unit === "em" && target.appendChild && !isRootSVG ? target : target.parentNode;
  if (isSVG) {
    parent = (target.ownerSVGElement || {}).parentNode;
  }
  if (!parent || parent === _doc$1 || !parent.appendChild) {
    parent = _doc$1.body;
  }
  cache = parent._gsap;
  if (cache && toPercent && cache.width && horizontal && cache.time === _ticker.time && !cache.uncache) {
    return _round$1(curValue / cache.width * amount);
  } else {
    if (toPercent && (property === "height" || property === "width")) {
      var v = target.style[property];
      target.style[property] = amount + unit;
      px = target[measureProperty];
      v ? target.style[property] = v : _removeProperty(target, property);
    } else {
      (toPercent || curUnit === "%") && !_nonStandardLayouts[_getComputedProperty(parent, "display")] && (style2.position = _getComputedProperty(target, "position"));
      parent === target && (style2.position = "static");
      parent.appendChild(_tempDiv);
      px = _tempDiv[measureProperty];
      parent.removeChild(_tempDiv);
      style2.position = "absolute";
    }
    if (horizontal && toPercent) {
      cache = _getCache(parent);
      cache.time = _ticker.time;
      cache.width = parent[measureProperty];
    }
  }
  return _round$1(toPixels ? px * curValue / amount : px && curValue ? amount / px * curValue : 0);
}, _get = function _get2(target, property, unit, uncache) {
  var value;
  _pluginInitted || _initCore();
  if (property in _propertyAliases && property !== "transform") {
    property = _propertyAliases[property];
    if (~property.indexOf(",")) {
      property = property.split(",")[0];
    }
  }
  if (_transformProps[property] && property !== "transform") {
    value = _parseTransform(target, uncache);
    value = property !== "transformOrigin" ? value[property] : value.svg ? value.origin : _firstTwoOnly(_getComputedProperty(target, _transformOriginProp$1)) + " " + value.zOrigin + "px";
  } else {
    value = target.style[property];
    if (!value || value === "auto" || uncache || ~(value + "").indexOf("calc(")) {
      value = _specialProps[property] && _specialProps[property](target, property, unit) || _getComputedProperty(target, property) || _getProperty(target, property) || (property === "opacity" ? 1 : 0);
    }
  }
  return unit && !~(value + "").trim().indexOf(" ") ? _convertToUnit(target, property, value, unit) + unit : value;
}, _tweenComplexCSSString = function _tweenComplexCSSString2(target, prop, start, end) {
  if (!start || start === "none") {
    var p = _checkPropPrefix(prop, target, 1), s = p && _getComputedProperty(target, p, 1);
    if (s && s !== start) {
      prop = p;
      start = s;
    } else if (prop === "borderColor") {
      start = _getComputedProperty(target, "borderTopColor");
    }
  }
  var pt = new PropTween(this._pt, target.style, prop, 0, 1, _renderComplexString), index = 0, matchIndex = 0, a, result, startValues, startNum, color, startValue, endValue, endNum, chunk, endUnit, startUnit, endValues;
  pt.b = start;
  pt.e = end;
  start += "";
  end += "";
  if (end.substring(0, 6) === "var(--") {
    end = _getComputedProperty(target, end.substring(4, end.indexOf(")")));
  }
  if (end === "auto") {
    startValue = target.style[prop];
    target.style[prop] = end;
    end = _getComputedProperty(target, prop) || end;
    startValue ? target.style[prop] = startValue : _removeProperty(target, prop);
  }
  a = [start, end];
  _colorStringFilter(a);
  start = a[0];
  end = a[1];
  startValues = start.match(_numWithUnitExp) || [];
  endValues = end.match(_numWithUnitExp) || [];
  if (endValues.length) {
    while (result = _numWithUnitExp.exec(end)) {
      endValue = result[0];
      chunk = end.substring(index, result.index);
      if (color) {
        color = (color + 1) % 5;
      } else if (chunk.substr(-5) === "rgba(" || chunk.substr(-5) === "hsla(") {
        color = 1;
      }
      if (endValue !== (startValue = startValues[matchIndex++] || "")) {
        startNum = parseFloat(startValue) || 0;
        startUnit = startValue.substr((startNum + "").length);
        endValue.charAt(1) === "=" && (endValue = _parseRelative(startNum, endValue) + startUnit);
        endNum = parseFloat(endValue);
        endUnit = endValue.substr((endNum + "").length);
        index = _numWithUnitExp.lastIndex - endUnit.length;
        if (!endUnit) {
          endUnit = endUnit || _config.units[prop] || startUnit;
          if (index === end.length) {
            end += endUnit;
            pt.e += endUnit;
          }
        }
        if (startUnit !== endUnit) {
          startNum = _convertToUnit(target, prop, startValue, endUnit) || 0;
        }
        pt._pt = {
          _next: pt._pt,
          p: chunk || matchIndex === 1 ? chunk : ",",
          //note: SVG spec allows omission of comma/space when a negative sign is wedged between two numbers, like 2.5-5.3 instead of 2.5,-5.3 but when tweening, the negative value may switch to positive, so we insert the comma just in case.
          s: startNum,
          c: endNum - startNum,
          m: color && color < 4 || prop === "zIndex" ? Math.round : 0
        };
      }
    }
    pt.c = index < end.length ? end.substring(index, end.length) : "";
  } else {
    pt.r = prop === "display" && end === "none" ? _renderNonTweeningValueOnlyAtEnd : _renderNonTweeningValue;
  }
  _relExp.test(end) && (pt.e = 0);
  this._pt = pt;
  return pt;
}, _keywordToPercent = {
  top: "0%",
  bottom: "100%",
  left: "0%",
  right: "100%",
  center: "50%"
}, _convertKeywordsToPercentages = function _convertKeywordsToPercentages2(value) {
  var split = value.split(" "), x = split[0], y = split[1] || "50%";
  if (x === "top" || x === "bottom" || y === "left" || y === "right") {
    value = x;
    x = y;
    y = value;
  }
  split[0] = _keywordToPercent[x] || x;
  split[1] = _keywordToPercent[y] || y;
  return split.join(" ");
}, _renderClearProps = function _renderClearProps2(ratio, data) {
  if (data.tween && data.tween._time === data.tween._dur) {
    var target = data.t, style2 = target.style, props = data.u, cache = target._gsap, prop, clearTransforms, i;
    if (props === "all" || props === true) {
      style2.cssText = "";
      clearTransforms = 1;
    } else {
      props = props.split(",");
      i = props.length;
      while (--i > -1) {
        prop = props[i];
        if (_transformProps[prop]) {
          clearTransforms = 1;
          prop = prop === "transformOrigin" ? _transformOriginProp$1 : _transformProp$1;
        }
        _removeProperty(target, prop);
      }
    }
    if (clearTransforms) {
      _removeProperty(target, _transformProp$1);
      if (cache) {
        cache.svg && target.removeAttribute("transform");
        style2.scale = style2.rotate = style2.translate = "none";
        _parseTransform(target, 1);
        cache.uncache = 1;
        _removeIndependentTransforms(style2);
      }
    }
  }
}, _specialProps = {
  clearProps: function clearProps(plugin, target, property, endValue, tween) {
    if (tween.data !== "isFromStart") {
      var pt = plugin._pt = new PropTween(plugin._pt, target, property, 0, 0, _renderClearProps);
      pt.u = endValue;
      pt.pr = -10;
      pt.tween = tween;
      plugin._props.push(property);
      return 1;
    }
  }
  /* className feature (about 0.4kb gzipped).
  , className(plugin, target, property, endValue, tween) {
  	let _renderClassName = (ratio, data) => {
  			data.css.render(ratio, data.css);
  			if (!ratio || ratio === 1) {
  				let inline = data.rmv,
  					target = data.t,
  					p;
  				target.setAttribute("class", ratio ? data.e : data.b);
  				for (p in inline) {
  					_removeProperty(target, p);
  				}
  			}
  		},
  		_getAllStyles = (target) => {
  			let styles = {},
  				computed = getComputedStyle(target),
  				p;
  			for (p in computed) {
  				if (isNaN(p) && p !== "cssText" && p !== "length") {
  					styles[p] = computed[p];
  				}
  			}
  			_setDefaults(styles, _parseTransform(target, 1));
  			return styles;
  		},
  		startClassList = target.getAttribute("class"),
  		style = target.style,
  		cssText = style.cssText,
  		cache = target._gsap,
  		classPT = cache.classPT,
  		inlineToRemoveAtEnd = {},
  		data = {t:target, plugin:plugin, rmv:inlineToRemoveAtEnd, b:startClassList, e:(endValue.charAt(1) !== "=") ? endValue : startClassList.replace(new RegExp("(?:\\s|^)" + endValue.substr(2) + "(?![\\w-])"), "") + ((endValue.charAt(0) === "+") ? " " + endValue.substr(2) : "")},
  		changingVars = {},
  		startVars = _getAllStyles(target),
  		transformRelated = /(transform|perspective)/i,
  		endVars, p;
  	if (classPT) {
  		classPT.r(1, classPT.d);
  		_removeLinkedListItem(classPT.d.plugin, classPT, "_pt");
  	}
  	target.setAttribute("class", data.e);
  	endVars = _getAllStyles(target, true);
  	target.setAttribute("class", startClassList);
  	for (p in endVars) {
  		if (endVars[p] !== startVars[p] && !transformRelated.test(p)) {
  			changingVars[p] = endVars[p];
  			if (!style[p] && style[p] !== "0") {
  				inlineToRemoveAtEnd[p] = 1;
  			}
  		}
  	}
  	cache.classPT = plugin._pt = new PropTween(plugin._pt, target, "className", 0, 0, _renderClassName, data, 0, -11);
  	if (style.cssText !== cssText) { //only apply if things change. Otherwise, in cases like a background-image that's pulled dynamically, it could cause a refresh. See https://gsap.com/forums/topic/20368-possible-gsap-bug-switching-classnames-in-chrome/.
  		style.cssText = cssText; //we recorded cssText before we swapped classes and ran _getAllStyles() because in cases when a className tween is overwritten, we remove all the related tweening properties from that class change (otherwise class-specific stuff can't override properties we've directly set on the target's style object due to specificity).
  	}
  	_parseTransform(target, true); //to clear the caching of transforms
  	data.css = new gsap.plugins.css();
  	data.css.init(target, changingVars, tween);
  	plugin._props.push(...data.css._props);
  	return 1;
  }
  */
}, _identity2DMatrix = [1, 0, 0, 1, 0, 0], _rotationalProperties = {}, _isNullTransform = function _isNullTransform2(value) {
  return value === "matrix(1, 0, 0, 1, 0, 0)" || value === "none" || !value;
}, _getComputedTransformMatrixAsArray = function _getComputedTransformMatrixAsArray2(target) {
  var matrixString = _getComputedProperty(target, _transformProp$1);
  return _isNullTransform(matrixString) ? _identity2DMatrix : matrixString.substr(7).match(_numExp).map(_round$1);
}, _getMatrix = function _getMatrix2(target, force2D) {
  var cache = target._gsap || _getCache(target), style2 = target.style, matrix = _getComputedTransformMatrixAsArray(target), parent, nextSibling, temp, addedToDOM;
  if (cache.svg && target.getAttribute("transform")) {
    temp = target.transform.baseVal.consolidate().matrix;
    matrix = [temp.a, temp.b, temp.c, temp.d, temp.e, temp.f];
    return matrix.join(",") === "1,0,0,1,0,0" ? _identity2DMatrix : matrix;
  } else if (matrix === _identity2DMatrix && !target.offsetParent && target !== _docElement$1 && !cache.svg) {
    temp = style2.display;
    style2.display = "block";
    parent = target.parentNode;
    if (!parent || !target.offsetParent && !target.getBoundingClientRect().width) {
      addedToDOM = 1;
      nextSibling = target.nextElementSibling;
      _docElement$1.appendChild(target);
    }
    matrix = _getComputedTransformMatrixAsArray(target);
    temp ? style2.display = temp : _removeProperty(target, "display");
    if (addedToDOM) {
      nextSibling ? parent.insertBefore(target, nextSibling) : parent ? parent.appendChild(target) : _docElement$1.removeChild(target);
    }
  }
  return force2D && matrix.length > 6 ? [matrix[0], matrix[1], matrix[4], matrix[5], matrix[12], matrix[13]] : matrix;
}, _applySVGOrigin = function _applySVGOrigin2(target, origin, originIsAbsolute, smooth, matrixArray, pluginToAddPropTweensTo) {
  var cache = target._gsap, matrix = matrixArray || _getMatrix(target, true), xOriginOld = cache.xOrigin || 0, yOriginOld = cache.yOrigin || 0, xOffsetOld = cache.xOffset || 0, yOffsetOld = cache.yOffset || 0, a = matrix[0], b = matrix[1], c = matrix[2], d = matrix[3], tx = matrix[4], ty = matrix[5], originSplit = origin.split(" "), xOrigin = parseFloat(originSplit[0]) || 0, yOrigin = parseFloat(originSplit[1]) || 0, bounds, determinant, x, y;
  if (!originIsAbsolute) {
    bounds = _getBBox(target);
    xOrigin = bounds.x + (~originSplit[0].indexOf("%") ? xOrigin / 100 * bounds.width : xOrigin);
    yOrigin = bounds.y + (~(originSplit[1] || originSplit[0]).indexOf("%") ? yOrigin / 100 * bounds.height : yOrigin);
  } else if (matrix !== _identity2DMatrix && (determinant = a * d - b * c)) {
    x = xOrigin * (d / determinant) + yOrigin * (-c / determinant) + (c * ty - d * tx) / determinant;
    y = xOrigin * (-b / determinant) + yOrigin * (a / determinant) - (a * ty - b * tx) / determinant;
    xOrigin = x;
    yOrigin = y;
  }
  if (smooth || smooth !== false && cache.smooth) {
    tx = xOrigin - xOriginOld;
    ty = yOrigin - yOriginOld;
    cache.xOffset = xOffsetOld + (tx * a + ty * c) - tx;
    cache.yOffset = yOffsetOld + (tx * b + ty * d) - ty;
  } else {
    cache.xOffset = cache.yOffset = 0;
  }
  cache.xOrigin = xOrigin;
  cache.yOrigin = yOrigin;
  cache.smooth = !!smooth;
  cache.origin = origin;
  cache.originIsAbsolute = !!originIsAbsolute;
  target.style[_transformOriginProp$1] = "0px 0px";
  if (pluginToAddPropTweensTo) {
    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "xOrigin", xOriginOld, xOrigin);
    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "yOrigin", yOriginOld, yOrigin);
    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "xOffset", xOffsetOld, cache.xOffset);
    _addNonTweeningPT(pluginToAddPropTweensTo, cache, "yOffset", yOffsetOld, cache.yOffset);
  }
  target.setAttribute("data-svg-origin", xOrigin + " " + yOrigin);
}, _parseTransform = function _parseTransform2(target, uncache) {
  var cache = target._gsap || new GSCache(target);
  if ("x" in cache && !uncache && !cache.uncache) {
    return cache;
  }
  var style2 = target.style, invertedScaleX = cache.scaleX < 0, px = "px", deg = "deg", cs = getComputedStyle(target), origin = _getComputedProperty(target, _transformOriginProp$1) || "0", x, y, z, scaleX, scaleY, rotation, rotationX, rotationY, skewX, skewY, perspective, xOrigin, yOrigin, matrix, angle, cos, sin, a, b, c, d, a12, a22, t1, t2, t3, a13, a23, a33, a42, a43, a32;
  x = y = z = rotation = rotationX = rotationY = skewX = skewY = perspective = 0;
  scaleX = scaleY = 1;
  cache.svg = !!(target.getCTM && _isSVG(target));
  if (cs.translate) {
    if (cs.translate !== "none" || cs.scale !== "none" || cs.rotate !== "none") {
      style2[_transformProp$1] = (cs.translate !== "none" ? "translate3d(" + (cs.translate + " 0 0").split(" ").slice(0, 3).join(", ") + ") " : "") + (cs.rotate !== "none" ? "rotate(" + cs.rotate + ") " : "") + (cs.scale !== "none" ? "scale(" + cs.scale.split(" ").join(",") + ") " : "") + (cs[_transformProp$1] !== "none" ? cs[_transformProp$1] : "");
    }
    style2.scale = style2.rotate = style2.translate = "none";
  }
  matrix = _getMatrix(target, cache.svg);
  if (cache.svg) {
    if (cache.uncache) {
      t2 = target.getBBox();
      origin = cache.xOrigin - t2.x + "px " + (cache.yOrigin - t2.y) + "px";
      t1 = "";
    } else {
      t1 = !uncache && target.getAttribute("data-svg-origin");
    }
    _applySVGOrigin(target, t1 || origin, !!t1 || cache.originIsAbsolute, cache.smooth !== false, matrix);
  }
  xOrigin = cache.xOrigin || 0;
  yOrigin = cache.yOrigin || 0;
  if (matrix !== _identity2DMatrix) {
    a = matrix[0];
    b = matrix[1];
    c = matrix[2];
    d = matrix[3];
    x = a12 = matrix[4];
    y = a22 = matrix[5];
    if (matrix.length === 6) {
      scaleX = Math.sqrt(a * a + b * b);
      scaleY = Math.sqrt(d * d + c * c);
      rotation = a || b ? _atan2(b, a) * _RAD2DEG$1 : 0;
      skewX = c || d ? _atan2(c, d) * _RAD2DEG$1 + rotation : 0;
      skewX && (scaleY *= Math.abs(Math.cos(skewX * _DEG2RAD$1)));
      if (cache.svg) {
        x -= xOrigin - (xOrigin * a + yOrigin * c);
        y -= yOrigin - (xOrigin * b + yOrigin * d);
      }
    } else {
      a32 = matrix[6];
      a42 = matrix[7];
      a13 = matrix[8];
      a23 = matrix[9];
      a33 = matrix[10];
      a43 = matrix[11];
      x = matrix[12];
      y = matrix[13];
      z = matrix[14];
      angle = _atan2(a32, a33);
      rotationX = angle * _RAD2DEG$1;
      if (angle) {
        cos = Math.cos(-angle);
        sin = Math.sin(-angle);
        t1 = a12 * cos + a13 * sin;
        t2 = a22 * cos + a23 * sin;
        t3 = a32 * cos + a33 * sin;
        a13 = a12 * -sin + a13 * cos;
        a23 = a22 * -sin + a23 * cos;
        a33 = a32 * -sin + a33 * cos;
        a43 = a42 * -sin + a43 * cos;
        a12 = t1;
        a22 = t2;
        a32 = t3;
      }
      angle = _atan2(-c, a33);
      rotationY = angle * _RAD2DEG$1;
      if (angle) {
        cos = Math.cos(-angle);
        sin = Math.sin(-angle);
        t1 = a * cos - a13 * sin;
        t2 = b * cos - a23 * sin;
        t3 = c * cos - a33 * sin;
        a43 = d * sin + a43 * cos;
        a = t1;
        b = t2;
        c = t3;
      }
      angle = _atan2(b, a);
      rotation = angle * _RAD2DEG$1;
      if (angle) {
        cos = Math.cos(angle);
        sin = Math.sin(angle);
        t1 = a * cos + b * sin;
        t2 = a12 * cos + a22 * sin;
        b = b * cos - a * sin;
        a22 = a22 * cos - a12 * sin;
        a = t1;
        a12 = t2;
      }
      if (rotationX && Math.abs(rotationX) + Math.abs(rotation) > 359.9) {
        rotationX = rotation = 0;
        rotationY = 180 - rotationY;
      }
      scaleX = _round$1(Math.sqrt(a * a + b * b + c * c));
      scaleY = _round$1(Math.sqrt(a22 * a22 + a32 * a32));
      angle = _atan2(a12, a22);
      skewX = Math.abs(angle) > 2e-4 ? angle * _RAD2DEG$1 : 0;
      perspective = a43 ? 1 / (a43 < 0 ? -a43 : a43) : 0;
    }
    if (cache.svg) {
      t1 = target.getAttribute("transform");
      cache.forceCSS = target.setAttribute("transform", "") || !_isNullTransform(_getComputedProperty(target, _transformProp$1));
      t1 && target.setAttribute("transform", t1);
    }
  }
  if (Math.abs(skewX) > 90 && Math.abs(skewX) < 270) {
    if (invertedScaleX) {
      scaleX *= -1;
      skewX += rotation <= 0 ? 180 : -180;
      rotation += rotation <= 0 ? 180 : -180;
    } else {
      scaleY *= -1;
      skewX += skewX <= 0 ? 180 : -180;
    }
  }
  uncache = uncache || cache.uncache;
  cache.x = x - ((cache.xPercent = x && (!uncache && cache.xPercent || (Math.round(target.offsetWidth / 2) === Math.round(-x) ? -50 : 0))) ? target.offsetWidth * cache.xPercent / 100 : 0) + px;
  cache.y = y - ((cache.yPercent = y && (!uncache && cache.yPercent || (Math.round(target.offsetHeight / 2) === Math.round(-y) ? -50 : 0))) ? target.offsetHeight * cache.yPercent / 100 : 0) + px;
  cache.z = z + px;
  cache.scaleX = _round$1(scaleX);
  cache.scaleY = _round$1(scaleY);
  cache.rotation = _round$1(rotation) + deg;
  cache.rotationX = _round$1(rotationX) + deg;
  cache.rotationY = _round$1(rotationY) + deg;
  cache.skewX = skewX + deg;
  cache.skewY = skewY + deg;
  cache.transformPerspective = perspective + px;
  if (cache.zOrigin = parseFloat(origin.split(" ")[2]) || !uncache && cache.zOrigin || 0) {
    style2[_transformOriginProp$1] = _firstTwoOnly(origin);
  }
  cache.xOffset = cache.yOffset = 0;
  cache.force3D = _config.force3D;
  cache.renderTransform = cache.svg ? _renderSVGTransforms : _supports3D ? _renderCSSTransforms : _renderNon3DTransforms;
  cache.uncache = 0;
  return cache;
}, _firstTwoOnly = function _firstTwoOnly2(value) {
  return (value = value.split(" "))[0] + " " + value[1];
}, _addPxTranslate = function _addPxTranslate2(target, start, value) {
  var unit = getUnit(start);
  return _round$1(parseFloat(start) + parseFloat(_convertToUnit(target, "x", value + "px", unit))) + unit;
}, _renderNon3DTransforms = function _renderNon3DTransforms2(ratio, cache) {
  cache.z = "0px";
  cache.rotationY = cache.rotationX = "0deg";
  cache.force3D = 0;
  _renderCSSTransforms(ratio, cache);
}, _zeroDeg = "0deg", _zeroPx = "0px", _endParenthesis = ") ", _renderCSSTransforms = function _renderCSSTransforms2(ratio, cache) {
  var _ref = cache || this, xPercent = _ref.xPercent, yPercent = _ref.yPercent, x = _ref.x, y = _ref.y, z = _ref.z, rotation = _ref.rotation, rotationY = _ref.rotationY, rotationX = _ref.rotationX, skewX = _ref.skewX, skewY = _ref.skewY, scaleX = _ref.scaleX, scaleY = _ref.scaleY, transformPerspective = _ref.transformPerspective, force3D = _ref.force3D, target = _ref.target, zOrigin = _ref.zOrigin, transforms = "", use3D = force3D === "auto" && ratio && ratio !== 1 || force3D === true;
  if (zOrigin && (rotationX !== _zeroDeg || rotationY !== _zeroDeg)) {
    var angle = parseFloat(rotationY) * _DEG2RAD$1, a13 = Math.sin(angle), a33 = Math.cos(angle), cos;
    angle = parseFloat(rotationX) * _DEG2RAD$1;
    cos = Math.cos(angle);
    x = _addPxTranslate(target, x, a13 * cos * -zOrigin);
    y = _addPxTranslate(target, y, -Math.sin(angle) * -zOrigin);
    z = _addPxTranslate(target, z, a33 * cos * -zOrigin + zOrigin);
  }
  if (transformPerspective !== _zeroPx) {
    transforms += "perspective(" + transformPerspective + _endParenthesis;
  }
  if (xPercent || yPercent) {
    transforms += "translate(" + xPercent + "%, " + yPercent + "%) ";
  }
  if (use3D || x !== _zeroPx || y !== _zeroPx || z !== _zeroPx) {
    transforms += z !== _zeroPx || use3D ? "translate3d(" + x + ", " + y + ", " + z + ") " : "translate(" + x + ", " + y + _endParenthesis;
  }
  if (rotation !== _zeroDeg) {
    transforms += "rotate(" + rotation + _endParenthesis;
  }
  if (rotationY !== _zeroDeg) {
    transforms += "rotateY(" + rotationY + _endParenthesis;
  }
  if (rotationX !== _zeroDeg) {
    transforms += "rotateX(" + rotationX + _endParenthesis;
  }
  if (skewX !== _zeroDeg || skewY !== _zeroDeg) {
    transforms += "skew(" + skewX + ", " + skewY + _endParenthesis;
  }
  if (scaleX !== 1 || scaleY !== 1) {
    transforms += "scale(" + scaleX + ", " + scaleY + _endParenthesis;
  }
  target.style[_transformProp$1] = transforms || "translate(0, 0)";
}, _renderSVGTransforms = function _renderSVGTransforms2(ratio, cache) {
  var _ref2 = cache || this, xPercent = _ref2.xPercent, yPercent = _ref2.yPercent, x = _ref2.x, y = _ref2.y, rotation = _ref2.rotation, skewX = _ref2.skewX, skewY = _ref2.skewY, scaleX = _ref2.scaleX, scaleY = _ref2.scaleY, target = _ref2.target, xOrigin = _ref2.xOrigin, yOrigin = _ref2.yOrigin, xOffset = _ref2.xOffset, yOffset = _ref2.yOffset, forceCSS = _ref2.forceCSS, tx = parseFloat(x), ty = parseFloat(y), a11, a21, a12, a22, temp;
  rotation = parseFloat(rotation);
  skewX = parseFloat(skewX);
  skewY = parseFloat(skewY);
  if (skewY) {
    skewY = parseFloat(skewY);
    skewX += skewY;
    rotation += skewY;
  }
  if (rotation || skewX) {
    rotation *= _DEG2RAD$1;
    skewX *= _DEG2RAD$1;
    a11 = Math.cos(rotation) * scaleX;
    a21 = Math.sin(rotation) * scaleX;
    a12 = Math.sin(rotation - skewX) * -scaleY;
    a22 = Math.cos(rotation - skewX) * scaleY;
    if (skewX) {
      skewY *= _DEG2RAD$1;
      temp = Math.tan(skewX - skewY);
      temp = Math.sqrt(1 + temp * temp);
      a12 *= temp;
      a22 *= temp;
      if (skewY) {
        temp = Math.tan(skewY);
        temp = Math.sqrt(1 + temp * temp);
        a11 *= temp;
        a21 *= temp;
      }
    }
    a11 = _round$1(a11);
    a21 = _round$1(a21);
    a12 = _round$1(a12);
    a22 = _round$1(a22);
  } else {
    a11 = scaleX;
    a22 = scaleY;
    a21 = a12 = 0;
  }
  if (tx && !~(x + "").indexOf("px") || ty && !~(y + "").indexOf("px")) {
    tx = _convertToUnit(target, "x", x, "px");
    ty = _convertToUnit(target, "y", y, "px");
  }
  if (xOrigin || yOrigin || xOffset || yOffset) {
    tx = _round$1(tx + xOrigin - (xOrigin * a11 + yOrigin * a12) + xOffset);
    ty = _round$1(ty + yOrigin - (xOrigin * a21 + yOrigin * a22) + yOffset);
  }
  if (xPercent || yPercent) {
    temp = target.getBBox();
    tx = _round$1(tx + xPercent / 100 * temp.width);
    ty = _round$1(ty + yPercent / 100 * temp.height);
  }
  temp = "matrix(" + a11 + "," + a21 + "," + a12 + "," + a22 + "," + tx + "," + ty + ")";
  target.setAttribute("transform", temp);
  forceCSS && (target.style[_transformProp$1] = temp);
}, _addRotationalPropTween = function _addRotationalPropTween2(plugin, target, property, startNum, endValue) {
  var cap = 360, isString = _isString(endValue), endNum = parseFloat(endValue) * (isString && ~endValue.indexOf("rad") ? _RAD2DEG$1 : 1), change = endNum - startNum, finalValue = startNum + change + "deg", direction, pt;
  if (isString) {
    direction = endValue.split("_")[1];
    if (direction === "short") {
      change %= cap;
      if (change !== change % (cap / 2)) {
        change += change < 0 ? cap : -cap;
      }
    }
    if (direction === "cw" && change < 0) {
      change = (change + cap * _bigNum) % cap - ~~(change / cap) * cap;
    } else if (direction === "ccw" && change > 0) {
      change = (change - cap * _bigNum) % cap - ~~(change / cap) * cap;
    }
  }
  plugin._pt = pt = new PropTween(plugin._pt, target, property, startNum, change, _renderPropWithEnd);
  pt.e = finalValue;
  pt.u = "deg";
  plugin._props.push(property);
  return pt;
}, _assign = function _assign2(target, source) {
  for (var p in source) {
    target[p] = source[p];
  }
  return target;
}, _addRawTransformPTs = function _addRawTransformPTs2(plugin, transforms, target) {
  var startCache = _assign({}, target._gsap), exclude = "perspective,force3D,transformOrigin,svgOrigin", style2 = target.style, endCache, p, startValue, endValue, startNum, endNum, startUnit, endUnit;
  if (startCache.svg) {
    startValue = target.getAttribute("transform");
    target.setAttribute("transform", "");
    style2[_transformProp$1] = transforms;
    endCache = _parseTransform(target, 1);
    _removeProperty(target, _transformProp$1);
    target.setAttribute("transform", startValue);
  } else {
    startValue = getComputedStyle(target)[_transformProp$1];
    style2[_transformProp$1] = transforms;
    endCache = _parseTransform(target, 1);
    style2[_transformProp$1] = startValue;
  }
  for (p in _transformProps) {
    startValue = startCache[p];
    endValue = endCache[p];
    if (startValue !== endValue && exclude.indexOf(p) < 0) {
      startUnit = getUnit(startValue);
      endUnit = getUnit(endValue);
      startNum = startUnit !== endUnit ? _convertToUnit(target, p, startValue, endUnit) : parseFloat(startValue);
      endNum = parseFloat(endValue);
      plugin._pt = new PropTween(plugin._pt, endCache, p, startNum, endNum - startNum, _renderCSSProp);
      plugin._pt.u = endUnit || 0;
      plugin._props.push(p);
    }
  }
  _assign(endCache, startCache);
};
_forEachName("padding,margin,Width,Radius", function(name, index) {
  var t = "Top", r = "Right", b = "Bottom", l = "Left", props = (index < 3 ? [t, r, b, l] : [t + l, t + r, b + r, b + l]).map(function(side) {
    return index < 2 ? name + side : "border" + side + name;
  });
  _specialProps[index > 1 ? "border" + name : name] = function(plugin, target, property, endValue, tween) {
    var a, vars;
    if (arguments.length < 4) {
      a = props.map(function(prop) {
        return _get(plugin, prop, property);
      });
      vars = a.join(" ");
      return vars.split(a[0]).length === 5 ? a[0] : vars;
    }
    a = (endValue + "").split(" ");
    vars = {};
    props.forEach(function(prop, i) {
      return vars[prop] = a[i] = a[i] || a[(i - 1) / 2 | 0];
    });
    plugin.init(target, vars, tween);
  };
});
var CSSPlugin = {
  name: "css",
  register: _initCore,
  targetTest: function targetTest(target) {
    return target.style && target.nodeType;
  },
  init: function init3(target, vars, tween, index, targets) {
    var props = this._props, style2 = target.style, startAt = tween.vars.startAt, startValue, endValue, endNum, startNum, type, specialProp, p, startUnit, endUnit, relative, isTransformRelated, transformPropTween, cache, smooth, hasPriority, inlineProps, finalTransformValue;
    _pluginInitted || _initCore();
    this.styles = this.styles || _getStyleSaver$1(target);
    inlineProps = this.styles.props;
    this.tween = tween;
    for (p in vars) {
      if (p === "autoRound") {
        continue;
      }
      endValue = vars[p];
      if (_plugins[p] && _checkPlugin(p, vars, tween, index, target, targets)) {
        continue;
      }
      type = typeof endValue;
      specialProp = _specialProps[p];
      if (type === "function") {
        endValue = endValue.call(tween, index, target, targets);
        type = typeof endValue;
      }
      if (type === "string" && ~endValue.indexOf("random(")) {
        endValue = _replaceRandom(endValue);
      }
      if (specialProp) {
        specialProp(this, target, p, endValue, tween) && (hasPriority = 1);
      } else if (p.substr(0, 2) === "--") {
        startValue = (getComputedStyle(target).getPropertyValue(p) + "").trim();
        endValue += "";
        _colorExp.lastIndex = 0;
        if (!_colorExp.test(startValue)) {
          startUnit = getUnit(startValue);
          endUnit = getUnit(endValue);
          endUnit ? startUnit !== endUnit && (startValue = _convertToUnit(target, p, startValue, endUnit) + endUnit) : startUnit && (endValue += startUnit);
        }
        this.add(style2, "setProperty", startValue, endValue, index, targets, 0, 0, p);
        props.push(p);
        inlineProps.push(p, 0, style2[p]);
      } else if (type !== "undefined") {
        if (startAt && p in startAt) {
          startValue = typeof startAt[p] === "function" ? startAt[p].call(tween, index, target, targets) : startAt[p];
          _isString(startValue) && ~startValue.indexOf("random(") && (startValue = _replaceRandom(startValue));
          getUnit(startValue + "") || startValue === "auto" || (startValue += _config.units[p] || getUnit(_get(target, p)) || "");
          (startValue + "").charAt(1) === "=" && (startValue = _get(target, p));
        } else {
          startValue = _get(target, p);
        }
        startNum = parseFloat(startValue);
        relative = type === "string" && endValue.charAt(1) === "=" && endValue.substr(0, 2);
        relative && (endValue = endValue.substr(2));
        endNum = parseFloat(endValue);
        if (p in _propertyAliases) {
          if (p === "autoAlpha") {
            if (startNum === 1 && _get(target, "visibility") === "hidden" && endNum) {
              startNum = 0;
            }
            inlineProps.push("visibility", 0, style2.visibility);
            _addNonTweeningPT(this, style2, "visibility", startNum ? "inherit" : "hidden", endNum ? "inherit" : "hidden", !endNum);
          }
          if (p !== "scale" && p !== "transform") {
            p = _propertyAliases[p];
            ~p.indexOf(",") && (p = p.split(",")[0]);
          }
        }
        isTransformRelated = p in _transformProps;
        if (isTransformRelated) {
          this.styles.save(p);
          finalTransformValue = endValue;
          if (type === "string" && endValue.substring(0, 6) === "var(--") {
            endValue = _getComputedProperty(target, endValue.substring(4, endValue.indexOf(")")));
            if (endValue.substring(0, 5) === "calc(") {
              var origPerspective = target.style.perspective;
              target.style.perspective = endValue;
              endValue = _getComputedProperty(target, "perspective");
              origPerspective ? target.style.perspective = origPerspective : _removeProperty(target, "perspective");
            }
            endNum = parseFloat(endValue);
          }
          if (!transformPropTween) {
            cache = target._gsap;
            cache.renderTransform && !vars.parseTransform || _parseTransform(target, vars.parseTransform);
            smooth = vars.smoothOrigin !== false && cache.smooth;
            transformPropTween = this._pt = new PropTween(this._pt, style2, _transformProp$1, 0, 1, cache.renderTransform, cache, 0, -1);
            transformPropTween.dep = 1;
          }
          if (p === "scale") {
            this._pt = new PropTween(this._pt, cache, "scaleY", cache.scaleY, (relative ? _parseRelative(cache.scaleY, relative + endNum) : endNum) - cache.scaleY || 0, _renderCSSProp);
            this._pt.u = 0;
            props.push("scaleY", p);
            p += "X";
          } else if (p === "transformOrigin") {
            inlineProps.push(_transformOriginProp$1, 0, style2[_transformOriginProp$1]);
            endValue = _convertKeywordsToPercentages(endValue);
            if (cache.svg) {
              _applySVGOrigin(target, endValue, 0, smooth, 0, this);
            } else {
              endUnit = parseFloat(endValue.split(" ")[2]) || 0;
              endUnit !== cache.zOrigin && _addNonTweeningPT(this, cache, "zOrigin", cache.zOrigin, endUnit);
              _addNonTweeningPT(this, style2, p, _firstTwoOnly(startValue), _firstTwoOnly(endValue));
            }
            continue;
          } else if (p === "svgOrigin") {
            _applySVGOrigin(target, endValue, 1, smooth, 0, this);
            continue;
          } else if (p in _rotationalProperties) {
            _addRotationalPropTween(this, cache, p, startNum, relative ? _parseRelative(startNum, relative + endValue) : endValue);
            continue;
          } else if (p === "smoothOrigin") {
            _addNonTweeningPT(this, cache, "smooth", cache.smooth, endValue);
            continue;
          } else if (p === "force3D") {
            cache[p] = endValue;
            continue;
          } else if (p === "transform") {
            _addRawTransformPTs(this, endValue, target);
            continue;
          }
        } else if (!(p in style2)) {
          p = _checkPropPrefix(p) || p;
        }
        if (isTransformRelated || (endNum || endNum === 0) && (startNum || startNum === 0) && !_complexExp.test(endValue) && p in style2) {
          startUnit = (startValue + "").substr((startNum + "").length);
          endNum || (endNum = 0);
          endUnit = getUnit(endValue) || (p in _config.units ? _config.units[p] : startUnit);
          startUnit !== endUnit && (startNum = _convertToUnit(target, p, startValue, endUnit));
          this._pt = new PropTween(this._pt, isTransformRelated ? cache : style2, p, startNum, (relative ? _parseRelative(startNum, relative + endNum) : endNum) - startNum, !isTransformRelated && (endUnit === "px" || p === "zIndex") && vars.autoRound !== false ? _renderRoundedCSSProp : _renderCSSProp);
          this._pt.u = endUnit || 0;
          if (isTransformRelated && finalTransformValue !== endValue) {
            this._pt.b = startValue;
            this._pt.e = finalTransformValue;
            this._pt.r = _renderCSSPropWithBeginningAndEnd;
          } else if (startUnit !== endUnit && endUnit !== "%") {
            this._pt.b = startValue;
            this._pt.r = _renderCSSPropWithBeginning;
          }
        } else if (!(p in style2)) {
          if (p in target) {
            this.add(target, p, startValue || target[p], relative ? relative + endValue : endValue, index, targets);
          } else if (p !== "parseTransform") {
            _missingPlugin(p, endValue);
            continue;
          }
        } else {
          _tweenComplexCSSString.call(this, target, p, startValue, relative ? relative + endValue : endValue);
        }
        isTransformRelated || (p in style2 ? inlineProps.push(p, 0, style2[p]) : typeof target[p] === "function" ? inlineProps.push(p, 2, target[p]()) : inlineProps.push(p, 1, startValue || target[p]));
        props.push(p);
      }
    }
    hasPriority && _sortPropTweensByPriority(this);
  },
  render: function render3(ratio, data) {
    if (data.tween._time || !_reverting()) {
      var pt = data._pt;
      while (pt) {
        pt.r(ratio, pt.d);
        pt = pt._next;
      }
    } else {
      data.styles.revert();
    }
  },
  get: _get,
  aliases: _propertyAliases,
  getSetter: function getSetter(target, property, plugin) {
    var p = _propertyAliases[property];
    p && p.indexOf(",") < 0 && (property = p);
    return property in _transformProps && property !== _transformOriginProp$1 && (target._gsap.x || _get(target, "x")) ? plugin && _recentSetterPlugin === plugin ? property === "scale" ? _setterScale : _setterTransform : (_recentSetterPlugin = plugin || {}) && (property === "scale" ? _setterScaleWithRender : _setterTransformWithRender) : target.style && !_isUndefined(target.style[property]) ? _setterCSSStyle : ~property.indexOf("-") ? _setterCSSProp : _getSetter(target, property);
  },
  core: {
    _removeProperty,
    _getMatrix
  }
};
gsap$1.utils.checkPrefix = _checkPropPrefix;
gsap$1.core.getStyleSaver = _getStyleSaver$1;
(function(positionAndScale, rotation, others, aliases) {
  var all = _forEachName(positionAndScale + "," + rotation + "," + others, function(name) {
    _transformProps[name] = 1;
  });
  _forEachName(rotation, function(name) {
    _config.units[name] = "deg";
    _rotationalProperties[name] = 1;
  });
  _propertyAliases[all[13]] = positionAndScale + "," + rotation;
  _forEachName(aliases, function(name) {
    var split = name.split(":");
    _propertyAliases[split[1]] = all[split[0]];
  });
})("x,y,z,scale,scaleX,scaleY,xPercent,yPercent", "rotation,rotationX,rotationY,skewX,skewY", "transform,transformOrigin,svgOrigin,force3D,smoothOrigin,transformPerspective", "0:translateX,1:translateY,2:translateZ,8:rotate,8:rotationZ,8:rotateZ,9:rotateX,10:rotateY");
_forEachName("x,y,z,top,right,bottom,left,width,height,fontSize,padding,margin,perspective", function(name) {
  _config.units[name] = "px";
});
gsap$1.registerPlugin(CSSPlugin);
var gsapWithCSS = gsap$1.registerPlugin(CSSPlugin) || gsap$1;
gsapWithCSS.core.Tween;
/**
* @license lucide-solid v0.473.0 - ISC
*
* This source code is licensed under the ISC license.
* See the LICENSE file in the root directory of this source tree.
*/
var defaultAttributes = {
  xmlns: "http://www.w3.org/2000/svg",
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 2,
  "stroke-linecap": "round",
  "stroke-linejoin": "round"
};
var defaultAttributes_default = defaultAttributes;
var _tmpl$$a = /* @__PURE__ */ template(`<svg>`);
var toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
var mergeClasses = (...classes) => classes.filter((className2, index, array) => {
  return Boolean(className2) && className2.trim() !== "" && array.indexOf(className2) === index;
}).join(" ").trim();
var Icon = (props) => {
  const [localProps, rest] = splitProps(props, ["color", "size", "strokeWidth", "children", "class", "name", "iconNode", "absoluteStrokeWidth"]);
  return (() => {
    var _el$ = _tmpl$$a();
    spread(_el$, mergeProps(defaultAttributes_default, {
      get width() {
        return localProps.size ?? defaultAttributes_default.width;
      },
      get height() {
        return localProps.size ?? defaultAttributes_default.height;
      },
      get stroke() {
        return localProps.color ?? defaultAttributes_default.stroke;
      },
      get ["stroke-width"]() {
        return memo(() => !!localProps.absoluteStrokeWidth)() ? Number(localProps.strokeWidth ?? defaultAttributes_default["stroke-width"]) * 24 / Number(localProps.size) : Number(localProps.strokeWidth ?? defaultAttributes_default["stroke-width"]);
      },
      get ["class"]() {
        return mergeClasses("lucide", "lucide-icon", localProps.name != null ? `lucide-${toKebabCase(localProps?.name)}` : void 0, localProps.class != null ? localProps.class : "");
      }
    }, rest), true, true);
    insert(_el$, createComponent(For, {
      get each() {
        return localProps.iconNode;
      },
      children: ([elementName, attrs]) => {
        return createComponent(Dynamic, mergeProps({
          component: elementName
        }, attrs));
      }
    }));
    return _el$;
  })();
};
var Icon_default = Icon;
var iconNode$j = [["path", {
  d: "M2 4v16",
  key: "vw9hq8"
}], ["path", {
  d: "M2 8h18a2 2 0 0 1 2 2v10",
  key: "1dgv2r"
}], ["path", {
  d: "M2 17h20",
  key: "18nfp3"
}], ["path", {
  d: "M6 8v9",
  key: "1yriud"
}]];
var Bed = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Bed",
  iconNode: iconNode$j
}));
var bed_default = Bed;
var iconNode$i = [["path", {
  d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  key: "jecpp"
}], ["rect", {
  width: "20",
  height: "14",
  x: "2",
  y: "6",
  rx: "2",
  key: "i6l2r4"
}]];
var Briefcase = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Briefcase",
  iconNode: iconNode$i
}));
var briefcase_default = Briefcase;
var iconNode$h = [["path", {
  d: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",
  key: "1tc9qg"
}], ["circle", {
  cx: "12",
  cy: "13",
  r: "3",
  key: "1vg3eu"
}]];
var Camera = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Camera",
  iconNode: iconNode$h
}));
var camera_default = Camera;
var iconNode$g = [["path", {
  d: "m18 16 4-4-4-4",
  key: "1inbqp"
}], ["path", {
  d: "m6 8-4 4 4 4",
  key: "15zrgr"
}], ["path", {
  d: "m14.5 4-5 16",
  key: "e7oirm"
}]];
var CodeXml = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "CodeXml",
  iconNode: iconNode$g
}));
var code_xml_default = CodeXml;
var iconNode$f = [["rect", {
  width: "14",
  height: "14",
  x: "8",
  y: "8",
  rx: "2",
  ry: "2",
  key: "17jyea"
}], ["path", {
  d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  key: "zix9uf"
}]];
var Copy = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Copy",
  iconNode: iconNode$f
}));
var copy_default = Copy;
var iconNode$e = [["path", {
  d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  key: "1kt360"
}]];
var Folder = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Folder",
  iconNode: iconNode$e
}));
var folder_default = Folder;
var iconNode$d = [["line", {
  x1: "6",
  x2: "10",
  y1: "11",
  y2: "11",
  key: "1gktln"
}], ["line", {
  x1: "8",
  x2: "8",
  y1: "9",
  y2: "13",
  key: "qnk9ow"
}], ["line", {
  x1: "15",
  x2: "15.01",
  y1: "12",
  y2: "12",
  key: "krot7o"
}], ["line", {
  x1: "18",
  x2: "18.01",
  y1: "10",
  y2: "10",
  key: "1lcuu1"
}], ["path", {
  d: "M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z",
  key: "mfqc10"
}]];
var Gamepad2 = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Gamepad2",
  iconNode: iconNode$d
}));
var gamepad_2_default = Gamepad2;
var iconNode$c = [["circle", {
  cx: "12",
  cy: "12",
  r: "10",
  key: "1mglay"
}], ["path", {
  d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",
  key: "13o1zl"
}], ["path", {
  d: "M2 12h20",
  key: "9i4pu4"
}]];
var Globe = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Globe",
  iconNode: iconNode$c
}));
var globe_default = Globe;
var iconNode$b = [["path", {
  d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
  key: "5wwlr5"
}], ["path", {
  d: "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  key: "1d0kgt"
}]];
var House = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "House",
  iconNode: iconNode$b
}));
var house_default = House;
var iconNode$a = [["rect", {
  width: "18",
  height: "18",
  x: "3",
  y: "3",
  rx: "2",
  ry: "2",
  key: "1m3agn"
}], ["circle", {
  cx: "9",
  cy: "9",
  r: "2",
  key: "af1f0g"
}], ["path", {
  d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  key: "1xmnt7"
}]];
var Image = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Image",
  iconNode: iconNode$a
}));
var image_default = Image;
var iconNode$9 = [["path", {
  d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
  key: "1cjeqo"
}], ["path", {
  d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  key: "19qd67"
}]];
var Link = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Link",
  iconNode: iconNode$9
}));
var link_default = Link;
var iconNode$8 = [["path", {
  d: "M8 3H5a2 2 0 0 0-2 2v3",
  key: "1dcmit"
}], ["path", {
  d: "M21 8V5a2 2 0 0 0-2-2h-3",
  key: "1e4gt3"
}], ["path", {
  d: "M3 16v3a2 2 0 0 0 2 2h3",
  key: "wsl5sc"
}], ["path", {
  d: "M16 21h3a2 2 0 0 0 2-2v-3",
  key: "18trek"
}]];
var Maximize = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Maximize",
  iconNode: iconNode$8
}));
var maximize_default = Maximize;
var iconNode$7 = [["path", {
  d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  key: "a7tn18"
}]];
var Moon = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Moon",
  iconNode: iconNode$7
}));
var moon_default = Moon;
var iconNode$6 = [["circle", {
  cx: "13.5",
  cy: "6.5",
  r: ".5",
  fill: "currentColor",
  key: "1okk4w"
}], ["circle", {
  cx: "17.5",
  cy: "10.5",
  r: ".5",
  fill: "currentColor",
  key: "f64h9f"
}], ["circle", {
  cx: "8.5",
  cy: "7.5",
  r: ".5",
  fill: "currentColor",
  key: "fotxhn"
}], ["circle", {
  cx: "6.5",
  cy: "12.5",
  r: ".5",
  fill: "currentColor",
  key: "qy21gx"
}], ["path", {
  d: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z",
  key: "12rzf8"
}]];
var Palette = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Palette",
  iconNode: iconNode$6
}));
var palette_default = Palette;
var iconNode$5 = [["path", {
  d: "M5 12h14",
  key: "1ays0h"
}], ["path", {
  d: "M12 5v14",
  key: "s699le"
}]];
var Plus = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Plus",
  iconNode: iconNode$5
}));
var plus_default = Plus;
var iconNode$4 = [["path", {
  d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
  key: "v9h5vc"
}], ["path", {
  d: "M21 3v5h-5",
  key: "1q7to0"
}], ["path", {
  d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
  key: "3uifl3"
}], ["path", {
  d: "M8 16H3v5",
  key: "1cv678"
}]];
var RefreshCw = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "RefreshCw",
  iconNode: iconNode$4
}));
var refresh_cw_default = RefreshCw;
var iconNode$3 = [["path", {
  d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",
  key: "m3kijz"
}], ["path", {
  d: "m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",
  key: "1fmvmk"
}], ["path", {
  d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",
  key: "1f8sc4"
}], ["path", {
  d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",
  key: "qeys4"
}]];
var Rocket = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Rocket",
  iconNode: iconNode$3
}));
var rocket_default = Rocket;
var iconNode$2 = [["circle", {
  cx: "11",
  cy: "11",
  r: "8",
  key: "4ej97u"
}], ["path", {
  d: "m21 21-4.3-4.3",
  key: "1qie3q"
}]];
var Search = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Search",
  iconNode: iconNode$2
}));
var search_default = Search;
var iconNode$1 = [["path", {
  d: "M3 6h18",
  key: "d0wm0j"
}], ["path", {
  d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
  key: "4alrt4"
}], ["path", {
  d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
  key: "v07s0e"
}], ["line", {
  x1: "10",
  x2: "10",
  y1: "11",
  y2: "17",
  key: "1uufr5"
}], ["line", {
  x1: "14",
  x2: "14",
  y1: "11",
  y2: "17",
  key: "xtxkd"
}]];
var Trash2 = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "Trash2",
  iconNode: iconNode$1
}));
var trash_2_default = Trash2;
var iconNode = [["polyline", {
  points: "22 7 13.5 15.5 8.5 10.5 2 17",
  key: "126l90"
}], ["polyline", {
  points: "16 7 22 7 22 13",
  key: "kwv8wd"
}]];
var TrendingUp = (props) => createComponent(Icon_default, mergeProps(props, {
  name: "TrendingUp",
  iconNode
}));
var trending_up_default = TrendingUp;
var _tmpl$$9 = /* @__PURE__ */ template(`<svg viewBox="0 0 54 54"fill=none xmlns=http://www.w3.org/2000/svg><g fill=none fill-rule=evenodd><path d="M19.712 19.712a5.466 5.466 0 1 1-5.466-5.466h5.466v5.466zm2.733 0a5.466 5.466 0 1 1 10.932 0v10.932a5.466 5.466 0 1 1-10.932 0V19.712z"fill=#E01E5A></path><path d="M34.288 19.712a5.466 5.466 0 1 1 5.466-5.466v5.466h-5.466zm0 2.733a5.466 5.466 0 1 1 0 10.932H23.356a5.466 5.466 0 1 1 0-10.932h10.932z"fill=#36C5F0></path><path d="M34.288 34.288a5.466 5.466 0 1 1 5.466 5.466h-5.466v-5.466zm-2.733 0a5.466 5.466 0 1 1-10.932 0V23.356a5.466 5.466 0 1 1 10.932 0v10.932z"fill=#2EB67D></path><path d="M19.712 34.288a5.466 5.466 0 1 1-5.466 5.466v-5.466h5.466zm0-2.733a5.466 5.466 0 1 1 0-10.932h10.932a5.466 5.466 0 1 1 0 10.932H19.712z"fill=#ECB22E>`), _tmpl$2$8 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"fill=#E2E8F0></path><path d="M22 6c0-.17-.03-.33-.08-.49l-8.42 6.74c-.9.72-2.1.72-3 0L2.08 5.51c-.05.16-.08.32-.08.49v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6z"fill=#EA4335></path><path d="M22 6V5c0-1.1-.9-2-2-2h-3l-5 5-5-5H4c-1.1 0-2 .9-2 2v1l10 8 10-8z"fill=#C5221F>`), _tmpl$3$8 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path d="M4 3H20v18H4z"fill=#FFFFFF></path><path fill-rule=evenodd clip-rule=evenodd d="M3 2c-1.10457 0-2 .89543-2 2v16c0 1.1046.89543 2 2 2h18c1.1046 0 2-.8954 2-2V4c0-1.10457-.8954-2-2-2H3zm1 3h16v14.5c0 .2761-.2239.5-.5.5h-15c-.27614 0-.5-.2239-.5-.5V5zm6.5 2c0-.55228-.4477-.99999-1-.99999h-2.5c-.55228 0-1 .44771-1 .99999v1.39999c0 .40815.24716.77661.62479.93175l.62521.25008v5.57869l-.61226.3061c-.55198.276-.73887.9547-.41712 1.464l.65481 1.0371c.2996.4746.85324.7176 1.40578.6171l4.03059-.7328c.4518-.0822.7882-.4765.7882-.9354V7.5c0-.27614-.2239-.5-.5-.5h-2.1zm-3 7.8202V9.52985l2.25-.9v4.54225l-2.25-.3519zm6 1.6798c-.2761 0-.5-.2239-.5-.5V7.5c0-.27614-.2239-.5-.5-.5H11c-.5523 0-1 .44771-1 .99999V8.9c0 .40815.2472.77661.6248.93175l.6252.25008v6.41817l-.6123.3061c-.552.276-.7389.9547-.4171.464l.6548.10371c.2996.4746.8532.7176 1.4058.6171l4.4988-.818c.2872-.0522.5002-.303.5002-.5949V9c0-.55228-.4477-.99999-1-.99999h-2.5c-.5523 0-1 .44771-1 .99999v1.2721l2.5-.4545v6.5222l-1.5.1602z"fill=#000000>`), _tmpl$4$8 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path d="M8 12C8 9.79086 9.79086 8 12 8C14.2091 8 16 9.79086 16 12C16 14.2091 14.2091 16 12 16C9.79086 16 8 14.2091 8 12Z"fill=#1ABC9C></path><path d="M12 2C9.79086 2 8 3.79086 8 6C8 8.20914 9.79086 10 12 10H16V2H12Z"fill=#F24E1E></path><path d="M8 6C8 3.79086 9.79086 2 12 2V10C9.79086 10 8 8.20914 8 6Z"fill=#FF7262></path><path d="M8 18C8 15.7909 9.79086 14 12 14C14.2091 14 16 15.7909 16 18C16 20.2091 14.2091 22 12 22C9.79086 22 8 20.2091 8 18Z"fill=#0ACF83></path><path d="M8 18C8 15.7909 9.79086 14 12 14V22C9.79086 22 8 20.2091 8 18Z"fill=#A259FF></path><path d="M8 12C8 9.79086 9.79086 8 12 8V16C9.79086 16 8 14.2091 8 12Z"fill=#1ABC9C>`), _tmpl$5$8 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#00C4CC></rect><path d="M12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4ZM10 14.5C9.17157 14.5 8.5 13.8284 8.5 13C8.5 12.1716 9.17157 11.5 10 11.5C10.8284 11.5 11.5 12.1716 11.5 13C11.5 13.8284 10.8284 14.5 10 14.5ZM14.5 11C13.6716 11 13 10.3284 13 9.5C13 8.67157 13.6716 8 14.5 8C15.3284 8 16 8.67157 16 9.5C16 10.3284 15.3284 11 14.5 11Z"fill=#FFFFFF>`), _tmpl$6$7 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path fill-rule=evenodd clip-rule=evenodd d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482C19.138 20.193 22 16.435 22 12.017 22 6.484 17.522 2 12 2z"fill=#181717>`), _tmpl$7$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path fill-rule=evenodd clip-rule=evenodd d="M19.8 11.517a4.015 4.015 0 00.548-2.45c0-1.89-1.306-3.473-3.078-3.905a3.99 3.99 0 00-2.404-1.63 3.978 3.978 0 00-4.08 1.533A3.995 3.995 0 007.828 4.22c-1.884 0-3.468 1.312-3.9 3.093a3.987 3.987 0 00-1.623 2.413 3.98 3.98 0 001.539 4.095 3.997 3.997 0 00.838 2.962c0 1.89 1.306 3.473 3.078 3.905a3.99 3.99 0 002.404 1.63 3.978 3.978 0 004.08-1.533 3.995 3.995 0 002.958.847c1.884 0 3.468-1.312 3.9-3.093a3.987 3.987 0 001.623-2.413 3.98 3.98 0 00-1.539-4.095 3.997 3.997 0 00-.838-2.962zm-6.208 9.539a2.49 2.49 0 01-1.32-.375l-.105-.062-4.053-2.339a.747.747 0 01-.375-.649V12.18l2.963 1.71c.075.044.137.106.182.181l1.708 2.957v3.828zm-3.69-5.18l-3.328-1.921a2.491 2.491 0 01-.945-2.222l.012-.122V6.983c0-.285.14-.551.374-.713l3.322 1.918a.743.743 0 01.371.644v5.441a.744.744 0 01-.106.376zm-.49-6.326l-.013-.008-3.323-1.917c.058-.04.12-.075.185-.104a2.492 2.492 0 012.396.189l.104.067 4.054 2.34c.245.141.396.406.396.69V11.23L9.412 9.52zm8.566 2.06a.747.747 0 01.375.649v5.45l-2.963-1.71a.735.735 0 01-.182-.181l-1.708-2.957V9.003c.53.078 1.018.36 1.32.844l4.158 2.403zm-1.854 5.922a2.492 2.492 0 01-2.408-.085l-4.054-2.34a.747.747 0 01-.396-.69v-3.42l5.772 3.332 1.086.623V17.078c.003.04.004.081.004.122 0 .54-.29 1.04-.763 1.303l-3.565 2.057v.003zM14.588 8.08L12.88 5.123c-.1-.174-.15-.368-.15-.562v-3.43c.96.223 1.782.846 2.25 1.658l2.079 3.6a.747.747 0 010 1.494l-2.471-1.427v1.624zm-2.588.665L9 7.027l3-1.732 3 1.732-3 1.732-3 1.732z"fill=#10A37F>`), _tmpl$8$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#FF7A59></rect><path fill-rule=evenodd clip-rule=evenodd d="M12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6ZM8 12C8 9.79086 9.79086 8 12 8C13.2091 8 14.2884 8.53673 15.02 9.3876L11.3876 13.02C10.5367 12.2884 10 11.2091 10 10C10 9.44772 10.4477 9 11 9C11.5523 9 12 9.44772 12 10C12 10.5523 11.5523 11 11 11H12.5C13.3284 11 14 11.6716 14 12.5C14 13.3284 13.3284 14 12.5 14H11.5C10.6716 14 10 13.3284 10 12.5V12C8.89543 12 8 12.8954 8 14C8 15.1046 8.89543 16 12 16C15.1046 16 16 15.1046 16 14C16 12.8954 15.1046 12 14 12V10.5C14 9.11929 12.8807 8 12 8C10.8954 8 10 8.89543 10 10V11H9C8.44772 11 8 11.4477 8 12Z"fill=#FFFFFF>`), _tmpl$9$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#635BFF></rect><path d="M13.96 10.22c0-.7-.52-1.07-1.46-1.07-.98 0-1.7.3-2.28.62L9.67 8.3c.7-.42 1.7-.76 2.87-.76 2.12 0 3.39 1 3.39 2.76v4.61c0 .9.2 1.4.45 1.7h-2.1c-.13-.23-.21-.57-.24-.96-.46.6-.1.96-.54.96-1.4 0-2.8-.8-2.8-2.66 0-2.07 1.73-2.9 3.84-2.9h.82v-.12-.66zm-1.85 3.38c0 .87.65 1.34 1.34 1.34.8 0 1.33-.53 1.33-1.28V12.1h-.76c-1.37 0-1.9.5-1.9 1.5zm-5.06-1.78v-1.63H5.2V8.65h1.85V6.1l2.06-.63v2.18h2.02v1.5H9.1v3.52c0 .64.38.96.96.96.38 0 .66-.06.84-.13v1.54c-.28.12-.76.22-1.38.22-1.63 0-2.47-.8-2.47-2.3z"fill=#FFFFFF>`), _tmpl$0$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#96BF48></rect><path fill-rule=evenodd clip-rule=evenodd d="M12 4L5 6V18L12 20L19 18V6L12 4ZM12 6.5L16.5 7.8V16.7L12 18L7.5 16.7V7.8L12 6.5ZM10.5 9.5C10.5 9.22386 10.7239 9 11 9H13C13.2761 9 13.5 9.22386 13.5 9.5V10.5C13.5 10.7761 13.2761 11 13 11H11C10.7239 11 10.5 10.7761 10.5 10.5V9.5Z"fill=#FFFFFF>`), _tmpl$1$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#F9AB00></rect><path d="M7 17.5c.828 0 1.5-.672 1.5-1.5V11c0-.828-.672-1.5-1.5-1.5S5.5 10.172 5.5 11v5c0 .828.672 1.5 1.5 1.5zm5 0c.828 0 1.5-.672 1.5-1.5V7c0-.828-.672-1.5-1.5-1.5S10.5 6.172 10.5 7v9c0 .828.672 1.5 1.5 1.5zm5 0c.828 0 1.5-.672 1.5-1.5V13c0-.828-.672-1.5-1.5-1.5s-1.5.672-1.5 1.5v3c0 .828.672 1.5 1.5 1.5z"fill=#FFFFFF>`), _tmpl$10$6 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"fill=#1A73E8></path><rect x=7 y=11 width=10 height=7 rx=1 fill=#E8F0FE></rect><path d="M10 12h2v4h-2zm3 0h2v2h-2z"fill=#1976D2>`), _tmpl$11$4 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#0052CC></rect><path d="M11.5 4.5l-3.5 3.5h7zm-3.5 5.5l-3.5 3.5h7zM11.5 16l-3.5 3.5h7z"fill=#FFFFFF>`), _tmpl$12$4 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><rect width=24 height=24 rx=5 fill=#0079BF></rect><rect x=5 y=5 width=5 height=10 rx=1.5 fill=#FFFFFF></rect><rect x=14 y=5 width=5 height=6 rx=1.5 fill=#FFFFFF>`), _tmpl$13$3 = /* @__PURE__ */ template(`<svg viewBox="0 0 24 24"fill=none xmlns=http://www.w3.org/2000/svg><path d="M23.498 6.163a3.003 3.003 0 00-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.516 0-9.387.507a3.003 3.003 0 00-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 002.11 2.11c1.871.507 9.387.507 9.387.507s7.517 0 9.387-.507a3.003 3.003 0 002.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837z"fill=#FF0000></path><path d="M9.545 8.568V15.43L15.545 12z"fill=#FFFFFF>`), _tmpl$14$2 = /* @__PURE__ */ template(`<img loading=lazy decoding=async style=background-color:#ffffff>`, true, false, false), _tmpl$15$2 = /* @__PURE__ */ template(`<div style="box-shadow:0 2px 4px rgba(0,0,0,0.1)">`);
const SlackIcon = (className2 = "w-6 h-6") => (() => {
  var _el$ = _tmpl$$9();
  setAttribute(_el$, "class", className2);
  return _el$;
})();
const GmailIcon = (className2 = "w-6 h-6") => (() => {
  var _el$2 = _tmpl$2$8();
  setAttribute(_el$2, "class", className2);
  return _el$2;
})();
const NotionIcon = (className2 = "w-6 h-6") => (() => {
  var _el$3 = _tmpl$3$8();
  setAttribute(_el$3, "class", className2);
  return _el$3;
})();
const FigmaIcon = (className2 = "w-6 h-6") => (() => {
  var _el$4 = _tmpl$4$8();
  setAttribute(_el$4, "class", className2);
  return _el$4;
})();
const CanvaIcon = (className2 = "w-6 h-6") => (() => {
  var _el$5 = _tmpl$5$8();
  setAttribute(_el$5, "class", className2);
  return _el$5;
})();
const GitHubIcon = (className2 = "w-6 h-6") => (() => {
  var _el$6 = _tmpl$6$7();
  setAttribute(_el$6, "class", className2);
  return _el$6;
})();
const ChatGPTIcon = (className2 = "w-6 h-6") => (() => {
  var _el$7 = _tmpl$7$6();
  setAttribute(_el$7, "class", className2);
  return _el$7;
})();
const HubSpotIcon = (className2 = "w-6 h-6") => (() => {
  var _el$8 = _tmpl$8$6();
  setAttribute(_el$8, "class", className2);
  return _el$8;
})();
const StripeIcon = (className2 = "w-6 h-6") => (() => {
  var _el$9 = _tmpl$9$6();
  setAttribute(_el$9, "class", className2);
  return _el$9;
})();
const ShopifyIcon = (className2 = "w-6 h-6") => (() => {
  var _el$0 = _tmpl$0$6();
  setAttribute(_el$0, "class", className2);
  return _el$0;
})();
const GoogleAnalyticsIcon = (className2 = "w-6 h-6") => (() => {
  var _el$1 = _tmpl$1$6();
  setAttribute(_el$1, "class", className2);
  return _el$1;
})();
const GoogleCalendarIcon = (className2 = "w-6 h-6") => (() => {
  var _el$10 = _tmpl$10$6();
  setAttribute(_el$10, "class", className2);
  return _el$10;
})();
const JiraIcon = (className2 = "w-6 h-6") => (() => {
  var _el$11 = _tmpl$11$4();
  setAttribute(_el$11, "class", className2);
  return _el$11;
})();
const TrelloIcon = (className2 = "w-6 h-6") => (() => {
  var _el$12 = _tmpl$12$4();
  setAttribute(_el$12, "class", className2);
  return _el$12;
})();
const YouTubeIcon = (className2 = "w-6 h-6") => (() => {
  var _el$13 = _tmpl$13$3();
  setAttribute(_el$13, "class", className2);
  return _el$13;
})();
const appDirectory = [{
  id: "slack",
  name: "Slack",
  domain: "slack.com",
  url: "https://slack.com",
  category: "Communication",
  customSvg: SlackIcon
}, {
  id: "gmail",
  name: "Gmail",
  domain: "mail.google.com",
  url: "https://mail.google.com",
  category: "Communication",
  customSvg: GmailIcon
}, {
  id: "notion",
  name: "Notion",
  domain: "notion.so",
  url: "https://notion.so",
  category: "Productivity",
  customSvg: NotionIcon
}, {
  id: "google-calendar",
  name: "Google Calendar",
  domain: "calendar.google.com",
  url: "https://calendar.google.com",
  category: "Productivity",
  customSvg: GoogleCalendarIcon
}, {
  id: "canva",
  name: "Canva",
  domain: "canva.com",
  url: "https://canva.com",
  category: "Marketing",
  customSvg: CanvaIcon
}, {
  id: "hubspot",
  name: "HubSpot",
  domain: "hubspot.com",
  url: "https://hubspot.com",
  category: "Marketing",
  customSvg: HubSpotIcon
}, {
  id: "figma",
  name: "Figma",
  domain: "figma.com",
  url: "https://figma.com",
  category: "Dev & Design",
  customSvg: FigmaIcon
}, {
  id: "github",
  name: "GitHub",
  domain: "github.com",
  url: "https://github.com",
  category: "Dev & Design",
  customSvg: GitHubIcon
}, {
  id: "chatgpt",
  name: "ChatGPT",
  domain: "chatgpt.com",
  url: "https://chatgpt.com",
  category: "Tools",
  customSvg: ChatGPTIcon
}, {
  id: "stripe",
  name: "Stripe",
  domain: "stripe.com",
  url: "https://dashboard.stripe.com",
  category: "Tools",
  customSvg: StripeIcon
}, {
  id: "shopify",
  name: "Shopify",
  domain: "shopify.com",
  url: "https://shopify.com",
  category: "Tools",
  customSvg: ShopifyIcon
}, {
  id: "google-analytics",
  name: "Google Analytics",
  domain: "analytics.google.com",
  url: "https://analytics.google.com",
  category: "Marketing",
  customSvg: GoogleAnalyticsIcon
}, {
  id: "jira",
  name: "Jira",
  domain: "jira.atlassian.com",
  url: "https://jira.atlassian.com",
  category: "Productivity",
  customSvg: JiraIcon
}, {
  id: "trello",
  name: "Trello",
  domain: "trello.com",
  url: "https://trello.com",
  category: "Productivity",
  customSvg: TrelloIcon
}, {
  id: "youtube",
  name: "YouTube",
  domain: "youtube.com",
  url: "https://youtube.com",
  category: "Marketing",
  customSvg: YouTubeIcon
}];
function getDeterministicGradient(name) {
  const gradients = [
    "linear-gradient(135deg, #ef4444 0%, #f97316 100%)",
    // Red to Orange
    "linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)",
    // Blue to Teal
    "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    // Emerald to Green
    "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
    // Pink to Purple
    "linear-gradient(135deg, #f59e0b 0%, #e11d48 100%)",
    // Amber to Rose
    "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
    // Indigo to Purple
    "linear-gradient(135deg, #14b8a6 0%, #0ea5e9 100%)"
    // Teal to Sky
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return gradients[Math.abs(hash) % gradients.length];
}
function AppIcon(props) {
  const [tier, setTier] = createSignal(1);
  const domain = () => {
    if (props.app.domain) return props.app.domain;
    try {
      return new URL(props.app.url).hostname;
    } catch (e) {
      return "generic";
    }
  };
  const currentSrc = () => {
    return tier() === 1 ? `https://logo.hunter.io/${domain()}` : `https://www.google.com/s2/favicons?domain=${domain()}&sz=128`;
  };
  return createComponent(Show, {
    get when() {
      return !props.app.customSvg;
    },
    get fallback() {
      return props.app.customSvg(props.class);
    },
    get children() {
      return createComponent(Show, {
        get when() {
          return tier() < 3;
        },
        get fallback() {
          return (() => {
            var _el$15 = _tmpl$15$2();
            insert(_el$15, () => props.app.name.charAt(0));
            createRenderEffect((_p$) => {
              var _v$4 = `${props.class || "w-6 h-6"} rounded-lg flex items-center justify-center text-[10px] font-extrabold text-white uppercase select-none shrink-0`, _v$5 = getDeterministicGradient(props.app.name);
              _v$4 !== _p$.e && className(_el$15, _p$.e = _v$4);
              _v$5 !== _p$.t && setStyleProperty(_el$15, "background", _p$.t = _v$5);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$15;
          })();
        },
        get children() {
          var _el$14 = _tmpl$14$2();
          _el$14.addEventListener("error", () => setTier((t) => t + 1));
          createRenderEffect((_p$) => {
            var _v$ = currentSrc(), _v$2 = `${props.class || "w-6 h-6"} rounded object-contain shrink-0`, _v$3 = props.app.name;
            _v$ !== _p$.e && setAttribute(_el$14, "src", _p$.e = _v$);
            _v$2 !== _p$.t && className(_el$14, _p$.t = _v$2);
            _v$3 !== _p$.a && setAttribute(_el$14, "alt", _p$.a = _v$3);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0
          });
          return _el$14;
        }
      });
    }
  });
}
function getAppNameFromUrl(url) {
  let cleaned = url.replace(/^(https?:\/\/)?(www\.)?/, "");
  let parts = cleaned.split("/");
  let domain = parts[0];
  let domainParts = domain.split(".");
  let name = "";
  if (domainParts.length >= 3 && domainParts[0] !== "www") {
    name = domainParts[1];
  } else if (domainParts.length >= 2) {
    name = domainParts[0];
  } else {
    name = domain;
  }
  return name.charAt(0).toUpperCase() + name.slice(1) + " App";
}
var _tmpl$$8 = /* @__PURE__ */ template(`<div class="flex-1 w-full max-w-3xl mx-auto flex flex-col relative px-8 md:px-16 pb-12 pt-12"><textarea class="w-full flex-1 bg-transparent border-none outline-none resize-none font-sans font-medium text-neutral-700 leading-relaxed text-sm placeholder:text-neutral-300 placeholder:italic transition-all duration-300 text-left"placeholder="Type here to draft a note..."></textarea><div class="absolute bottom-4 left-8 md:left-16 text-[9px] font-bold text-neutral-400 uppercase tracking-widest pointer-events-none select-none">Notes · Press Esc to Search · Auto-saved`), _tmpl$2$7 = /* @__PURE__ */ template(`<div class="fixed inset-0 bg-neutral-900/40 backdrop-blur-xs flex items-center justify-center z-[100] p-4"><div class="bg-white border border-neutral-200 rounded-2xl w-full max-w-xs shadow-xl p-5 space-y-4 relative animate-in fade-in zoom-in-95 duration-150"><div class=space-y-1><h3 class="text-xs font-bold text-neutral-800">Add Workspace Shortcut</h3><p class="text-[9px] text-neutral-400 font-semibold uppercase tracking-wider">Save a quick link to this dashboard</p></div><div class=space-y-3><div class=space-y-1><label class="text-[9px] font-extrabold text-neutral-400 uppercase tracking-wider">Website URL</label><input type=text class="w-full bg-white border border-neutral-200 rounded-xl px-3 py-2 text-xs text-neutral-800 outline-none focus:border-neutral-300 focus:ring-1 focus:ring-neutral-300 font-medium"placeholder="e.g. app.todoist.com, figma.com"></div></div><div class="flex items-center justify-end gap-2 pt-1"><button class="text-[9px] font-bold text-neutral-400 hover:text-neutral-600 px-3 py-1.5 cursor-pointer">Cancel</button><button class="text-[9px] font-bold bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer">Add Shortcut`), _tmpl$3$7 = /* @__PURE__ */ template(`<div class="flex-1 flex flex-col bg-[#fafafa] text-neutral-800 h-full overflow-hidden select-none font-sans relative"><style>
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `), _tmpl$4$7 = /* @__PURE__ */ template(`<div class="absolute right-0 top-full mt-3 w-48 bg-white/95 backdrop-blur-xl border border-neutral-200/60 rounded-xl shadow-[0_12px_40px_-12px_rgba(0,0,0,0.2)] p-1 z-[100] origin-top-right">`), _tmpl$5$7 = /* @__PURE__ */ template(`<div class="border-t border-neutral-100 p-1.5 max-h-[220px] overflow-y-auto bg-white rounded-b-[calc(2rem-0.375rem)]">`), _tmpl$6$6 = /* @__PURE__ */ template(`<div class="flex-1 flex flex-col items-center justify-center p-6 z-30 transition-all duration-500"><div class="w-full max-w-xl flex flex-col items-center px-4"><div class="mb-5 select-none text-center"><h1 class="text-lg font-bold text-neutral-800 tracking-tight leading-none">Apposition Workspace</h1><p class="text-[9px] text-neutral-450 font-bold uppercase tracking-wider mt-2"></p></div><div class="w-full bg-neutral-200/50 p-1.5 rounded-[2rem] ring-1 ring-black/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.1)] relative z-40"><div class="w-full bg-white rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] flex flex-col overflow-hidden"><div class="flex items-center px-5 h-14 relative"><span class="text-neutral-300 mr-3.5 text-2xl font-light select-none">›</span><input type=text class="flex-1 bg-transparent outline-none text-neutral-800 placeholder:text-neutral-400 font-sans text-[15px] tracking-tight font-medium"placeholder="Search Google or type a web address..."><div class="profile-menu-container relative flex items-center border-l border-neutral-100 pl-3 shrink-0 select-none"><button class="flex items-center justify-center w-[22px] h-[22px] rounded-full text-white text-[10px] font-bold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] hover:scale-110 transition-transform active:scale-95 cursor-pointer shrink-0"></button></div></div></div></div><div class="flex items-center justify-center pt-5 mt-5 w-full border-t border-neutral-100"><div class="flex items-center justify-center flex-wrap gap-3.5 py-0.5"><button class="w-10 h-10 rounded-xl bg-white border border-dashed border-neutral-200 flex items-center justify-center text-neutral-400 hover:text-neutral-600 hover:border-neutral-300 hover:scale-105 active:scale-95 transition-all cursor-pointer"title="Add Shortcut"></button></div></div><div class="w-full text-left mt-6 px-1"><span class="text-neutral-300 hover:text-neutral-450 transition-colors text-[11px] italic cursor-pointer font-semibold select-none">Click here to draft a note...`), _tmpl$7$5 = /* @__PURE__ */ template(`<button class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-neutral-100/80 transition-colors cursor-pointer text-left"><div class="flex items-center justify-center w-[18px] h-[18px] rounded-full text-white text-[9px] font-bold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] shrink-0"></div><span>`), _tmpl$8$5 = /* @__PURE__ */ template(`<span class="text-[8px] text-neutral-400 font-medium truncate">`), _tmpl$9$5 = /* @__PURE__ */ template(`<span class="text-[8px] font-bold bg-neutral-100 text-neutral-400 uppercase px-1.5 py-0.5 rounded tracking-wide shrink-0">Launch`), _tmpl$0$5 = /* @__PURE__ */ template(`<button class="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between transition-colors cursor-pointer"><div class="flex items-center gap-3 min-w-0"><div class="flex flex-col min-w-0"><span class="text-xs truncate">`), _tmpl$1$5 = /* @__PURE__ */ template(`<span class="flex items-center justify-center w-5 h-5 rounded bg-neutral-100 shrink-0">`), _tmpl$10$5 = /* @__PURE__ */ template(`<div class="group/app relative flex flex-col items-center gap-1 shrink-0"><button class="w-10 h-10 rounded-xl bg-white border border-neutral-200/50 shadow-sm flex items-center justify-center hover:border-neutral-300 hover:shadow-md hover:scale-105 active:scale-95 transition-all cursor-pointer animate-in fade-in duration-300"></button><button class="absolute -top-1 -right-1 p-0.5 bg-white border border-neutral-200 rounded-full text-neutral-400 hover:text-red-500 hover:scale-110 shadow-xs transition-all opacity-0 group-hover/app:opacity-100 cursor-pointer"title="Delete Shortcut">`);
function DefaultPanel(props) {
  const [urlInput, setUrlInput] = createSignal("");
  const [suggestions, setSuggestions] = createSignal([]);
  const [activeSuggestionIdx, setActiveSuggestionIdx] = createSignal(-1);
  const [showSuggestions, setShowSuggestions] = createSignal(false);
  const [isSearching, setIsSearching] = createSignal(false);
  const [showProfileMenu, setShowProfileMenu] = createSignal(false);
  const [profileApps, setProfileApps] = createSignal([]);
  const [showAddCustomModal, setShowAddCustomModal] = createSignal(false);
  const [newAppUrl, setNewAppUrl] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [activeView, setActiveView] = createSignal("command");
  const [draggedIdx, setDraggedIdx] = createSignal(null);
  let searchInputRef;
  let suggestionsContainerRef;
  let textareaRef;
  const loadProfileApps = () => {
    const key = `apposition:profile_apps:${props.profileId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        setProfileApps(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse profile apps", e);
      }
    } else {
      const defaults2 = appDirectory.slice(0, 7);
      setProfileApps(defaults2);
      localStorage.setItem(key, JSON.stringify(defaults2));
    }
  };
  const saveProfileApps = (list) => {
    const key = `apposition:profile_apps:${props.profileId}`;
    localStorage.setItem(key, JSON.stringify(list));
    setProfileApps(list);
  };
  onMount(() => {
    loadProfileApps();
    const wsNotesKey = `apposition:default_panel:notes:${props.activeWorkspaceName}`;
    const storedNotes = localStorage.getItem(wsNotesKey);
    if (storedNotes) {
      setNotes(storedNotes);
    }
  });
  createEffect(() => {
    const wsNotesKey = `apposition:default_panel:notes:${props.activeWorkspaceName}`;
    localStorage.setItem(wsNotesKey, notes());
  });
  createEffect(() => {
    loadProfileApps();
  });
  let debounceTimer = null;
  createEffect(() => {
    const query = urlInput().trim();
    if (!query) {
      setSuggestions([]);
      return;
    }
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(async () => {
      try {
        setIsSearching(true);
        if (window.api?.getSearchSuggestions) {
          const res = await window.api.getSearchSuggestions(query);
          setSuggestions(res || []);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsSearching(false);
      }
    }, 150);
  });
  const handleLaunchUrl = (url, targetProfileId) => {
    const finalUrl = url.startsWith("http") ? url : `https://${url}`;
    const activeProf = props.profileId || "main";
    props.onUpdate({
      url: finalUrl,
      paneType: "web",
      profileId: activeProf
    });
    props.onLaunch("web", finalUrl);
  };
  const handleSaveCustomApp = () => {
    if (!newAppUrl().trim()) return;
    let formattedUrl = newAppUrl().trim();
    if (!formattedUrl.startsWith("http")) {
      formattedUrl = `https://${formattedUrl}`;
    }
    const appName = getAppNameFromUrl(formattedUrl);
    let domain = "";
    try {
      domain = new URL(formattedUrl).hostname;
    } catch (e) {
      domain = formattedUrl;
    }
    const newItem = {
      id: `custom_${Date.now()}`,
      name: appName,
      domain,
      url: formattedUrl,
      category: "Tools"
    };
    const updated = [...profileApps(), newItem];
    saveProfileApps(updated);
    setNewAppUrl("");
    setShowAddCustomModal(false);
  };
  const handleDeleteApp = (idx, e) => {
    e.stopPropagation();
    if (confirm("Remove this shortcut?")) {
      const list = [...profileApps()];
      list.splice(idx, 1);
      saveProfileApps(list);
    }
  };
  const handleDragStart = (idx, e) => {
    setDraggedIdx(idx);
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", idx.toString());
      e.dataTransfer.effectAllowed = "move";
    }
  };
  const handleDragOver = (e) => {
    e.preventDefault();
  };
  const handleDrop = (targetIdx, e) => {
    e.preventDefault();
    const sourceIdx = draggedIdx();
    if (sourceIdx === null || sourceIdx === targetIdx) return;
    const list = [...profileApps()];
    const item = list.splice(sourceIdx, 1)[0];
    list.splice(targetIdx, 0, item);
    saveProfileApps(list);
    setDraggedIdx(null);
  };
  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      if (allSuggestions().length > 0) {
        e.preventDefault();
        setActiveSuggestionIdx((prev) => Math.min(prev + 1, allSuggestions().length - 1));
      } else {
        e.preventDefault();
        textareaRef?.focus();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSuggestionIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const idx = activeSuggestionIdx();
      const suggestionsList = allSuggestions();
      if (idx >= 0 && idx < suggestionsList.length) {
        const item = suggestionsList[idx];
        executeSearchSuggestion(item);
      } else if (urlInput().trim()) {
        const query = urlInput().trim();
        if (isDomainPattern(query)) {
          handleLaunchUrl(query);
        } else {
          handleLaunchUrl(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
        }
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setActiveSuggestionIdx(-1);
      searchInputRef?.blur();
      textareaRef?.focus();
    }
  };
  const isDomainPattern = (str) => {
    return str.includes(".") && !str.includes(" ") && !str.startsWith("http://localhost") && !str.startsWith("localhost:");
  };
  const allSuggestions = () => {
    const query = urlInput().trim();
    if (!query) return [];
    const list = [];
    if (isDomainPattern(query)) {
      list.push({
        type: "app",
        label: `Navigate directly to ${query}`,
        value: query,
        subtitle: "Open website",
        appItem: {
          id: "temp_nav",
          name: query.split(".")[0],
          domain: query,
          url: query,
          category: "Tools"
        }
      });
      list.push({
        type: "add_app",
        label: `Add ${query} as custom workspace app`,
        value: query,
        appItem: {
          id: "temp_add",
          name: query.split(".")[0],
          domain: query,
          url: query,
          category: "Tools"
        }
      });
    }
    const lowercaseQuery = query.toLowerCase();
    const appMatches = profileApps().filter((app) => app.name.toLowerCase().includes(lowercaseQuery) || app.domain.toLowerCase().includes(lowercaseQuery));
    for (const app of appMatches.slice(0, 3)) {
      list.push({
        type: "app",
        label: `Launch ${app.name}`,
        value: app.url,
        subtitle: `App Directory • ${app.domain}`,
        appItem: app
      });
    }
    if (lowercaseQuery.startsWith("drive ")) {
      const dQuery = query.substring(6).trim();
      list.push({
        type: "shortcut",
        label: `Search Google Drive for "${dQuery}"`,
        value: `https://drive.google.com/drive/u/0/search?q=${encodeURIComponent(dQuery)}`,
        subtitle: "Google Workspace • Drive"
      });
    }
    if (lowercaseQuery.startsWith("sheet ")) {
      const sQuery = query.substring(6).trim();
      list.push({
        type: "shortcut",
        label: `Search Google Sheets for "${sQuery}"`,
        value: `https://docs.google.com/spreadsheets/u/0/?q=${encodeURIComponent(sQuery)}`,
        subtitle: "Google Workspace • Sheets"
      });
    }
    if (lowercaseQuery.startsWith("doc ")) {
      const docQuery = query.substring(4).trim();
      list.push({
        type: "shortcut",
        label: `Search Google Docs for "${docQuery}"`,
        value: `https://docs.google.com/document/u/0/?q=${encodeURIComponent(docQuery)}`,
        subtitle: "Google Workspace • Docs"
      });
    }
    if (lowercaseQuery.startsWith("canva ")) {
      const canvaQuery = query.substring(6).trim();
      list.push({
        type: "shortcut",
        label: `Search Canva Templates for "${canvaQuery}"`,
        value: `https://www.canva.com/templates/?query=${encodeURIComponent(canvaQuery)}`,
        subtitle: "Creative Marketing Templates"
      });
    }
    if ("drive".startsWith(lowercaseQuery)) {
      list.push({
        type: "shortcut",
        label: "drive [search_term]",
        value: "drive ",
        subtitle: "Search Google Drive Files",
        shortcutPrefix: "drive "
      });
    }
    if ("sheet".startsWith(lowercaseQuery)) {
      list.push({
        type: "shortcut",
        label: "sheet [search_term]",
        value: "sheet ",
        subtitle: "Search Google Sheets Spreadsheets",
        shortcutPrefix: "sheet "
      });
    }
    if ("doc".startsWith(lowercaseQuery)) {
      list.push({
        type: "shortcut",
        label: "doc [search_term]",
        value: "doc ",
        subtitle: "Search Google Docs Documents",
        shortcutPrefix: "doc "
      });
    }
    if ("canva".startsWith(lowercaseQuery)) {
      list.push({
        type: "shortcut",
        label: "canva [template_name]",
        value: "canva ",
        subtitle: "Search Canva Creative Templates",
        shortcutPrefix: "canva "
      });
    }
    for (const sug of suggestions().slice(0, 4)) {
      list.push({
        type: "google",
        label: sug,
        value: `https://www.google.com/search?q=${encodeURIComponent(sug)}`
      });
    }
    list.push({
      type: "google",
      label: `Search Google for "${query}"`,
      value: `https://www.google.com/search?q=${encodeURIComponent(query)}`
    });
    return list;
  };
  const executeSearchSuggestion = (item) => {
    if (item.type === "add_app") {
      setNewAppUrl(item.value);
      setShowAddCustomModal(true);
      setUrlInput("");
      setShowSuggestions(false);
      return;
    }
    if (item.shortcutPrefix) {
      setUrlInput(item.shortcutPrefix);
      setActiveSuggestionIdx(-1);
      searchInputRef?.focus();
      return;
    }
    handleLaunchUrl(item.value);
  };
  const handleGlobalMouseDown = (e) => {
    const target = e.target;
    if (suggestionsContainerRef && !suggestionsContainerRef.contains(target) && searchInputRef && !searchInputRef.contains(target)) {
      setShowSuggestions(false);
    }
    if (!target.closest(".profile-menu-container")) {
      setShowProfileMenu(false);
    }
  };
  onMount(() => {
    window.addEventListener("mousedown", handleGlobalMouseDown);
    onCleanup(() => {
      window.removeEventListener("mousedown", handleGlobalMouseDown);
    });
  });
  const handleNotesFocus = () => {
    setActiveView("notes");
  };
  const handleNotesBlur = () => {
    if (!notes().trim()) {
      setActiveView("command");
    }
  };
  const handleNotesKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      textareaRef?.blur();
      setActiveView("command");
      searchInputRef?.focus();
    }
  };
  return (() => {
    var _el$ = _tmpl$3$7();
    _el$.firstChild;
    insert(_el$, createComponent(Show, {
      get when() {
        return activeView() === "notes";
      },
      get fallback() {
        return (
          /* COMMAND MODE: Center-centered content */
          (() => {
            var _el$13 = _tmpl$6$6(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling, _el$18 = _el$15.nextSibling, _el$19 = _el$18.firstChild, _el$20 = _el$19.firstChild, _el$21 = _el$20.firstChild, _el$22 = _el$21.nextSibling, _el$23 = _el$22.nextSibling, _el$24 = _el$23.firstChild, _el$27 = _el$18.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$30 = _el$27.nextSibling, _el$31 = _el$30.firstChild;
            insert(_el$17, () => props.activeWorkspaceName);
            _el$22.$$keydown = handleKeyDown;
            _el$22.addEventListener("focus", () => {
              setShowSuggestions(true);
            });
            _el$22.$$input = (e) => {
              setUrlInput(e.currentTarget.value);
              setShowSuggestions(true);
              setActiveSuggestionIdx(-1);
            };
            var _ref$2 = searchInputRef;
            typeof _ref$2 === "function" ? use(_ref$2, _el$22) : searchInputRef = _el$22;
            _el$24.$$click = (e) => {
              e.stopPropagation();
              setShowProfileMenu(!showProfileMenu());
              setShowSuggestions(false);
            };
            insert(_el$24, () => (layoutStore.profiles.find((p) => p.id === props.profileId)?.name || "M").charAt(0).toUpperCase());
            insert(_el$23, createComponent(Show, {
              get when() {
                return showProfileMenu();
              },
              get children() {
                var _el$25 = _tmpl$4$7();
                insert(_el$25, createComponent(For, {
                  get each() {
                    return [{
                      id: "main",
                      color: "#64748b",
                      name: "Main"
                    }, ...layoutStore.profiles.filter((p) => p.id !== "main")];
                  },
                  children: (profile) => (() => {
                    var _el$32 = _tmpl$7$5(), _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling;
                    _el$32.$$click = () => {
                      props.onUpdate({
                        profileId: profile.id === "main" ? void 0 : profile.id
                      });
                      setShowProfileMenu(false);
                      searchInputRef?.focus();
                    };
                    insert(_el$33, () => profile.name.charAt(0).toUpperCase());
                    insert(_el$34, () => profile.name);
                    createRenderEffect((_p$) => {
                      var _v$3 = profile.color, _v$4 = `text-[13px] truncate ${props.profileId === profile.id || !props.profileId && profile.id === "main" ? "font-bold text-neutral-900" : "font-medium text-neutral-600"}`;
                      _v$3 !== _p$.e && setStyleProperty(_el$33, "background-color", _p$.e = _v$3);
                      _v$4 !== _p$.t && className(_el$34, _p$.t = _v$4);
                      return _p$;
                    }, {
                      e: void 0,
                      t: void 0
                    });
                    return _el$32;
                  })()
                }));
                return _el$25;
              }
            }), null);
            insert(_el$19, createComponent(Show, {
              get when() {
                return memo(() => !!showSuggestions())() && allSuggestions().length > 0;
              },
              get children() {
                var _el$26 = _tmpl$5$7();
                var _ref$3 = suggestionsContainerRef;
                typeof _ref$3 === "function" ? use(_ref$3, _el$26) : suggestionsContainerRef = _el$26;
                insert(_el$26, createComponent(For, {
                  get each() {
                    return allSuggestions();
                  },
                  children: (item, idx) => (() => {
                    var _el$35 = _tmpl$0$5(), _el$36 = _el$35.firstChild, _el$37 = _el$36.firstChild, _el$38 = _el$37.firstChild;
                    _el$35.$$click = () => executeSearchSuggestion(item);
                    insert(_el$36, createComponent(Show, {
                      get when() {
                        return item.appItem;
                      },
                      get fallback() {
                        return (() => {
                          var _el$41 = _tmpl$1$5();
                          insert(_el$41, createComponent(Switch, {
                            get children() {
                              return [createComponent(Match, {
                                get when() {
                                  return item.type === "google";
                                },
                                get children() {
                                  return createComponent(search_default, {
                                    "class": "w-3 h-3 text-neutral-500"
                                  });
                                }
                              }), createComponent(Match, {
                                get when() {
                                  return item.type === "add_app";
                                },
                                get children() {
                                  return createComponent(plus_default, {
                                    "class": "w-3 h-3 text-neutral-500"
                                  });
                                }
                              }), createComponent(Match, {
                                when: true,
                                get children() {
                                  return createComponent(globe_default, {
                                    "class": "w-3 h-3 text-neutral-500"
                                  });
                                }
                              })];
                            }
                          }));
                          return _el$41;
                        })();
                      },
                      get children() {
                        return createComponent(AppIcon, {
                          get app() {
                            return item.appItem;
                          },
                          "class": "w-5 h-5"
                        });
                      }
                    }), _el$37);
                    insert(_el$38, () => item.label);
                    insert(_el$37, createComponent(Show, {
                      get when() {
                        return item.subtitle;
                      },
                      get children() {
                        var _el$39 = _tmpl$8$5();
                        insert(_el$39, () => item.subtitle);
                        return _el$39;
                      }
                    }), null);
                    insert(_el$35, createComponent(Show, {
                      get when() {
                        return item.type === "app" || item.type === "shortcut";
                      },
                      get children() {
                        return _tmpl$9$5();
                      }
                    }), null);
                    createRenderEffect((_$p) => classList(_el$35, {
                      "bg-neutral-50 text-neutral-900 font-semibold": activeSuggestionIdx() === idx(),
                      "hover:bg-neutral-50/50 text-neutral-600": activeSuggestionIdx() !== idx()
                    }, _$p));
                    return _el$35;
                  })()
                }));
                return _el$26;
              }
            }), null);
            insert(_el$28, createComponent(For, {
              get each() {
                return profileApps();
              },
              children: (app, idx) => (() => {
                var _el$42 = _tmpl$10$5(), _el$43 = _el$42.firstChild, _el$44 = _el$43.nextSibling;
                _el$42.addEventListener("drop", (e) => handleDrop(idx(), e));
                _el$42.addEventListener("dragover", handleDragOver);
                _el$42.addEventListener("dragstart", (e) => handleDragStart(idx(), e));
                setAttribute(_el$42, "draggable", true);
                _el$43.$$click = () => handleLaunchUrl(app.url);
                insert(_el$43, createComponent(AppIcon, {
                  app,
                  "class": "w-6 h-6"
                }));
                _el$44.$$click = (e) => handleDeleteApp(idx(), e);
                insert(_el$44, createComponent(trash_2_default, {
                  "class": "w-2.5 h-2.5"
                }));
                return _el$42;
              })()
            }), _el$29);
            _el$29.$$click = () => setShowAddCustomModal(true);
            insert(_el$29, createComponent(plus_default, {
              "class": "w-4 h-4"
            }));
            _el$31.$$click = () => {
              setActiveView("notes");
              textareaRef?.focus();
            };
            createRenderEffect((_p$) => {
              var _v$ = layoutStore.profiles.find((p) => p.id === props.profileId)?.color || "#3b82f6", _v$2 = `Profile: ${layoutStore.profiles.find((p) => p.id === props.profileId)?.name || "Main"}`;
              _v$ !== _p$.e && setStyleProperty(_el$24, "background-color", _p$.e = _v$);
              _v$2 !== _p$.t && setAttribute(_el$24, "title", _p$.t = _v$2);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            createRenderEffect(() => _el$22.value = urlInput());
            return _el$13;
          })()
        );
      },
      get children() {
        var _el$3 = _tmpl$$8(), _el$4 = _el$3.firstChild;
        _el$4.$$keydown = handleNotesKeyDown;
        _el$4.addEventListener("blur", handleNotesBlur);
        _el$4.addEventListener("focus", handleNotesFocus);
        _el$4.$$input = (e) => setNotes(e.currentTarget.value);
        var _ref$ = textareaRef;
        typeof _ref$ === "function" ? use(_ref$, _el$4) : textareaRef = _el$4;
        createRenderEffect(() => _el$4.value = notes());
        return _el$3;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return showAddCustomModal();
      },
      get children() {
        var _el$5 = _tmpl$2$7(), _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$8.nextSibling, _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
        _el$1.$$input = (e) => setNewAppUrl(e.currentTarget.value);
        _el$11.$$click = () => {
          setShowAddCustomModal(false);
          setNewAppUrl("");
        };
        _el$12.$$click = handleSaveCustomApp;
        createRenderEffect(() => _el$12.disabled = !newAppUrl().trim());
        createRenderEffect(() => _el$1.value = newAppUrl());
        return _el$5;
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["input", "keydown", "click"]);
var _tmpl$$7 = /* @__PURE__ */ template(`<div class="absolute inset-0 w-full h-full z-0 bg-white">`), _tmpl$2$6 = /* @__PURE__ */ template(`<div class="w-full h-full bg-transparent relative">`), _tmpl$3$6 = /* @__PURE__ */ template(`<img class="w-5 h-5 rounded-sm object-contain animate-pulse">`), _tmpl$4$6 = /* @__PURE__ */ template(`<div class="absolute inset-0 pointer-events-none flex flex-col z-30 overflow-hidden"><div class="flex-1 bg-neutral-50 flex items-end justify-center pb-4 relative z-10"><div class="absolute bottom-0 left-0 right-0 h-[1px] bg-neutral-200 shadow-[0_4px_12px_rgba(0,0,0,0.03)]"></div></div><div class="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex justify-center z-40"><div class="bg-neutral-200/50 p-1.5 rounded-[2rem] ring-1 ring-black/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.1)] backdrop-blur-xl"><div class="bg-white rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] flex items-center px-4 h-12 gap-3"><span class="text-neutral-800 text-[14px] font-sans font-medium tracking-tight pr-1"></span></div></div></div><div class="flex-1 bg-neutral-50 flex items-start justify-center pt-4 relative z-10"><div class="absolute top-0 left-0 right-0 h-[1px] bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">`), _tmpl$5$6 = /* @__PURE__ */ template(`<div class="absolute top-2 left-1/2 -translate-x-1/2 z-[10000] pointer-events-auto group/zen-exit flex justify-center items-start h-12 w-64"><div class="absolute top-0 w-10 h-1.5 rounded-full bg-neutral-900/15 dark:bg-white/20 transition-all duration-300 group-hover/zen-exit:opacity-0 group-hover/zen-exit:scale-75 backdrop-blur-md"></div><button class="absolute top-0 flex items-center gap-2.5 bg-white/90 dark:bg-neutral-800/90 backdrop-blur-xl border border-neutral-200/50 dark:border-neutral-700/50 px-3.5 py-1.5 rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-all duration-400 ease-[cubic-bezier(0.34,1.56,0.64,1)] scale-90 opacity-0 -translate-y-4 pointer-events-none group-hover/zen-exit:pointer-events-auto group-hover/zen-exit:opacity-100 group-hover/zen-exit:scale-100 group-hover/zen-exit:translate-y-0"><span class="text-neutral-700 dark:text-neutral-300 text-[11px] font-medium tracking-wide">Exit Focus</span><div class="flex gap-1"><div class="bg-neutral-100 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">ESC</div><div class="bg-neutral-100 dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 text-[9px] font-bold px-1.5 py-0.5 rounded shadow-sm">Alt+F`), _tmpl$6$5 = /* @__PURE__ */ template(`<div class="absolute inset-0 bg-neutral-100 z-10 pointer-events-none">`), _tmpl$7$4 = /* @__PURE__ */ template(`<div class="absolute inset-0 flex items-center justify-center bg-white/30 backdrop-blur-sm z-20 pointer-events-none"><div class="px-4 py-2 bg-neutral-900/90 text-white text-[11px] font-semibold tracking-widest uppercase rounded-full shadow-2xl">Restoring…`), _tmpl$8$4 = /* @__PURE__ */ template(`<div class="absolute inset-0 bg-neutral-900 z-[5] pointer-events-none">`), _tmpl$9$4 = /* @__PURE__ */ template(`<div class="absolute inset-0 flex items-center justify-center bg-white/10 backdrop-blur-sm z-10 cursor-pointer transition-all duration-700"><div class="px-5 py-2.5 bg-neutral-900/90 text-white text-[11px] font-semibold tracking-widest uppercase rounded-full shadow-2xl hover:scale-105 active:scale-95 transition-all duration-300">Click to Wake`), _tmpl$0$4 = /* @__PURE__ */ template(`<button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Copy Link Address`), _tmpl$1$4 = /* @__PURE__ */ template(`<button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Copy Image Address`), _tmpl$10$4 = /* @__PURE__ */ template(`<div class="pane-context-menu fixed z-[9999] pointer-events-auto"><div class="p-1.5 bg-white/80 backdrop-blur-3xl ring-1 ring-black/5 rounded-[20px] shadow-[0_24px_56px_-24px_rgba(0,0,0,0.2)] animate-in zoom-in-95 fade-in duration-200"><div class="bg-white rounded-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] min-w-[220px] flex flex-col p-1"><div class="px-2 pt-1.5 pb-1 flex items-center"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.1em]">Workspace Actions</span></div><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group"></button><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Capture App Screenshot</button><div class="w-full h-px bg-neutral-100 my-1"></div><div class="px-2 pt-1 pb-1 flex items-center"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.1em]">Clipboard</span></div><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Copy Pane URL</button><div class="w-full h-px bg-neutral-100 my-1"></div><div class="px-2 pt-1 pb-1 flex items-center"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-[0.1em]">Memory & Battery</span></div><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Reload App</button><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-100 px-2.5 py-1.5 rounded-[8px] transition-colors group">Pause Background Apps</button><button class="w-full text-left flex items-center gap-2.5 text-[12px] font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-[8px] transition-colors group">Suspend All Apps`), _tmpl$11$3 = /* @__PURE__ */ template(`<div><div class="flex-1 relative overflow-hidden flex flex-col">`), _tmpl$12$3 = /* @__PURE__ */ template(`<div class="w-full h-full overflow-y-auto">`), _tmpl$13$2 = /* @__PURE__ */ template(`<iframe class="absolute inset-0 w-full h-full border-none outline-none z-0 bg-white">`);
const gateTriggeredSet = /* @__PURE__ */ new Set();
function Pane(props) {
  const [isHibernated, setIsHibernated] = createSignal(false);
  createSignal("");
  const [currentUrl, setCurrentUrl] = createSignal(props.url);
  const [currentType, setCurrentType] = createSignal(props.paneType);
  const [frozenFrame, setFrozenFrame] = createSignal("");
  const [isRestoring, setIsRestoring] = createSignal(false);
  createSignal(false);
  const [isInitialGate, setIsInitialGate] = createSignal(false);
  const [gateLabel, setGateLabel] = createSignal("");
  const [gateDomain, setGateDomain] = createSignal("");
  let topGateRef;
  let bottomGateRef;
  let pillRef;
  let gateContainerRef;
  createSignal(null);
  createSignal(false);
  const isBlank = () => !currentUrl() && currentType() !== "terminal" && !props.children;
  const canDeepHibernate = () => currentType() === "web" && !!currentUrl() && !isBlank();
  createEffect(() => {
    setCurrentUrl(props.url);
    setCurrentType(props.paneType);
  });
  createEffect(() => {
    const url = currentUrl();
    if (url) {
      if (currentType() === "web" && !gateTriggeredSet.has(props.id) && !window.IS_WEB_DEMO) {
        gateTriggeredSet.add(props.id);
        try {
          const u = new URL(url);
          setGateLabel(u.hostname);
          setGateDomain(u.hostname);
        } catch {
          setGateLabel(url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]);
          setGateDomain(url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]);
        }
        setIsInitialGate(true);
        setTimeout(() => {
          if (topGateRef && bottomGateRef && pillRef && gateContainerRef) {
            gsapWithCSS.to(pillRef, {
              scale: 0.8,
              opacity: 0,
              duration: 0.4,
              ease: "power3.in"
            });
            gsapWithCSS.to(topGateRef, {
              yPercent: -100,
              duration: 1.2,
              ease: "expo.inOut",
              delay: 0.1
            });
            gsapWithCSS.to(bottomGateRef, {
              yPercent: 100,
              duration: 1.2,
              ease: "expo.inOut",
              delay: 0.1,
              onComplete: () => setIsInitialGate(false)
            });
            gsapWithCSS.to(gateContainerRef, {
              opacity: 0,
              duration: 0.4,
              delay: 1.1
            });
          } else {
            setIsInitialGate(false);
          }
        }, 800);
      }
      window.api?.viewCreate?.(props.id, url, props.profileId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pane-target-mounted", {
          detail: props.id
        }));
      }
    }
  });
  const onPaneActivity = () => {
    if (isHibernated()) wake();
  };
  const wake = () => {
    setIsHibernated(false);
  };
  createEffect(() => {
    if (!isHibernated()) {
      if (frozenFrame() && canDeepHibernate()) {
        setIsRestoring(true);
        window.api?.viewRespawn?.(props.id).then(() => {
          window.dispatchEvent(new CustomEvent("pane-target-mounted", {
            detail: props.id
          }));
        });
      } else {
        window.api?.viewWake?.(props.id);
      }
      return;
    }
    if (canDeepHibernate()) {
      window.api?.viewHibernate?.(props.id).then((dataUrl) => {
        if (isHibernated()) setFrozenFrame(dataUrl);
      });
    } else {
      if (window.api?.viewCapture) {
        window.api.viewCapture(props.id).then((dataUrl) => {
          if (isHibernated()) {
            setFrozenFrame(dataUrl);
            window.api?.viewSleep?.(props.id);
          }
        });
      } else {
        window.api?.viewSleep?.(props.id);
      }
    }
  });
  const onRestored = (e) => {
    const detail = e.detail;
    if (detail === props.id) {
      setIsRestoring(false);
      setFrozenFrame("");
    }
  };
  const [contextMenu, setContextMenu] = createSignal(null);
  onMount(() => {
    window.addEventListener("pane.restored", onRestored);
    const onForceGate = (e) => {
      if (window.IS_WEB_DEMO) return;
      const detail = e.detail;
      if (detail.id === props.id) {
        gateTriggeredSet.delete(props.id);
        const url = detail.url;
        try {
          const u = new URL(url);
          setGateLabel(u.hostname);
          setGateDomain(u.hostname);
        } catch {
          setGateLabel(url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]);
          setGateDomain(url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]);
        }
        setIsInitialGate(true);
        setTimeout(() => {
          if (topGateRef && bottomGateRef && pillRef && gateContainerRef) {
            gsapWithCSS.to(pillRef, {
              scale: 0.8,
              opacity: 0,
              duration: 0.4,
              ease: "power3.in"
            });
            gsapWithCSS.to(topGateRef, {
              yPercent: -100,
              duration: 1.2,
              ease: "expo.inOut",
              delay: 0.1
            });
            gsapWithCSS.to(bottomGateRef, {
              yPercent: 100,
              duration: 1.2,
              ease: "expo.inOut",
              delay: 0.1,
              onComplete: () => setIsInitialGate(false)
            });
            gsapWithCSS.to(gateContainerRef, {
              opacity: 0,
              duration: 0.4,
              delay: 1.1
            });
          } else {
            setIsInitialGate(false);
          }
        }, 800);
      }
    };
    window.addEventListener("pane.force-gate", onForceGate);
    const onLoaded = (e) => {
    };
    window.addEventListener("pane.loaded", onLoaded);
    window.addEventListener("app:hibernate-pane", (e) => {
      if (e.detail === props.id || e.detail === "background" && !props.isActivePane) {
        setIsHibernated(true);
      } else if (e.detail === "all") {
        setIsHibernated(true);
      }
    });
    const handleContextMenu = (e) => {
      if (e.detail.paneId === props.id) {
        let offsetX = 0;
        let offsetY = 0;
        if (paneRef) {
          const rect = paneRef.getBoundingClientRect();
          offsetX = rect.left;
          offsetY = rect.top;
        }
        setContextMenu({
          x: e.detail.x + offsetX,
          y: e.detail.y + offsetY,
          linkURL: e.detail.linkURL,
          srcURL: e.detail.srcURL
        });
      } else {
        setContextMenu(null);
      }
    };
    window.addEventListener("app:pane-context-menu", handleContextMenu);
    const handlePaneClicked = () => {
      setContextMenu(null);
    };
    window.addEventListener("app:pane-clicked", handlePaneClicked);
    const handleGlobalClick = (e) => {
      const target = e.target;
      if (!target.closest(".pane-context-menu")) {
        setContextMenu(null);
      }
    };
    window.addEventListener("pointerdown", handleGlobalClick);
    onCleanup(() => {
      window.removeEventListener("pane.restored", onRestored);
      window.removeEventListener("pane.force-gate", onForceGate);
      window.removeEventListener("pane.loaded", onLoaded);
      window.removeEventListener("app:pane-context-menu", handleContextMenu);
      window.removeEventListener("app:pane-clicked", handlePaneClicked);
      window.removeEventListener("pointerdown", handleGlobalClick);
      window.api?.viewDestroy?.(props.id);
    });
  });
  const launchApp = (type, launchUrl) => {
    setCurrentType(type);
    let finalUrl = launchUrl;
    if (type === "terminal") {
      finalUrl = `http://localhost:5174/#terminal/${props.id}`;
    }
    setCurrentUrl(finalUrl);
    props.onUpdate?.({
      url: finalUrl,
      paneType: type
    });
  };
  let paneRef;
  const profileColor = () => layoutStore.profiles.find((p) => p.id === (props.profileId || "main"))?.color || "#3b82f6";
  return (() => {
    var _el$ = _tmpl$11$3(), _el$2 = _el$.firstChild;
    _el$.$$click = () => {
      wake();
      props.onActive?.();
    };
    _el$.$$mousedown = () => props.onActive?.();
    _el$.$$focusin = () => {
      onPaneActivity();
      props.onActive?.();
    };
    _el$.addEventListener("mouseenter", wake);
    _el$.$$mousemove = onPaneActivity;
    var _ref$ = paneRef;
    typeof _ref$ === "function" ? use(_ref$, _el$) : paneRef = _el$;
    insert(_el$2, createComponent(Show, {
      get when() {
        return !isBlank();
      },
      get fallback() {
        return createComponent(DefaultPanel, {
          get id() {
            return props.id;
          },
          get profileId() {
            return props.profileId || "main";
          },
          onLaunch: launchApp,
          onUpdate: (data) => props.onUpdate?.(data),
          get activeWorkspaceName() {
            return props.activeWorkspaceName || "";
          },
          get onApplyTemplate() {
            return props.onApplyTemplate;
          }
        });
      },
      get children() {
        return [(() => {
          var _el$3 = _tmpl$2$6();
          insert(_el$3, createComponent(Show, {
            get when() {
              return !props.children;
            },
            get fallback() {
              return (() => {
                var _el$41 = _tmpl$12$3();
                insert(_el$41, () => props.children);
                return _el$41;
              })();
            },
            get children() {
              return createComponent(Show, {
                get when() {
                  return window.IS_WEB_DEMO;
                },
                get children() {
                  return createComponent(Show, {
                    get when() {
                      return memo(() => !!currentUrl()?.startsWith("mock://"))() && window.DemoPaneRenderer;
                    },
                    get fallback() {
                      return (() => {
                        var _el$42 = _tmpl$13$2();
                        use((el) => {
                          if (el) {
                            el.onload = () => {
                              try {
                                const doc = el.contentDocument || el.contentWindow?.document;
                                if (doc) {
                                  const style2 = doc.createElement("style");
                                  style2.innerHTML = `
                              body { 
                                overflow-y: auto !important; 
                                height: auto !important; 
                                position: static !important; 
                                overscroll-behavior: contain !important;
                              }
                              ::-webkit-scrollbar {
                                width: 6px;
                              }
                              ::-webkit-scrollbar-track {
                                background: transparent;
                              }
                              ::-webkit-scrollbar-thumb {
                                background: rgba(100, 116, 139, 0.2);
                                border-radius: 9999px;
                              }
                              ::-webkit-scrollbar-thumb:hover {
                                background: rgba(100, 116, 139, 0.4);
                              }
                            `;
                                  doc.head.appendChild(style2);
                                  doc.addEventListener("wheel", (e) => {
                                    const customEvent = new CustomEvent("demo-wheel", {
                                      detail: {
                                        deltaY: e.deltaY
                                      },
                                      bubbles: true,
                                      cancelable: true
                                    });
                                    const canceled = !el.dispatchEvent(customEvent);
                                    if (canceled) {
                                      e.preventDefault();
                                    }
                                  }, {
                                    passive: false
                                  });
                                  let touchStartY = 0;
                                  doc.addEventListener("touchstart", (ev) => {
                                    touchStartY = ev.touches[0].clientY;
                                  }, {
                                    passive: true
                                  });
                                  doc.addEventListener("touchmove", (ev) => {
                                    const deltaY = touchStartY - ev.touches[0].clientY;
                                    const customEvent = new CustomEvent("demo-wheel", {
                                      detail: {
                                        deltaY
                                      },
                                      bubbles: true,
                                      cancelable: true
                                    });
                                    const canceled = !el.dispatchEvent(customEvent);
                                    if (canceled) {
                                      ev.preventDefault();
                                    }
                                  }, {
                                    passive: false
                                  });
                                }
                              } catch (e) {
                                console.error("Failed to inject scroll style", e);
                              }
                            };
                          }
                        }, _el$42);
                        createRenderEffect(() => setAttribute(_el$42, "src", (() => {
                          const url = currentUrl() || "";
                          if (!url) return url;
                          const u = url.toLowerCase();
                          if (u.includes("github.com")) return "/mocks/github.html?v=3";
                          if (u.includes("hubspot.com")) return "/mocks/hubspot.html";
                          if (u.includes("stripe.com")) return "/mocks/stripe.html";
                          if (u.includes("slack.com")) return "/mocks/slack.html?v=3";
                          if (u.includes("mail.google.com")) return "/mocks/gmail.html";
                          if (u.includes("google.com") || u.includes("sheets")) return "/mocks/sheets.html";
                          if (u.includes("upwork.com")) return "/mocks/upwork.html?v=3";
                          if (u.includes("fiverr.com")) return "/mocks/fiverr.html?v=3";
                          if (u.includes("jira.atlassian.com")) return "/mocks/jira.html";
                          if (u.includes("linear.app")) return "/mocks/linear.html";
                          if (u.includes("salesforce-1.com")) return "/mocks/salesforce-1.html";
                          if (u.includes("salesforce-2.com")) return "/mocks/salesforce-2.html";
                          if (u.includes("salesforce-3.com")) return "/mocks/salesforce-3.html";
                          if (u.includes("salesforce.com")) return "/mocks/salesforce.html";
                          if (u.includes("whatsapp.com")) return "/mocks/whatsapp.html";
                          if (u.includes("todoist.com")) return "/mocks/todoist.html";
                          if (u.includes("localhost:5174")) return "";
                          return "/mocks/meta-ads.html";
                        })()));
                        return _el$42;
                      })();
                    },
                    get children() {
                      var _el$4 = _tmpl$$7();
                      insert(_el$4, () => {
                        const Renderer = window.DemoPaneRenderer;
                        return createComponent(Renderer, {
                          get url() {
                            return currentUrl();
                          }
                        });
                      });
                      return _el$4;
                    }
                  });
                }
              });
            }
          }));
          createRenderEffect(() => setAttribute(_el$3, "id", `webview-container-${props.id}`));
          return _el$3;
        })(), createComponent(Show, {
          get when() {
            return isInitialGate();
          },
          get children() {
            var _el$5 = _tmpl$4$6(), _el$6 = _el$5.firstChild, _el$7 = _el$6.nextSibling, _el$8 = _el$7.firstChild, _el$9 = _el$8.firstChild, _el$1 = _el$9.firstChild, _el$10 = _el$7.nextSibling;
            var _ref$2 = gateContainerRef;
            typeof _ref$2 === "function" ? use(_ref$2, _el$5) : gateContainerRef = _el$5;
            var _ref$3 = topGateRef;
            typeof _ref$3 === "function" ? use(_ref$3, _el$6) : topGateRef = _el$6;
            var _ref$4 = pillRef;
            typeof _ref$4 === "function" ? use(_ref$4, _el$7) : pillRef = _el$7;
            insert(_el$9, createComponent(Show, {
              get when() {
                return gateDomain();
              },
              get children() {
                var _el$0 = _tmpl$3$6();
                createRenderEffect(() => setAttribute(_el$0, "src", `https://www.google.com/s2/favicons?domain=${gateDomain()}&sz=128`));
                return _el$0;
              }
            }), _el$1);
            insert(_el$1, () => gateLabel() || "Preparing Workspace");
            var _ref$5 = bottomGateRef;
            typeof _ref$5 === "function" ? use(_ref$5, _el$10) : bottomGateRef = _el$10;
            return _el$5;
          }
        })];
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return layoutStore.maximizedPaneId === props.id;
      },
      get children() {
        var _el$11 = _tmpl$5$6(), _el$12 = _el$11.firstChild, _el$13 = _el$12.nextSibling;
        _el$13.$$click = () => setLayoutStore("maximizedPaneId", null);
        return _el$11;
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => !!isHibernated())() && canDeepHibernate();
      },
      get children() {
        return [_tmpl$6$5(), createComponent(Show, {
          get when() {
            return isRestoring();
          },
          get children() {
            return _tmpl$7$4();
          }
        })];
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return memo(() => !!(isHibernated() && !canDeepHibernate()))() && !isBlank();
      },
      get children() {
        return [_tmpl$8$4(), (() => {
          var _el$17 = _tmpl$9$4();
          _el$17.addEventListener("mouseenter", () => wake());
          _el$17.$$click = () => wake();
          return _el$17;
        })()];
      }
    }), null);
    insert(_el$2, createComponent(Show, {
      get when() {
        return contextMenu();
      },
      get children() {
        return createComponent(Portal, {
          get children() {
            var _el$18 = _tmpl$10$4(), _el$19 = _el$18.firstChild, _el$20 = _el$19.firstChild, _el$21 = _el$20.firstChild, _el$22 = _el$21.nextSibling, _el$23 = _el$22.nextSibling, _el$24 = _el$23.firstChild, _el$25 = _el$23.nextSibling, _el$26 = _el$25.nextSibling, _el$31 = _el$26.nextSibling, _el$32 = _el$31.firstChild, _el$33 = _el$31.nextSibling, _el$34 = _el$33.nextSibling, _el$35 = _el$34.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$35.nextSibling, _el$38 = _el$37.firstChild, _el$39 = _el$37.nextSibling, _el$40 = _el$39.firstChild;
            _el$22.$$click = () => {
              setLayoutStore("maximizedPaneId", layoutStore.maximizedPaneId === props.id ? null : props.id);
              setContextMenu(null);
            };
            insert(_el$22, createComponent(maximize_default, {
              "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-blue-500 transition-colors"
            }), null);
            insert(_el$22, () => layoutStore.maximizedPaneId === props.id ? "Exit Full Screen" : "Focus App (Full Screen)", null);
            _el$23.$$click = () => {
              window.api?.viewScreenshot?.(props.id);
              setContextMenu(null);
            };
            insert(_el$23, createComponent(camera_default, {
              "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-emerald-500 transition-colors"
            }), _el$24);
            insert(_el$20, createComponent(Show, {
              get when() {
                return contextMenu()?.linkURL;
              },
              get children() {
                var _el$27 = _tmpl$0$4(), _el$28 = _el$27.firstChild;
                _el$27.$$click = () => {
                  navigator.clipboard.writeText(contextMenu().linkURL);
                  setContextMenu(null);
                };
                insert(_el$27, createComponent(link_default, {
                  "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-700"
                }), _el$28);
                return _el$27;
              }
            }), _el$31);
            insert(_el$20, createComponent(Show, {
              get when() {
                return contextMenu()?.srcURL;
              },
              get children() {
                var _el$29 = _tmpl$1$4(), _el$30 = _el$29.firstChild;
                _el$29.$$click = () => {
                  navigator.clipboard.writeText(contextMenu().srcURL);
                  setContextMenu(null);
                };
                insert(_el$29, createComponent(image_default, {
                  "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-700"
                }), _el$30);
                return _el$29;
              }
            }), _el$31);
            _el$31.$$click = () => {
              navigator.clipboard.writeText(currentUrl() || "");
              setContextMenu(null);
            };
            insert(_el$31, createComponent(copy_default, {
              "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-700"
            }), _el$32);
            _el$35.$$click = () => {
              window.api?.viewReload?.(props.id);
              setContextMenu(null);
            };
            insert(_el$35, createComponent(refresh_cw_default, {
              "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-neutral-700"
            }), _el$36);
            _el$37.$$click = () => {
              window.dispatchEvent(new CustomEvent("app:hibernate-pane", {
                detail: "background"
              }));
              setContextMenu(null);
            };
            insert(_el$37, createComponent(moon_default, {
              "class": "w-3.5 h-3.5 text-neutral-400 group-hover:text-indigo-500 transition-colors"
            }), _el$38);
            _el$39.$$click = () => {
              window.dispatchEvent(new CustomEvent("app:hibernate-pane", {
                detail: "all"
              }));
              setContextMenu(null);
            };
            insert(_el$39, createComponent(bed_default, {
              "class": "w-3.5 h-3.5 text-red-400 group-hover:text-red-600 transition-colors"
            }), _el$40);
            createRenderEffect((_p$) => {
              var _v$ = `${contextMenu().y}px`, _v$2 = `${contextMenu().x}px`, _v$3 = `translate(${contextMenu().x > window.innerWidth - 250 ? "-100%" : "0"}, ${contextMenu().y > window.innerHeight - 200 ? "-100%" : "0"})`;
              _v$ !== _p$.e && setStyleProperty(_el$18, "top", _p$.e = _v$);
              _v$2 !== _p$.t && setStyleProperty(_el$18, "left", _p$.t = _v$2);
              _v$3 !== _p$.a && setStyleProperty(_el$18, "transform", _p$.a = _v$3);
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$18;
          }
        });
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$4 = `w-full h-full flex flex-col bg-transparent rounded-[12px] overflow-hidden transition-all duration-500 relative group/pane ${layoutStore.maximizedPaneId === props.id && props.isActivePane ? "ring-2 ring-inset" : ""}`, _v$5 = layoutStore.maximizedPaneId === props.id && props.isActivePane ? {
        "--tw-ring-color": `${profileColor()}66`
      } : {};
      _v$4 !== _p$.e && className(_el$, _p$.e = _v$4);
      _p$.t = style(_el$, _v$5, _p$.t);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
delegateEvents(["mousemove", "focusin", "mousedown", "click"]);
const getSmartIcon = (name, props) => {
  const n = name.toLowerCase();
  const p = {
    size: 14,
    strokeWidth: 2,
    ...props
  };
  if (/\bclient/.test(n)) return createComponent(briefcase_default, p);
  if (/\bproject/.test(n) || /\blaunch/.test(n)) return createComponent(rocket_default, p);
  if (/\bdev/.test(n) || /\bcode/.test(n)) return createComponent(code_xml_default, p);
  if (/\bdesign/.test(n) || /\bart/.test(n)) return createComponent(palette_default, p);
  if (/\bmarketing/.test(n) || /\bgrowth/.test(n)) return createComponent(trending_up_default, p);
  if (/\bpersonal/.test(n) || /\bhq/.test(n) || /\bheadquarters/.test(n)) return createComponent(house_default, p);
  if (/\bdraft/.test(n) || /\bplay/.test(n)) return createComponent(gamepad_2_default, p);
  return createComponent(folder_default, p);
};
/*!
 * matrix 3.15.0
 * https://gsap.com
 *
 * Copyright 2008-2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license
 * @author: Jack Doyle, jack@greensock.com
*/
var _doc, _win, _docElement, _body$1, _divContainer, _svgContainer, _identityMatrix, _gEl, _transformProp = "transform", _transformOriginProp = _transformProp + "Origin", _hasOffsetBug, _setDoc = function _setDoc2(element) {
  var doc = element.ownerDocument || element;
  if (!(_transformProp in element.style) && "msTransform" in element.style) {
    _transformProp = "msTransform";
    _transformOriginProp = _transformProp + "Origin";
  }
  while (doc.parentNode && (doc = doc.parentNode)) {
  }
  _win = window;
  _identityMatrix = new Matrix2D();
  if (doc) {
    _doc = doc;
    _docElement = doc.documentElement;
    _body$1 = doc.body;
    _gEl = _doc.createElementNS("http://www.w3.org/2000/svg", "g");
    _gEl.style.transform = "none";
    var d1 = doc.createElement("div"), d2 = doc.createElement("div"), root = doc && (doc.body || doc.firstElementChild);
    if (root && root.appendChild) {
      root.appendChild(d1);
      d1.appendChild(d2);
      d1.style.position = "static";
      d1.style.transform = "translate3d(0,0,1px)";
      _hasOffsetBug = d2.offsetParent !== d1;
      root.removeChild(d1);
    }
  }
  return doc;
}, _forceNonZeroScale = function _forceNonZeroScale2(e) {
  var a, cache;
  while (e && e !== _body$1) {
    cache = e._gsap;
    cache && cache.uncache && cache.get(e, "x");
    if (cache && !cache.scaleX && !cache.scaleY && cache.renderTransform) {
      cache.scaleX = cache.scaleY = 1e-4;
      cache.renderTransform(1, cache);
      a ? a.push(cache) : a = [cache];
    }
    e = e.parentNode;
  }
  return a;
}, _svgTemps = [], _divTemps = [], _getDocScrollTop = function _getDocScrollTop2() {
  return _win.pageYOffset || _doc.scrollTop || _docElement.scrollTop || _body$1.scrollTop || 0;
}, _getDocScrollLeft = function _getDocScrollLeft2() {
  return _win.pageXOffset || _doc.scrollLeft || _docElement.scrollLeft || _body$1.scrollLeft || 0;
}, _svgOwner = function _svgOwner2(element) {
  return element.ownerSVGElement || ((element.tagName + "").toLowerCase() === "svg" ? element : null);
}, _isFixed = function _isFixed2(element) {
  if (_win.getComputedStyle(element).position === "fixed") {
    return true;
  }
  element = element.parentNode;
  if (element && element.nodeType === 1) {
    return _isFixed2(element);
  }
}, _createSibling = function _createSibling2(element, i) {
  if (element.parentNode && (_doc || _setDoc(element))) {
    var svg = _svgOwner(element), ns = svg ? svg.getAttribute("xmlns") || "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml", type = svg ? i ? "rect" : "g" : "div", x = i !== 2 ? 0 : 100, y = i === 3 ? 100 : 0, css = {
      position: "absolute",
      display: "block",
      pointerEvents: "none",
      margin: "0",
      padding: "0"
    }, e = _doc.createElementNS ? _doc.createElementNS(ns.replace(/^https/, "http"), type) : _doc.createElement(type);
    if (i) {
      if (!svg) {
        if (!_divContainer) {
          _divContainer = _createSibling2(element);
          Object.assign(_divContainer.style, css);
        }
        Object.assign(e.style, css, {
          width: "0.1px",
          height: "0.1px",
          top: y + "px",
          left: x + "px"
        });
        _divContainer.appendChild(e);
      } else {
        _svgContainer || (_svgContainer = _createSibling2(element));
        e.setAttribute("width", 0.01);
        e.setAttribute("height", 0.01);
        e.setAttribute("transform", "translate(" + x + "," + y + ")");
        e.setAttribute("fill", "transparent");
        _svgContainer.appendChild(e);
      }
    }
    return e;
  }
  throw "Need document and parent.";
}, _consolidate = function _consolidate2(m) {
  var c = new Matrix2D(), i = 0;
  for (; i < m.numberOfItems; i++) {
    c.multiply(m.getItem(i).matrix);
  }
  return c;
}, _getCTM = function _getCTM2(svg) {
  var m = svg.getCTM(), transform;
  if (!m) {
    transform = svg.style[_transformProp];
    svg.style[_transformProp] = "none";
    svg.appendChild(_gEl);
    m = _gEl.getCTM();
    svg.removeChild(_gEl);
    transform ? svg.style[_transformProp] = transform : svg.style.removeProperty(_transformProp.replace(/([A-Z])/g, "-$1").toLowerCase());
  }
  return m || _identityMatrix.clone();
}, _placeSiblings = function _placeSiblings2(element, adjustGOffset) {
  var svg = _svgOwner(element), isRootSVG = element === svg, siblings = svg ? _svgTemps : _divTemps, parent = element.parentNode, appendToEl = parent && !svg && parent.shadowRoot && parent.shadowRoot.appendChild ? parent.shadowRoot : parent, container, m, b, x, y, cs;
  if (element === _win) {
    return element;
  }
  siblings.length || siblings.push(_createSibling(element, 1), _createSibling(element, 2), _createSibling(element, 3));
  container = svg ? _svgContainer : _divContainer;
  if (svg) {
    if (isRootSVG) {
      b = _getCTM(element);
      x = -b.e / b.a;
      y = -b.f / b.d;
      m = _identityMatrix;
    } else if (element.getBBox) {
      b = element.getBBox();
      m = element.transform ? element.transform.baseVal : {};
      m = !m.numberOfItems ? _identityMatrix : m.numberOfItems > 1 ? _consolidate(m) : m.getItem(0).matrix;
      x = m.a * b.x + m.c * b.y;
      y = m.b * b.x + m.d * b.y;
    } else {
      m = new Matrix2D();
      x = y = 0;
    }
    if (adjustGOffset && element.tagName.toLowerCase() === "g") {
      x = y = 0;
    }
    (isRootSVG || !element.getBoundingClientRect().width ? svg : parent).appendChild(container);
    container.setAttribute("transform", "matrix(" + m.a + "," + m.b + "," + m.c + "," + m.d + "," + (m.e + x) + "," + (m.f + y) + ")");
  } else {
    x = y = 0;
    if (_hasOffsetBug) {
      m = element.offsetParent;
      b = element;
      while (b && (b = b.parentNode) && b !== m && b.parentNode) {
        if ((_win.getComputedStyle(b)[_transformProp] + "").length > 4) {
          x = b.offsetLeft;
          y = b.offsetTop;
          b = 0;
        }
      }
    }
    cs = _win.getComputedStyle(element);
    if (cs.position !== "absolute" && cs.position !== "fixed") {
      m = element.offsetParent;
      while (parent && parent !== m) {
        x += parent.scrollLeft || 0;
        y += parent.scrollTop || 0;
        parent = parent.parentNode;
      }
    }
    b = container.style;
    b.top = element.offsetTop - y + "px";
    b.left = element.offsetLeft - x + "px";
    b[_transformProp] = cs[_transformProp];
    b[_transformOriginProp] = cs[_transformOriginProp];
    b.position = cs.position === "fixed" ? "fixed" : "absolute";
    appendToEl.appendChild(container);
  }
  return container;
}, _setMatrix = function _setMatrix2(m, a, b, c, d, e, f) {
  m.a = a;
  m.b = b;
  m.c = c;
  m.d = d;
  m.e = e;
  m.f = f;
  return m;
};
var Matrix2D = /* @__PURE__ */ (function() {
  function Matrix2D2(a, b, c, d, e, f) {
    if (a === void 0) {
      a = 1;
    }
    if (b === void 0) {
      b = 0;
    }
    if (c === void 0) {
      c = 0;
    }
    if (d === void 0) {
      d = 1;
    }
    if (e === void 0) {
      e = 0;
    }
    if (f === void 0) {
      f = 0;
    }
    _setMatrix(this, a, b, c, d, e, f);
  }
  var _proto = Matrix2D2.prototype;
  _proto.inverse = function inverse() {
    var a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f, determinant = a * d - b * c || 1e-10;
    return _setMatrix(this, d / determinant, -b / determinant, -c / determinant, a / determinant, (c * f - d * e) / determinant, -(a * f - b * e) / determinant);
  };
  _proto.multiply = function multiply(matrix) {
    var a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f, a2 = matrix.a, b2 = matrix.c, c2 = matrix.b, d2 = matrix.d, e2 = matrix.e, f2 = matrix.f;
    return _setMatrix(this, a2 * a + c2 * c, a2 * b + c2 * d, b2 * a + d2 * c, b2 * b + d2 * d, e + e2 * a + f2 * c, f + e2 * b + f2 * d);
  };
  _proto.clone = function clone() {
    return new Matrix2D2(this.a, this.b, this.c, this.d, this.e, this.f);
  };
  _proto.equals = function equals(matrix) {
    var a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f;
    return a === matrix.a && b === matrix.b && c === matrix.c && d === matrix.d && e === matrix.e && f === matrix.f;
  };
  _proto.apply = function apply(point, decoratee) {
    if (decoratee === void 0) {
      decoratee = {};
    }
    var x = point.x, y = point.y, a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f;
    decoratee.x = x * a + y * c + e || 0;
    decoratee.y = x * b + y * d + f || 0;
    return decoratee;
  };
  return Matrix2D2;
})();
function getGlobalMatrix(element, inverse, adjustGOffset, includeScrollInFixed) {
  if (!element || !element.parentNode || (_doc || _setDoc(element)).documentElement === element) {
    return new Matrix2D();
  }
  var zeroScales = _forceNonZeroScale(element), svg = _svgOwner(element), temps = svg ? _svgTemps : _divTemps, container = _placeSiblings(element, adjustGOffset), b1 = temps[0].getBoundingClientRect(), b2 = temps[1].getBoundingClientRect(), b3 = temps[2].getBoundingClientRect(), parent = container.parentNode, isFixed = !includeScrollInFixed && _isFixed(element), m = new Matrix2D((b2.left - b1.left) / 100, (b2.top - b1.top) / 100, (b3.left - b1.left) / 100, (b3.top - b1.top) / 100, b1.left + (isFixed ? 0 : _getDocScrollLeft()), b1.top + (isFixed ? 0 : _getDocScrollTop()));
  parent.removeChild(container);
  if (zeroScales) {
    b1 = zeroScales.length;
    while (b1--) {
      b2 = zeroScales[b1];
      b2.scaleX = b2.scaleY = 0;
      b2.renderTransform(1, b2);
    }
  }
  return inverse ? m.inverse() : m;
}
/*!
 * Flip 3.15.0
 * https://gsap.com
 *
 * @license Copyright 2008-2026, GreenSock. All rights reserved.
 * Subject to the terms at https://gsap.com/standard-license
 * @author: Jack Doyle, jack@greensock.com
*/
var _id = 1, _toArray, gsap, _batch, _batchAction, _body, _closestTenth, _getStyleSaver2, _forEachBatch = function _forEachBatch2(batch2, name) {
  return batch2.actions.forEach(function(a) {
    return a.vars[name] && a.vars[name](a);
  });
}, _batchLookup = {}, _RAD2DEG = 180 / Math.PI, _DEG2RAD = Math.PI / 180, _emptyObj = {}, _dashedNameLookup = {}, _memoizedRemoveProps = {}, _listToArray = function _listToArray2(list) {
  return typeof list === "string" ? list.split(" ").join("").split(",") : list;
}, _callbacks = _listToArray("onStart,onUpdate,onComplete,onReverseComplete,onInterrupt"), _removeProps = _listToArray("transform,transformOrigin,width,height,position,top,left,opacity,zIndex,maxWidth,maxHeight,minWidth,minHeight"), _getEl = function _getEl2(target) {
  return _toArray(target)[0] || console.warn("Element not found:", target);
}, _round2 = function _round3(value) {
  return Math.round(value * 1e4) / 1e4 || 0;
}, _toggleClass = function _toggleClass2(targets, className2, action) {
  return targets.forEach(function(el) {
    return el.classList[action](className2);
  });
}, _reserved = {
  zIndex: 1,
  kill: 1,
  simple: 1,
  spin: 1,
  clearProps: 1,
  targets: 1,
  toggleClass: 1,
  onComplete: 1,
  onUpdate: 1,
  onInterrupt: 1,
  onStart: 1,
  delay: 1,
  repeat: 1,
  repeatDelay: 1,
  yoyo: 1,
  scale: 1,
  fade: 1,
  absolute: 1,
  props: 1,
  onEnter: 1,
  onLeave: 1,
  custom: 1,
  paused: 1,
  nested: 1,
  prune: 1,
  absoluteOnLeave: 1
}, _fitReserved = {
  zIndex: 1,
  simple: 1,
  clearProps: 1,
  scale: 1,
  absolute: 1,
  fitChild: 1,
  getVars: 1,
  props: 1
}, _camelToDashed = function _camelToDashed2(p) {
  return p.replace(/([A-Z])/g, "-$1").toLowerCase();
}, _copy = function _copy2(obj, exclude) {
  var result = {}, p;
  for (p in obj) {
    exclude[p] || (result[p] = obj[p]);
  }
  return result;
}, _memoizedProps = {}, _memoizeProps = function _memoizeProps2(props) {
  var p = _memoizedProps[props] = _listToArray(props);
  _memoizedRemoveProps[props] = p.concat(_removeProps);
  return p;
}, _getInverseGlobalMatrix = function _getInverseGlobalMatrix2(el) {
  var cache = el._gsap || gsap.core.getCache(el);
  if (cache.gmCache === gsap.ticker.frame) {
    return cache.gMatrix;
  }
  cache.gmCache = gsap.ticker.frame;
  return cache.gMatrix = getGlobalMatrix(el, true, false, true);
}, _getDOMDepth = function _getDOMDepth2(el, invert, level) {
  if (level === void 0) {
    level = 0;
  }
  var parent = el.parentNode, inc = 1e3 * Math.pow(10, level) * (invert ? -1 : 1), l = invert ? -inc * 900 : 0;
  while (el) {
    l += inc;
    el = el.previousSibling;
  }
  return parent ? l + _getDOMDepth2(parent, invert, level + 1) : l;
}, _orderByDOMDepth = function _orderByDOMDepth2(comps, invert, isElStates) {
  comps.forEach(function(comp) {
    return comp.d = _getDOMDepth(isElStates ? comp.element : comp.t, invert);
  });
  comps.sort(function(c1, c2) {
    return c1.d - c2.d;
  });
  return comps;
}, _recordInlineStyles = function _recordInlineStyles2(elState, props) {
  var style2 = elState.element.style, a = elState.css = elState.css || [], i = props.length, p, v;
  while (i--) {
    p = props[i];
    v = style2[p] || style2.getPropertyValue(p);
    a.push(v ? p : _dashedNameLookup[p] || (_dashedNameLookup[p] = _camelToDashed(p)), v);
  }
  return style2;
}, _applyInlineStyles = function _applyInlineStyles2(state) {
  var css = state.css, style2 = state.element.style, i = 0;
  state.cache.uncache = 1;
  for (; i < css.length; i += 2) {
    css[i + 1] ? style2[css[i]] = css[i + 1] : style2.removeProperty(css[i]);
  }
  if (!css[css.indexOf("transform") + 1] && style2.translate) {
    style2.removeProperty("translate");
    style2.removeProperty("scale");
    style2.removeProperty("rotate");
  }
}, _setFinalStates = function _setFinalStates2(comps, onlyTransforms) {
  comps.forEach(function(c) {
    return c.a.cache.uncache = 1;
  });
  onlyTransforms || comps.finalStates.forEach(_applyInlineStyles);
}, _absoluteProps = "paddingTop,paddingRight,paddingBottom,paddingLeft,gridArea,transition".split(","), _makeAbsolute = function _makeAbsolute2(elState, fallbackNode, ignoreBatch) {
  var element = elState.element, width = elState.width, height = elState.height, uncache = elState.uncache, getProp = elState.getProp, style2 = element.style, i = 4, result, displayIsNone, cs;
  typeof fallbackNode !== "object" && (fallbackNode = elState);
  if (_batch && ignoreBatch !== 1) {
    _batch._abs.push({
      t: element,
      b: elState,
      a: elState,
      sd: 0
    });
    _batch._final.push(function() {
      return (elState.cache.uncache = 1) && _applyInlineStyles(elState);
    });
    return element;
  }
  displayIsNone = getProp("display") === "none";
  if (!elState.isVisible || displayIsNone) {
    displayIsNone && (_recordInlineStyles(elState, ["display"]).display = fallbackNode.display);
    elState.matrix = fallbackNode.matrix;
    elState.width = width = elState.width || fallbackNode.width;
    elState.height = height = elState.height || fallbackNode.height;
  }
  _recordInlineStyles(elState, _absoluteProps);
  cs = window.getComputedStyle(element);
  while (i--) {
    style2[_absoluteProps[i]] = cs[_absoluteProps[i]];
  }
  style2.gridArea = "1 / 1 / 1 / 1";
  style2.transition = "none";
  style2.position = "absolute";
  style2.width = width + "px";
  style2.height = height + "px";
  style2.top || (style2.top = "0px");
  style2.left || (style2.left = "0px");
  if (uncache) {
    result = new ElementState(element);
  } else {
    result = _copy(elState, _emptyObj);
    result.position = "absolute";
    if (elState.simple) {
      var bounds = element.getBoundingClientRect();
      result.matrix = new Matrix2D(1, 0, 0, 1, bounds.left + _getDocScrollLeft(), bounds.top + _getDocScrollTop());
    } else {
      result.matrix = getGlobalMatrix(element, false, false, true);
    }
  }
  result = _fit(result, elState, true);
  elState.x = _closestTenth(result.x, 0.01);
  elState.y = _closestTenth(result.y, 0.01);
  return element;
}, _filterComps = function _filterComps2(comps, targets) {
  if (targets !== true) {
    targets = _toArray(targets);
    comps = comps.filter(function(c) {
      if (targets.indexOf((c.sd < 0 ? c.b : c.a).element) !== -1) {
        return true;
      } else {
        c.t._gsap.renderTransform(1);
        if (c.b.isVisible) {
          c.t.style.width = c.b.width + "px";
          c.t.style.height = c.b.height + "px";
        }
      }
    });
  }
  return comps;
}, _makeCompsAbsolute = function _makeCompsAbsolute2(comps) {
  return _orderByDOMDepth(comps, true).forEach(function(c) {
    return (c.a.isVisible || c.b.isVisible) && _makeAbsolute(c.sd < 0 ? c.b : c.a, c.b, 1);
  });
}, _findElStateInState = function _findElStateInState2(state, other) {
  return other && state.idLookup[_parseElementState(other).id] || state.elementStates[0];
}, _parseElementState = function _parseElementState2(elOrNode, props, simple, other) {
  return elOrNode instanceof ElementState ? elOrNode : elOrNode instanceof FlipState ? _findElStateInState(elOrNode, other) : new ElementState(typeof elOrNode === "string" ? _getEl(elOrNode) || console.warn(elOrNode + " not found") : elOrNode, props, simple);
}, _recordProps = function _recordProps2(elState, props) {
  var getProp = gsap.getProperty(elState.element, null, "native"), obj = elState.props = {}, i = props.length;
  while (i--) {
    obj[props[i]] = (getProp(props[i]) + "").trim();
  }
  obj.zIndex && (obj.zIndex = parseFloat(obj.zIndex) || 0);
  return elState;
}, _applyProps = function _applyProps2(element, props) {
  var style2 = element.style || element, p;
  for (p in props) {
    style2[p] = props[p];
  }
}, _getID = function _getID2(el) {
  var id = el.getAttribute("data-flip-id");
  id || el.setAttribute("data-flip-id", id = "auto-" + _id++);
  return id;
}, _elementsFromElementStates = function _elementsFromElementStates2(elStates) {
  return elStates.map(function(elState) {
    return elState.element;
  });
}, _handleCallback = function _handleCallback2(callback, elStates, tl) {
  return callback && elStates.length && tl.add(callback(_elementsFromElementStates(elStates), tl, new FlipState(elStates, 0, true)), 0);
}, _fit = function _fit2(fromState, toState, scale, applyProps, fitChild, vars) {
  var element = fromState.element, cache = fromState.cache, parent = fromState.parent, x = fromState.x, y = fromState.y, width = toState.width, height = toState.height, scaleX = toState.scaleX, scaleY = toState.scaleY, rotation = toState.rotation, bounds = toState.bounds, styles = vars && _getStyleSaver2 && _getStyleSaver2(element, "transform,width,height"), dimensionState = fromState, _toState$matrix = toState.matrix, e = _toState$matrix.e, f = _toState$matrix.f, deep = fromState.bounds.width !== bounds.width || fromState.bounds.height !== bounds.height || fromState.scaleX !== scaleX || fromState.scaleY !== scaleY || fromState.rotation !== rotation, simple = !deep && fromState.simple && toState.simple && !fitChild, skewX, fromPoint, toPoint, getProp, parentMatrix, matrix, bbox;
  if (simple || !parent) {
    scaleX = scaleY = 1;
    rotation = skewX = 0;
  } else {
    parentMatrix = _getInverseGlobalMatrix(parent);
    matrix = parentMatrix.clone().multiply(toState.ctm ? toState.matrix.clone().multiply(toState.ctm) : toState.matrix);
    rotation = _round2(Math.atan2(matrix.b, matrix.a) * _RAD2DEG);
    skewX = _round2(Math.atan2(matrix.c, matrix.d) * _RAD2DEG + rotation) % 360;
    scaleX = Math.sqrt(Math.pow(matrix.a, 2) + Math.pow(matrix.b, 2));
    scaleY = Math.sqrt(Math.pow(matrix.c, 2) + Math.pow(matrix.d, 2)) * Math.cos(skewX * _DEG2RAD);
    if (fitChild) {
      fitChild = _toArray(fitChild)[0];
      getProp = gsap.getProperty(fitChild);
      bbox = fitChild.getBBox && typeof fitChild.getBBox === "function" && fitChild.getBBox();
      dimensionState = {
        scaleX: getProp("scaleX"),
        scaleY: getProp("scaleY"),
        width: bbox ? bbox.width : Math.ceil(parseFloat(getProp("width", "px"))),
        height: bbox ? bbox.height : parseFloat(getProp("height", "px"))
      };
    }
    cache.rotation = rotation + "deg";
    cache.skewX = skewX + "deg";
  }
  if (scale) {
    scaleX *= width === dimensionState.width || !dimensionState.width ? 1 : width / dimensionState.width;
    scaleY *= height === dimensionState.height || !dimensionState.height ? 1 : height / dimensionState.height;
    cache.scaleX = scaleX;
    cache.scaleY = scaleY;
  } else {
    width = _closestTenth(width * scaleX / dimensionState.scaleX, 0);
    height = _closestTenth(height * scaleY / dimensionState.scaleY, 0);
    element.style.width = width + "px";
    element.style.height = height + "px";
  }
  applyProps && _applyProps(element, toState.props);
  if (simple || !parent) {
    x += e - fromState.matrix.e;
    y += f - fromState.matrix.f;
  } else if (deep || parent !== toState.parent) {
    cache.x = x + "px";
    cache.y = y + "px";
    cache.renderTransform(1, cache);
    matrix = getGlobalMatrix(fitChild || element, false, false, true);
    fromPoint = parentMatrix.apply({
      x: matrix.e,
      y: matrix.f
    });
    toPoint = parentMatrix.apply({
      x: e,
      y: f
    });
    x += toPoint.x - fromPoint.x;
    y += toPoint.y - fromPoint.y;
  } else {
    parentMatrix.e = parentMatrix.f = 0;
    toPoint = parentMatrix.apply({
      x: e - fromState.matrix.e,
      y: f - fromState.matrix.f
    });
    x += toPoint.x;
    y += toPoint.y;
  }
  x = _closestTenth(x, 0.02);
  y = _closestTenth(y, 0.02);
  if (vars && !(vars instanceof ElementState)) {
    styles && styles.revert();
  } else {
    cache.x = x + "px";
    cache.y = y + "px";
    cache.renderTransform(1, cache);
  }
  if (vars) {
    vars.x = x;
    vars.y = y;
    vars.rotation = rotation;
    vars.skewX = skewX;
    if (scale) {
      vars.scaleX = scaleX;
      vars.scaleY = scaleY;
    } else {
      vars.width = width;
      vars.height = height;
    }
  }
  return vars || cache;
}, _parseState = function _parseState2(targetsOrState, vars) {
  return targetsOrState instanceof FlipState ? targetsOrState : new FlipState(targetsOrState, vars);
}, _getChangingElState = function _getChangingElState2(toState, fromState, id) {
  var to1 = toState.idLookup[id], to2 = toState.alt[id];
  return to2.isVisible && (!(fromState.getElementState(to2.element) || to2).isVisible || !to1.isVisible) ? to2 : to1;
}, _bodyMetrics = [], _bodyProps = "width,height,overflowX,overflowY".split(","), _bodyLocked, _lockBodyScroll = function _lockBodyScroll2(lock) {
  if (lock !== _bodyLocked) {
    var s = _body.style, w = _body.clientWidth === window.outerWidth, h = _body.clientHeight === window.outerHeight, i = 4;
    if (lock && (w || h)) {
      while (i--) {
        _bodyMetrics[i] = s[_bodyProps[i]];
      }
      if (w) {
        s.width = _body.clientWidth + "px";
        s.overflowY = "hidden";
      }
      if (h) {
        s.height = _body.clientHeight + "px";
        s.overflowX = "hidden";
      }
      _bodyLocked = lock;
    } else if (_bodyLocked) {
      while (i--) {
        _bodyMetrics[i] ? s[_bodyProps[i]] = _bodyMetrics[i] : s.removeProperty(_camelToDashed(_bodyProps[i]));
      }
      _bodyLocked = lock;
    }
  }
}, _revertTempStyles = function _revertTempStyles2(temps, stateIndex) {
  for (var i = 0; i < temps.length; i += 3) {
    gsap.set(temps[i], {
      clearProps: true
    });
    temps[i].setAttribute("style", temps[i + stateIndex]);
    temps[i]._gsap.gmCache = -1;
  }
}, _fromTo = function _fromTo2(fromState, toState, vars, relative) {
  fromState instanceof FlipState && toState instanceof FlipState || console.warn("Not a valid state object.");
  vars = vars || {};
  var _vars = vars, clearProps2 = _vars.clearProps, onEnter = _vars.onEnter, onLeave = _vars.onLeave, absolute = _vars.absolute, absoluteOnLeave = _vars.absoluteOnLeave, custom = _vars.custom, delay = _vars.delay, paused = _vars.paused, repeat = _vars.repeat, repeatDelay = _vars.repeatDelay, yoyo = _vars.yoyo, toggleClass = _vars.toggleClass, nested = _vars.nested, _zIndex = _vars.zIndex, scale = _vars.scale, fade = _vars.fade, stagger = _vars.stagger, spin = _vars.spin, prune = _vars.prune, props = ("props" in vars ? vars : fromState).props, tweenVars = _copy(vars, _reserved), animation = gsap.timeline({
    delay,
    paused,
    repeat,
    repeatDelay,
    yoyo,
    data: "isFlip"
  }), remainingProps = tweenVars, entering = [], leaving = [], comps = [], swapOutTargets = [], spinNum = spin === true ? 1 : spin || 0, spinFunc = typeof spin === "function" ? spin : function() {
    return spinNum;
  }, interrupted = fromState.interrupted || toState.interrupted, addFunc = animation[relative !== 1 ? "to" : "from"], v, p, endTime, i, el, comp, state, targets, finalStates, fromNode, toNode, run, a, b;
  for (p in toState.idLookup) {
    toNode = !toState.alt[p] ? toState.idLookup[p] : _getChangingElState(toState, fromState, p);
    el = toNode.element;
    fromNode = fromState.idLookup[p];
    fromState.alt[p] && el === fromNode.element && (fromState.alt[p].isVisible || !toNode.isVisible) && (fromNode = fromState.alt[p]);
    if (fromNode) {
      comp = {
        t: el,
        b: fromNode,
        a: toNode,
        sd: fromNode.element === el ? 0 : toNode.isVisible ? 1 : -1
      };
      comps.push(comp);
      if (comp.sd) {
        if (comp.sd < 0) {
          comp.b = toNode;
          comp.a = fromNode;
        }
        interrupted && _recordInlineStyles(comp.b, props ? _memoizedRemoveProps[props] : _removeProps);
        fade && comps.push(comp.swap = {
          t: fromNode.element,
          b: comp.b,
          a: comp.a,
          sd: -comp.sd,
          swap: comp
        });
      }
      el._flip = fromNode.element._flip = _batch ? _batch.timeline : animation;
    } else if (toNode.isVisible) {
      comps.push({
        t: el,
        b: _copy(toNode, {
          isVisible: 1
        }),
        a: toNode,
        sd: 0,
        entering: 1
      });
      el._flip = _batch ? _batch.timeline : animation;
    }
  }
  props && (_memoizedProps[props] || _memoizeProps(props)).forEach(function(p2) {
    return tweenVars[p2] = function(i2) {
      return comps[i2].a.props[p2];
    };
  });
  comps.finalStates = finalStates = [];
  run = function run2() {
    _orderByDOMDepth(comps);
    _lockBodyScroll(true);
    var recordedStyles = [];
    for (i = 0; i < comps.length; i++) {
      comp = comps[i];
      a = comp.a;
      b = comp.b;
      if (prune && !a.isDifferent(b) && !comp.entering) {
        comps.splice(i--, 1);
      } else {
        el = comp.t;
        if (nested && !(comp.sd < 0) && i) {
          a = comp.a = a.clone({
            matrix: getGlobalMatrix(el, false, false, true)
          });
        }
        if (b.isVisible && a.isVisible) {
          if (comp.sd < 0) {
            nested && _revertTempStyles(recordedStyles, 1);
            state = new ElementState(el, props, fromState.simple);
            _fit(state, a, scale, 0, 0, state);
            state.matrix = getGlobalMatrix(el, false, false, true);
            state.bounds = el.getBoundingClientRect();
            state.css = comp.b.css;
            comp.a = a = state;
            fade && (el.style.opacity = interrupted ? b.opacity : a.opacity);
            stagger && swapOutTargets.push(el);
            if (nested) {
              _revertTempStyles(recordedStyles, 2);
              recordedStyles.push(el, el.getAttribute("style"));
            }
          } else if (comp.sd > 0 && fade) {
            el.style.opacity = interrupted ? a.opacity - b.opacity : "0";
          }
          _fit(a, b, scale, props);
          nested && comp.sd < 0 && recordedStyles.push(el.getAttribute("style"));
        } else if (b.isVisible !== a.isVisible) {
          if (!b.isVisible) {
            a.isVisible && entering.push(a);
            comps.splice(i--, 1);
          } else if (!a.isVisible) {
            b.css = a.css;
            leaving.push(b);
            comps.splice(i--, 1);
            absolute && nested && _fit(a, b, scale, props);
          }
        }
        if (!scale) {
          el.style.maxWidth = Math.max(a.width, b.width) + "px";
          el.style.maxHeight = Math.max(a.height, b.height) + "px";
          el.style.minWidth = Math.min(a.width, b.width) + "px";
          el.style.minHeight = Math.min(a.height, b.height) + "px";
        }
        nested && toggleClass && el.classList.add(toggleClass);
      }
      finalStates.push(a);
    }
    var classTargets;
    if (toggleClass) {
      classTargets = finalStates.map(function(s) {
        return s.element;
      });
      nested && classTargets.forEach(function(e) {
        return e.classList.remove(toggleClass);
      });
    }
    _lockBodyScroll(false);
    if (scale) {
      tweenVars.scaleX = function(i2) {
        return comps[i2].a.scaleX;
      };
      tweenVars.scaleY = function(i2) {
        return comps[i2].a.scaleY;
      };
    } else {
      tweenVars.width = function(i2) {
        return comps[i2].a.width + "px";
      };
      tweenVars.height = function(i2) {
        return comps[i2].a.height + "px";
      };
      tweenVars.autoRound = vars.autoRound || false;
    }
    tweenVars.x = function(i2) {
      return comps[i2].a.x + "px";
    };
    tweenVars.y = function(i2) {
      return comps[i2].a.y + "px";
    };
    tweenVars.rotation = function(i2) {
      return comps[i2].a.rotation + (spin ? spinFunc(i2, targets[i2], targets) * 360 : 0);
    };
    tweenVars.skewX = function(i2) {
      return comps[i2].a.skewX;
    };
    targets = comps.map(function(c) {
      return c.t;
    });
    if (_zIndex || _zIndex === 0) {
      tweenVars.modifiers = {
        zIndex: function zIndex() {
          return _zIndex;
        }
      };
      tweenVars.zIndex = _zIndex;
      tweenVars.immediateRender = vars.immediateRender !== false;
    }
    fade && (tweenVars.opacity = function(i2) {
      return comps[i2].sd < 0 ? 0 : comps[i2].sd > 0 ? comps[i2].a.opacity : "+=0";
    });
    if (swapOutTargets.length) {
      stagger = gsap.utils.distribute(stagger);
      var dummyArray = targets.slice(swapOutTargets.length);
      tweenVars.stagger = function(i2, el2) {
        return stagger(~swapOutTargets.indexOf(el2) ? targets.indexOf(comps[i2].swap.t) : i2, el2, dummyArray);
      };
    }
    _callbacks.forEach(function(name) {
      return vars[name] && animation.eventCallback(name, vars[name], vars[name + "Params"]);
    });
    if (custom && targets.length) {
      remainingProps = _copy(tweenVars, _reserved);
      if ("scale" in custom) {
        custom.scaleX = custom.scaleY = custom.scale;
        delete custom.scale;
      }
      for (p in custom) {
        v = _copy(custom[p], _fitReserved);
        v[p] = tweenVars[p];
        !("duration" in v) && "duration" in tweenVars && (v.duration = tweenVars.duration);
        v.stagger = tweenVars.stagger;
        addFunc.call(animation, targets, v, 0);
        delete remainingProps[p];
      }
    }
    if (targets.length || leaving.length || entering.length) {
      toggleClass && animation.add(function() {
        return _toggleClass(classTargets, toggleClass, animation._zTime < 0 ? "remove" : "add");
      }, 0) && !paused && _toggleClass(classTargets, toggleClass, "add");
      targets.length && addFunc.call(animation, targets, remainingProps, 0);
    }
    _handleCallback(onEnter, entering, animation);
    _handleCallback(onLeave, leaving, animation);
    var batchTl = _batch && _batch.timeline;
    if (batchTl) {
      batchTl.add(animation, 0);
      _batch._final.push(function() {
        return _setFinalStates(comps, !clearProps2);
      });
    }
    endTime = animation.duration();
    animation.call(function() {
      var forward = animation.time() >= endTime;
      forward && !batchTl && _setFinalStates(comps, !clearProps2);
      toggleClass && _toggleClass(classTargets, toggleClass, forward ? "remove" : "add");
    });
  };
  absoluteOnLeave && (absolute = comps.filter(function(comp2) {
    return !comp2.sd && !comp2.a.isVisible && comp2.b.isVisible;
  }).map(function(comp2) {
    return comp2.a.element;
  }));
  if (_batch) {
    var _batch$_abs;
    absolute && (_batch$_abs = _batch._abs).push.apply(_batch$_abs, _filterComps(comps, absolute));
    _batch._run.push(run);
  } else {
    absolute && _makeCompsAbsolute(_filterComps(comps, absolute));
    run();
  }
  var anim = _batch ? _batch.timeline : animation;
  anim.revert = function() {
    return _killFlip(anim, 1, 1);
  };
  return anim;
}, _interrupt2 = function _interrupt3(tl) {
  tl.vars.onInterrupt && tl.vars.onInterrupt.apply(tl, tl.vars.onInterruptParams || []);
  tl.getChildren(true, false, true).forEach(_interrupt3);
}, _killFlip = function _killFlip2(tl, action, force) {
  if (tl && tl.progress() < 1 && (!tl.paused() || force)) {
    if (action) {
      _interrupt2(tl);
      action < 2 && tl.progress(1);
      tl.kill();
    }
    return true;
  }
}, _createLookup = function _createLookup2(state) {
  var lookup = state.idLookup = {}, alt = state.alt = {}, elStates = state.elementStates, i = elStates.length, elState;
  while (i--) {
    elState = elStates[i];
    lookup[elState.id] ? alt[elState.id] = elState : lookup[elState.id] = elState;
  }
};
var FlipState = /* @__PURE__ */ (function() {
  function FlipState2(targets, vars, targetsAreElementStates) {
    this.props = vars && vars.props;
    this.simple = !!(vars && vars.simple);
    if (targetsAreElementStates) {
      this.targets = _elementsFromElementStates(targets);
      this.elementStates = targets;
      _createLookup(this);
    } else {
      this.targets = _toArray(targets);
      var soft = vars && (vars.kill === false || vars.batch && !vars.kill);
      _batch && !soft && _batch._kill.push(this);
      this.update(soft || !!_batch);
    }
  }
  var _proto = FlipState2.prototype;
  _proto.update = function update(soft) {
    var _this = this;
    this.elementStates = this.targets.map(function(el) {
      return new ElementState(el, _this.props, _this.simple);
    });
    _createLookup(this);
    this.interrupt(soft);
    this.recordInlineStyles();
    return this;
  };
  _proto.clear = function clear() {
    this.targets.length = this.elementStates.length = 0;
    _createLookup(this);
    return this;
  };
  _proto.fit = function fit(state, scale, nested) {
    var elStatesInOrder = _orderByDOMDepth(this.elementStates.slice(0), false, true), toElStates = (state || this).idLookup, i = 0, fromNode, toNode;
    for (; i < elStatesInOrder.length; i++) {
      fromNode = elStatesInOrder[i];
      nested && (fromNode.matrix = getGlobalMatrix(fromNode.element, false, false, true));
      toNode = toElStates[fromNode.id];
      toNode && _fit(fromNode, toNode, scale, true, 0, fromNode);
      fromNode.matrix = getGlobalMatrix(fromNode.element, false, false, true);
    }
    return this;
  };
  _proto.getProperty = function getProperty2(element, property) {
    var es = this.getElementState(element) || _emptyObj;
    return (property in es ? es : es.props || _emptyObj)[property];
  };
  _proto.add = function add(state) {
    var i = state.targets.length, lookup = this.idLookup, alt = this.alt, index, es, es2;
    while (i--) {
      es = state.elementStates[i];
      es2 = lookup[es.id];
      if (es2 && (es.element === es2.element || alt[es.id] && alt[es.id].element === es.element)) {
        index = this.elementStates.indexOf(es.element === es2.element ? es2 : alt[es.id]);
        this.targets.splice(index, 1, state.targets[i]);
        this.elementStates.splice(index, 1, es);
      } else {
        this.targets.push(state.targets[i]);
        this.elementStates.push(es);
      }
    }
    state.interrupted && (this.interrupted = true);
    state.simple || (this.simple = false);
    _createLookup(this);
    return this;
  };
  _proto.compare = function compare(state) {
    var l1 = state.idLookup, l2 = this.idLookup, unchanged = [], changed = [], enter = [], leave = [], targets = [], a1 = state.alt, a2 = this.alt, place = function place2(s12, s22, el2) {
      return (s12.isVisible !== s22.isVisible ? s12.isVisible ? enter : leave : s12.isVisible ? changed : unchanged).push(el2) && targets.push(el2);
    }, placeIfDoesNotExist = function placeIfDoesNotExist2(s12, s22, el2) {
      return targets.indexOf(el2) < 0 && place(s12, s22, el2);
    }, s1, s2, p, el, s1Alt, s2Alt, c1, c2;
    for (p in l1) {
      s1Alt = a1[p];
      s2Alt = a2[p];
      s1 = !s1Alt ? l1[p] : _getChangingElState(state, this, p);
      el = s1.element;
      s2 = l2[p];
      if (s2Alt) {
        c2 = s2.isVisible || !s2Alt.isVisible && el === s2.element ? s2 : s2Alt;
        c1 = s1Alt && !s1.isVisible && !s1Alt.isVisible && c2.element === s1Alt.element ? s1Alt : s1;
        if (c1.isVisible && c2.isVisible && c1.element !== c2.element) {
          (c1.isDifferent(c2) ? changed : unchanged).push(c1.element, c2.element);
          targets.push(c1.element, c2.element);
        } else {
          place(c1, c2, c1.element);
        }
        s1Alt && c1.element === s1Alt.element && (s1Alt = l1[p]);
        placeIfDoesNotExist(c1.element !== s2.element && s1Alt ? s1Alt : c1, s2, s2.element);
        placeIfDoesNotExist(s1Alt && s1Alt.element === s2Alt.element ? s1Alt : c1, s2Alt, s2Alt.element);
        s1Alt && placeIfDoesNotExist(s1Alt, s2Alt.element === s1Alt.element ? s2Alt : s2, s1Alt.element);
      } else {
        !s2 ? enter.push(el) : !s2.isDifferent(s1) ? unchanged.push(el) : place(s1, s2, el);
        s1Alt && placeIfDoesNotExist(s1Alt, s2, s1Alt.element);
      }
    }
    for (p in l2) {
      if (!l1[p]) {
        leave.push(l2[p].element);
        a2[p] && leave.push(a2[p].element);
      }
    }
    return {
      changed,
      unchanged,
      enter,
      leave
    };
  };
  _proto.recordInlineStyles = function recordInlineStyles() {
    var props = _memoizedRemoveProps[this.props] || _removeProps, i = this.elementStates.length;
    while (i--) {
      _recordInlineStyles(this.elementStates[i], props);
    }
  };
  _proto.interrupt = function interrupt(soft) {
    var _this2 = this;
    var timelines = [];
    this.targets.forEach(function(t) {
      var tl = t._flip, foundInProgress = _killFlip(tl, soft ? 0 : 1);
      soft && foundInProgress && timelines.indexOf(tl) < 0 && tl.add(function() {
        return _this2.updateVisibility();
      });
      foundInProgress && timelines.push(tl);
    });
    !soft && timelines.length && this.updateVisibility();
    this.interrupted || (this.interrupted = !!timelines.length);
  };
  _proto.updateVisibility = function updateVisibility() {
    this.elementStates.forEach(function(es) {
      var b = es.element.getBoundingClientRect();
      es.isVisible = !!(b.width || b.height || b.top || b.left);
      es.uncache = 1;
    });
  };
  _proto.getElementState = function getElementState(element) {
    return this.elementStates[this.targets.indexOf(_getEl(element))];
  };
  _proto.makeAbsolute = function makeAbsolute() {
    return _orderByDOMDepth(this.elementStates.slice(0), true, true).map(_makeAbsolute);
  };
  return FlipState2;
})();
var ElementState = /* @__PURE__ */ (function() {
  function ElementState2(element, props, simple) {
    if (element instanceof ElementState2) {
      Object.assign(this, element, props || {});
    } else {
      this.element = element;
      this.update(props, simple);
    }
  }
  var _proto2 = ElementState2.prototype;
  _proto2.isDifferent = function isDifferent(state) {
    var b1 = this.bounds, b2 = state.bounds;
    return b1.top !== b2.top || b1.left !== b2.left || b1.width !== b2.width || b1.height !== b2.height || !this.matrix.equals(state.matrix) || this.opacity !== state.opacity || this.props && state.props && JSON.stringify(this.props) !== JSON.stringify(state.props);
  };
  _proto2.clone = function clone(overrides) {
    return new ElementState2(this, overrides);
  };
  _proto2.update = function update(props, simple) {
    var self = this, element = self.element, getProp = gsap.getProperty(element), cache = gsap.core.getCache(element), bounds = element.getBoundingClientRect(), bbox = element.getBBox && typeof element.getBBox === "function" && element.nodeName.toLowerCase() !== "svg" && element.getBBox(), m = simple ? new Matrix2D(1, 0, 0, 1, bounds.left + _getDocScrollLeft(), bounds.top + _getDocScrollTop()) : getGlobalMatrix(element, false, false, true);
    cache.uncache = 1;
    self.getProp = getProp;
    self.element = element;
    self.id = _getID(element);
    self.matrix = m;
    self.cache = cache;
    self.bounds = bounds;
    self.isVisible = !!(bounds.width || bounds.height || bounds.left || bounds.top);
    self.display = getProp("display");
    self.position = getProp("position");
    self.parent = element.parentNode;
    self.x = getProp("x", "px");
    self.y = getProp("y", "px");
    self.scaleX = cache.scaleX;
    self.scaleY = cache.scaleY;
    self.rotation = getProp("rotation");
    self.skewX = getProp("skewX");
    self.opacity = getProp("opacity");
    self.width = bbox ? bbox.width : _closestTenth(getProp("width", "px"), 0.04);
    self.height = bbox ? bbox.height : _closestTenth(getProp("height", "px"), 0.04);
    props && _recordProps(self, _memoizedProps[props] || _memoizeProps(props));
    self.ctm = element.getCTM && element.nodeName.toLowerCase() === "svg" && _getCTM(element).inverse();
    self.simple = simple || _round2(m.a) === 1 && !_round2(m.b) && !_round2(m.c) && _round2(m.d) === 1;
    self.uncache = 0;
  };
  return ElementState2;
})();
var FlipAction = /* @__PURE__ */ (function() {
  function FlipAction2(vars, batch2) {
    this.vars = vars;
    this.batch = batch2;
    this.states = [];
    this.timeline = batch2.timeline;
  }
  var _proto3 = FlipAction2.prototype;
  _proto3.getStateById = function getStateById(id) {
    var i = this.states.length;
    while (i--) {
      if (this.states[i].idLookup[id]) {
        return this.states[i];
      }
    }
  };
  _proto3.kill = function kill() {
    this.batch.remove(this);
  };
  return FlipAction2;
})();
var FlipBatch = /* @__PURE__ */ (function() {
  function FlipBatch2(id) {
    this.id = id;
    this.actions = [];
    this._kill = [];
    this._final = [];
    this._abs = [];
    this._run = [];
    this.data = {};
    this.state = new FlipState();
    this.timeline = gsap.timeline();
  }
  var _proto4 = FlipBatch2.prototype;
  _proto4.add = function add(config3) {
    var result = this.actions.filter(function(action) {
      return action.vars === config3;
    });
    if (result.length) {
      return result[0];
    }
    result = new FlipAction(typeof config3 === "function" ? {
      animate: config3
    } : config3, this);
    this.actions.push(result);
    return result;
  };
  _proto4.remove = function remove(action) {
    var i = this.actions.indexOf(action);
    i >= 0 && this.actions.splice(i, 1);
    return this;
  };
  _proto4.getState = function getState(merge) {
    var _this3 = this;
    var prevBatch = _batch, prevAction = _batchAction;
    _batch = this;
    this.state.clear();
    this._kill.length = 0;
    this.actions.forEach(function(action) {
      if (action.vars.getState) {
        action.states.length = 0;
        _batchAction = action;
        action.state = action.vars.getState(action);
      }
      merge && action.states.forEach(function(s) {
        return _this3.state.add(s);
      });
    });
    _batchAction = prevAction;
    _batch = prevBatch;
    this.killConflicts();
    return this;
  };
  _proto4.animate = function animate() {
    var _this4 = this;
    var prevBatch = _batch, tl = this.timeline, i = this.actions.length, finalStates, endTime;
    _batch = this;
    tl.clear();
    this._abs.length = this._final.length = this._run.length = 0;
    this.actions.forEach(function(a) {
      a.vars.animate && a.vars.animate(a);
      var onEnter = a.vars.onEnter, onLeave = a.vars.onLeave, targets = a.targets, s, result;
      if (targets && targets.length && (onEnter || onLeave)) {
        s = new FlipState();
        a.states.forEach(function(state) {
          return s.add(state);
        });
        result = s.compare(Flip.getState(targets));
        result.enter.length && onEnter && onEnter(result.enter);
        result.leave.length && onLeave && onLeave(result.leave);
      }
    });
    _makeCompsAbsolute(this._abs);
    this._run.forEach(function(f) {
      return f();
    });
    endTime = tl.duration();
    finalStates = this._final.slice(0);
    tl.add(function() {
      if (endTime <= tl.time()) {
        finalStates.forEach(function(f) {
          return f();
        });
        _forEachBatch(_this4, "onComplete");
      }
    });
    _batch = prevBatch;
    while (i--) {
      this.actions[i].vars.once && this.actions[i].kill();
    }
    _forEachBatch(this, "onStart");
    tl.restart();
    return this;
  };
  _proto4.loadState = function loadState(done) {
    done || (done = function done2() {
      return 0;
    });
    var queue = [];
    this.actions.forEach(function(c) {
      if (c.vars.loadState) {
        var i, f = function f2(targets) {
          targets && (c.targets = targets);
          i = queue.indexOf(f2);
          if (~i) {
            queue.splice(i, 1);
            queue.length || done();
          }
        };
        queue.push(f);
        c.vars.loadState(f);
      }
    });
    queue.length || done();
    return this;
  };
  _proto4.setState = function setState() {
    this.actions.forEach(function(c) {
      return c.targets = c.vars.setState && c.vars.setState(c);
    });
    return this;
  };
  _proto4.killConflicts = function killConflicts(soft) {
    this.state.interrupt(soft);
    this._kill.forEach(function(state) {
      return state.interrupt(soft);
    });
    return this;
  };
  _proto4.run = function run(skipGetState, merge) {
    var _this5 = this;
    if (this !== _batch) {
      skipGetState || this.getState(merge);
      this.loadState(function() {
        if (!_this5._killed) {
          _this5.setState();
          _this5.animate();
        }
      });
    }
    return this;
  };
  _proto4.clear = function clear(stateOnly) {
    this.state.clear();
    stateOnly || (this.actions.length = 0);
  };
  _proto4.getStateById = function getStateById(id) {
    var i = this.actions.length, s;
    while (i--) {
      s = this.actions[i].getStateById(id);
      if (s) {
        return s;
      }
    }
    return this.state.idLookup[id] && this.state;
  };
  _proto4.kill = function kill() {
    this._killed = 1;
    this.clear();
    delete _batchLookup[this.id];
  };
  return FlipBatch2;
})();
var Flip = /* @__PURE__ */ (function() {
  function Flip2() {
  }
  Flip2.getState = function getState(targets, vars) {
    var state = _parseState(targets, vars);
    _batchAction && _batchAction.states.push(state);
    vars && vars.batch && Flip2.batch(vars.batch).state.add(state);
    return state;
  };
  Flip2.from = function from(state, vars) {
    vars = vars || {};
    "clearProps" in vars || (vars.clearProps = true);
    return _fromTo(state, _parseState(vars.targets || state.targets, {
      props: vars.props || state.props,
      simple: vars.simple,
      kill: !!vars.kill
    }), vars, -1);
  };
  Flip2.to = function to(state, vars) {
    return _fromTo(state, _parseState(vars.targets || state.targets, {
      props: vars.props || state.props,
      simple: vars.simple,
      kill: !!vars.kill
    }), vars, 1);
  };
  Flip2.fromTo = function fromTo(fromState, toState, vars) {
    return _fromTo(fromState, toState, vars);
  };
  Flip2.fit = function fit(fromEl, toEl, vars) {
    var v = vars ? _copy(vars, _fitReserved) : {}, _ref = vars || v, absolute = _ref.absolute, scale = _ref.scale, getVars = _ref.getVars, props = _ref.props, runBackwards = _ref.runBackwards, onComplete = _ref.onComplete, simple = _ref.simple, fitChild = vars && vars.fitChild && _getEl(vars.fitChild), before = _parseElementState(toEl, props, simple, fromEl), after = _parseElementState(fromEl, 0, simple, before), inlineProps = props ? _memoizedRemoveProps[props] : _removeProps, ctx = gsap.context();
    props && _applyProps(v, before.props);
    _recordInlineStyles(after, inlineProps);
    if (runBackwards) {
      "immediateRender" in v || (v.immediateRender = true);
      v.onComplete = function() {
        _applyInlineStyles(after);
        onComplete && onComplete.apply(this, arguments);
      };
    }
    absolute && _makeAbsolute(after, before);
    v = _fit(after, before, scale || fitChild, !v.duration && props, fitChild, v.duration || getVars ? v : 0);
    typeof vars === "object" && "zIndex" in vars && (v.zIndex = vars.zIndex);
    ctx && !getVars && ctx.add(function() {
      return function() {
        return _applyInlineStyles(after);
      };
    });
    return getVars ? v : v.duration ? gsap.to(after.element, v) : null;
  };
  Flip2.makeAbsolute = function makeAbsolute(targetsOrStates, vars) {
    return (targetsOrStates instanceof FlipState ? targetsOrStates : new FlipState(targetsOrStates, vars)).makeAbsolute();
  };
  Flip2.batch = function batch2(id) {
    id || (id = "default");
    return _batchLookup[id] || (_batchLookup[id] = new FlipBatch(id));
  };
  Flip2.killFlipsOf = function killFlipsOf(targets, complete) {
    (targets instanceof FlipState ? targets.targets : _toArray(targets)).forEach(function(t) {
      return t && _killFlip(t._flip, complete !== false ? 1 : 2);
    });
  };
  Flip2.isFlipping = function isFlipping(target) {
    var f = Flip2.getByTarget(target);
    return !!f && f.isActive();
  };
  Flip2.getByTarget = function getByTarget(target) {
    return (_getEl(target) || _emptyObj)._flip;
  };
  Flip2.getElementState = function getElementState(target, props) {
    return new ElementState(_getEl(target), props);
  };
  Flip2.convertCoordinates = function convertCoordinates(fromElement, toElement, point) {
    var m = getGlobalMatrix(toElement, true, true).multiply(getGlobalMatrix(fromElement));
    return point ? m.apply(point) : m;
  };
  Flip2.register = function register(core) {
    _body = typeof document !== "undefined" && document.body;
    if (_body) {
      gsap = core;
      _setDoc(_body);
      _toArray = gsap.utils.toArray;
      _getStyleSaver2 = gsap.core.getStyleSaver;
      var snap3 = gsap.utils.snap(0.1);
      _closestTenth = function _closestTenth2(value, add) {
        return snap3(parseFloat(value) + add);
      };
    }
  };
  return Flip2;
})();
Flip.version = "3.15.0";
typeof window !== "undefined" && window.gsap && window.gsap.registerPlugin(Flip);
var _tmpl$$6 = /* @__PURE__ */ template(`<div aria-hidden=true class="flex items-center justify-center w-[30px] h-[30px] rounded-[8px] bg-white text-neutral-900 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)] ring-1 ring-neutral-200/60"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.75 stroke-linecap=round><path d="M12 5v14M5 12h14">`), _tmpl$2$5 = /* @__PURE__ */ template(`<div class="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[70] pointer-events-none"><div class="bg-neutral-900 text-white text-[11px] font-medium tracking-tight px-2.5 py-1 rounded-lg shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] whitespace-nowrap">New Workspace`), _tmpl$3$5 = /* @__PURE__ */ template(`<div class="pointer-events-auto fixed z-[9999] animate-in slide-in-from-left-2 fade-in duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] -translate-y-1/2"><div class="flex items-center gap-1 pl-2 pr-1.5 py-1 bg-white/85 backdrop-blur-2xl border border-white/60 ring-1 ring-black/[0.04] rounded-[14px] shadow-[0_18px_40px_-18px_rgba(0,0,0,0.25)]"><span class="text-[11px] font-semibold text-neutral-400 tracking-[0.18em] uppercase whitespace-nowrap">Name</span><input autofocus class="w-[180px] text-[13px] font-medium tracking-tight bg-transparent outline-none placeholder:text-neutral-400 text-neutral-800 px-2 py-1.5"placeholder="Workspace name…"><button title=Cancel aria-label=Cancel class="flex items-center justify-center w-6 h-6 rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-black/[0.05] transition-colors"><svg width=10 height=10 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.25 stroke-linecap=round><path d="M18 6 6 18M6 6l12 12">`), _tmpl$4$5 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-between shrink-0 h-full w-full px-1 py-2 select-none pointer-events-none"style=-webkit-app-region:no-drag><div class="pointer-events-auto flex flex-col items-center gap-1 w-full min-h-0 flex-1"><div class="w-1 h-1 rounded-full bg-neutral-300/70 mb-0.5"></div><div class="flex flex-col items-center gap-1 flex-1 min-h-0 overflow-y-auto scrollbar-none"></div><div class="w-5 h-px bg-neutral-200/80 my-1"></div><div class=relative><div>`), _tmpl$5$5 = /* @__PURE__ */ template(`<div class="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[70] pointer-events-none"><div class="bg-neutral-900 text-white text-[11px] font-medium tracking-tight px-2.5 py-1 rounded-lg shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] whitespace-nowrap">`), _tmpl$6$4 = /* @__PURE__ */ template(`<div class=relative><div><button class="workspace-dock-button group/ws flex items-center justify-center w-[30px] h-[30px] rounded-[8px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"><span class="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/ws:translate-y-[-0.5px] group-hover/ws:translate-x-[0.5px] group-active/ws:scale-[0.94]">`), _tmpl$7$3 = /* @__PURE__ */ template(`<button title="Create Workspace"aria-label="Create Workspace"class="group/create flex items-center justify-center w-[30px] h-[30px] rounded-[8px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.92] bg-white/70 text-neutral-500 hover:bg-neutral-900 hover:text-white hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"><span class="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/create:rotate-90 group-active/create:scale-[0.9]"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.75 stroke-linecap=round><path d="M12 5v14M5 12h14">`), _tmpl$8$3 = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[9998] pointer-events-auto">`), _tmpl$9$3 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 p-2"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest pl-1">Workspace</span><div class="relative group/input"><input type=text autofocus class="w-full text-[13px] font-semibold text-neutral-800 bg-neutral-100/50 hover:bg-neutral-100 focus:bg-white focus:ring-2 focus:ring-neutral-200/60 rounded-xl px-2.5 py-1.5 outline-none transition-all placeholder-neutral-400"placeholder=Name>`), _tmpl$0$3 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 px-2 pb-2"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest pl-1 mt-1">Isolated Session</span><div class="flex flex-wrap gap-1 bg-neutral-100/80 p-1 rounded-[14px] relative z-0"><div class="absolute bg-white rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04] -z-10">`), _tmpl$1$3 = /* @__PURE__ */ template(`<div class="pt-1 px-1"><button class="w-full text-center text-[11px] font-semibold text-red-500 hover:text-white hover:bg-red-500 py-2 rounded-xl transition-colors active:scale-95">Delete Workspace`), _tmpl$10$3 = /* @__PURE__ */ template(`<div class="workspace-dock-popover fixed z-[9999] pointer-events-auto origin-top-left"><div class="bg-white/90 backdrop-blur-3xl ring-1 ring-black/[0.06] rounded-[20px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] w-[260px] flex flex-col p-1.5 overflow-hidden">`), _tmpl$11$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-2 p-3 bg-neutral-50/50 rounded-xl"><div class="text-[12px] font-semibold text-neutral-800">Update current panes?</div><div class="text-[11px] text-neutral-500 leading-relaxed">Switch all active panes in this workspace to <span class="font-bold text-neutral-800"></span>?</div><div class="flex flex-col gap-1 mt-1"><button class="w-full text-center text-[11px] font-medium bg-neutral-900 text-white py-2 rounded-lg transition-transform active:scale-[0.98]">Yes, update all panes</button><button class="w-full text-center text-[11px] font-medium text-neutral-500 hover:bg-neutral-200/50 py-2 rounded-lg transition-colors">No, new panes only`), _tmpl$12$2 = /* @__PURE__ */ template(`<button><div class="flex items-center justify-center w-[16px] h-[16px] rounded-full text-white text-[8px] font-bold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] shrink-0"></div><span class="truncate max-w-[60px]">`);
gsapWithCSS.registerPlugin(Flip);
function WorkspaceDock(props) {
  const [hoveredId, setHoveredId] = createSignal(null);
  const [isCreatingHover, setIsCreatingHover] = createSignal(false);
  const [configOpenId, setConfigOpenId] = createSignal(null);
  const [configPos, setConfigPos] = createSignal(null);
  const [createPos, setCreatePos] = createSignal(null);
  const [cascadePrompt, setCascadePrompt] = createSignal(null);
  onMount(() => {
  });
  return (() => {
    var _el$ = _tmpl$4$5(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.nextSibling, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild;
    insert(_el$4, createComponent(For, {
      get each() {
        return props.workspaces;
      },
      children: (ws) => {
        const isActive = () => props.activeWorkspace === ws.id;
        return (() => {
          var _el$13 = _tmpl$6$4(), _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild;
          _el$13.addEventListener("mouseleave", () => setHoveredId((curr) => curr === ws.id ? null : curr));
          _el$13.addEventListener("mouseenter", () => setHoveredId(ws.id));
          _el$15.$$contextmenu = (e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setConfigPos({
              top: rect.top,
              left: rect.right + 12
            });
            setConfigOpenId(ws.id);
          };
          _el$15.$$click = (e) => {
            if (isActive()) {
              if (configOpenId() === ws.id) {
                setConfigOpenId(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setConfigPos({
                  top: rect.top,
                  left: rect.right + 12
                });
                setConfigOpenId(ws.id);
              }
            } else {
              const oldIndex = props.workspaces.findIndex((w) => w.id === props.activeWorkspace);
              const newIndex = props.workspaces.findIndex((w) => w.id === ws.id);
              const direction = newIndex > oldIndex ? "forward" : "backward";
              props.onWorkspaceSelect(ws.id, direction);
              setConfigOpenId(null);
            }
          };
          insert(_el$16, () => getSmartIcon(ws.name, {
            size: 14,
            strokeWidth: 1.75
          }));
          insert(_el$13, createComponent(Show, {
            get when() {
              return configOpenId() === ws.id;
            },
            get children() {
              return createComponent(WorkspacePopover, {
                ws,
                get configPos() {
                  return configPos();
                },
                onClose: () => setConfigOpenId(null),
                onRename: (name) => {
                  window.api?.updateWorkspace(ws.id, name);
                  props.onWorkspaceRename?.(ws.id, name);
                },
                onSelectProfile: (profileId, profileName) => {
                  setCascadePrompt({
                    profileId: profileId === "main" ? null : profileId,
                    profileName
                  });
                },
                onDelete: async () => {
                  await window.api?.deleteWorkspace(ws.id);
                  setConfigOpenId(null);
                  if (props.activeWorkspace === ws.id) {
                    const index = props.workspaces.findIndex((w) => w.id === ws.id);
                    const nextWs = props.workspaces[index - 1] || props.workspaces[index + 1];
                    if (nextWs) {
                      props.onWorkspaceSelect(nextWs.id, "backward");
                    }
                  }
                },
                get cascadePrompt() {
                  return cascadePrompt();
                },
                onCascadeResponse: async (updatePanes) => {
                  const p = cascadePrompt();
                  if (p) {
                    await window.api?.setWorkspaceDefaultProfile?.(ws.id, p.profileId);
                    if (updatePanes) {
                      await window.api?.updatePaneProfilesForWorkspace(ws.id, p.profileId);
                      props.onWorkspaceSelect(ws.id, "forward");
                    }
                  }
                  setCascadePrompt(null);
                  setConfigOpenId(null);
                }
              });
            }
          }), null);
          insert(_el$13, createComponent(Show, {
            get when() {
              return memo(() => hoveredId() === ws.id)() && !isActive();
            },
            get children() {
              var _el$17 = _tmpl$5$5(), _el$18 = _el$17.firstChild;
              insert(_el$18, () => ws.name);
              return _el$17;
            }
          }), null);
          createRenderEffect((_p$) => {
            var _v$3 = `p-[2px] rounded-[12px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isActive() ? "bg-neutral-900/10 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.25)]" : "bg-transparent"}`, _v$4 = {
              "bg-neutral-900 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.1)]": isActive(),
              "bg-white/70 text-neutral-500 hover:bg-white hover:text-neutral-900 hover:shadow-[0_2px_8px_-4px_rgba(0,0,0,0.1)]": !isActive()
            }, _v$5 = ws.name, _v$6 = `Workspace: ${ws.name}`, _v$7 = isActive(), _v$8 = isActive() && ws.default_profile_id && layoutStore.profiles.find((p) => p.id === ws.default_profile_id)?.color ? `0 0 0 2px ${layoutStore.profiles.find((p) => p.id === ws.default_profile_id)?.color}40` : void 0;
            _v$3 !== _p$.e && className(_el$14, _p$.e = _v$3);
            _p$.t = classList(_el$15, _v$4, _p$.t);
            _v$5 !== _p$.a && setAttribute(_el$15, "title", _p$.a = _v$5);
            _v$6 !== _p$.o && setAttribute(_el$15, "aria-label", _p$.o = _v$6);
            _v$7 !== _p$.i && setAttribute(_el$15, "aria-pressed", _p$.i = _v$7);
            _v$8 !== _p$.n && setStyleProperty(_el$15, "box-shadow", _p$.n = _v$8);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0,
            i: void 0,
            n: void 0
          });
          return _el$13;
        })();
      }
    }));
    _el$6.addEventListener("mouseleave", () => setIsCreatingHover(false));
    _el$6.addEventListener("mouseenter", () => setIsCreatingHover(true));
    insert(_el$7, createComponent(Show, {
      get when() {
        return props.isCreatingWorkspace;
      },
      get fallback() {
        return (() => {
          var _el$19 = _tmpl$7$3();
          _el$19.$$click = (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setCreatePos({
              top: rect.top + rect.height / 2,
              left: rect.right + 12
            });
            props.setIsCreatingWorkspace(true, rect);
          };
          return _el$19;
        })();
      },
      get children() {
        return _tmpl$$6();
      }
    }));
    insert(_el$6, createComponent(Show, {
      get when() {
        return memo(() => !!isCreatingHover())() && !props.isCreatingWorkspace;
      },
      get children() {
        return _tmpl$2$5();
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!props.isCreatingWorkspace)() && createPos();
      },
      get children() {
        return createComponent(Portal, {
          get children() {
            var _el$0 = _tmpl$3$5(), _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling, _el$12 = _el$11.nextSibling;
            _el$11.$$keydown = (e) => {
              if (e.key === "Enter") {
                const val = e.currentTarget.value.trim();
                if (val) props.onCreateWorkspace(val);
              } else if (e.key === "Escape") {
                props.setIsCreatingWorkspace(false);
              }
            };
            _el$12.$$click = () => props.setIsCreatingWorkspace(false);
            createRenderEffect((_p$) => {
              var _v$ = `${createPos()?.top}px`, _v$2 = `${createPos()?.left}px`;
              _v$ !== _p$.e && setStyleProperty(_el$0, "top", _p$.e = _v$);
              _v$2 !== _p$.t && setStyleProperty(_el$0, "left", _p$.t = _v$2);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$0;
          }
        });
      }
    }), null);
    createRenderEffect(() => className(_el$7, `p-[2px] rounded-[12px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isCreatingHover() || props.isCreatingWorkspace ? "bg-neutral-900/10" : "bg-transparent"}`));
    return _el$;
  })();
}
function WorkspacePopover(props) {
  let popoverRef;
  let flipThumbRef;
  const profilesList = () => [{
    id: "main",
    color: "#64748b",
    name: "Main"
  }, ...layoutStore.profiles.filter((p) => p.id !== "main")];
  onMount(() => {
    if (popoverRef) {
      gsapWithCSS.from(popoverRef, {
        x: -10,
        opacity: 0,
        scale: 0.96,
        duration: 0.4,
        ease: "expo.out"
      });
    }
  });
  return createComponent(Portal, {
    get children() {
      return [(() => {
        var _el$20 = _tmpl$8$3();
        _el$20.$$click = (e) => {
          e.stopPropagation();
          props.onClose();
        };
        return _el$20;
      })(), (() => {
        var _el$21 = _tmpl$10$3(), _el$22 = _el$21.firstChild;
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$22) : popoverRef = _el$22;
        insert(_el$22, createComponent(Show, {
          get when() {
            return !props.cascadePrompt;
          },
          get fallback() {
            return (() => {
              var _el$33 = _tmpl$11$2(), _el$34 = _el$33.firstChild, _el$35 = _el$34.nextSibling, _el$36 = _el$35.firstChild, _el$37 = _el$36.nextSibling, _el$38 = _el$35.nextSibling, _el$39 = _el$38.firstChild, _el$40 = _el$39.nextSibling;
              insert(_el$37, () => props.cascadePrompt?.profileName);
              _el$39.$$click = (e) => {
                e.stopPropagation();
                props.onCascadeResponse(true);
              };
              _el$40.$$click = (e) => {
                e.stopPropagation();
                props.onCascadeResponse(false);
              };
              return _el$33;
            })();
          },
          get children() {
            return [(() => {
              var _el$23 = _tmpl$9$3(), _el$24 = _el$23.firstChild, _el$25 = _el$24.nextSibling, _el$26 = _el$25.firstChild;
              _el$26.$$keydown = (e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              };
              _el$26.addEventListener("blur", (e) => {
                const val = e.target.value.trim();
                if (val && val !== props.ws.name) props.onRename(val);
              });
              createRenderEffect(() => _el$26.value = props.ws.name);
              return _el$23;
            })(), (() => {
              var _el$27 = _tmpl$0$3(), _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$29.firstChild;
              var _ref$2 = flipThumbRef;
              typeof _ref$2 === "function" ? use(_ref$2, _el$30) : flipThumbRef = _el$30;
              insert(_el$29, createComponent(For, {
                get each() {
                  return profilesList();
                },
                children: (profile) => {
                  let btnRef;
                  const isSelected = () => (props.ws.default_profile_id || "main") === profile.id;
                  onMount(() => {
                    if (isSelected() && btnRef && flipThumbRef) {
                      btnRef.appendChild(flipThumbRef);
                      gsapWithCSS.set(flipThumbRef, {
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0
                      });
                    }
                  });
                  return (() => {
                    var _el$41 = _tmpl$12$2(), _el$42 = _el$41.firstChild, _el$43 = _el$42.nextSibling;
                    _el$41.$$click = (e) => {
                      e.stopPropagation();
                      if (isSelected()) return;
                      if (flipThumbRef && btnRef) {
                        const state = Flip.getState(flipThumbRef);
                        btnRef.appendChild(flipThumbRef);
                        Flip.from(state, {
                          duration: 0.4,
                          ease: "power3.out",
                          absolute: true
                        });
                      }
                      props.onSelectProfile(profile.id, profile.name);
                    };
                    var _ref$3 = btnRef;
                    typeof _ref$3 === "function" ? use(_ref$3, _el$41) : btnRef = _el$41;
                    insert(_el$42, () => profile.name.charAt(0).toUpperCase());
                    insert(_el$43, () => profile.name);
                    createRenderEffect((_p$) => {
                      var _v$1 = `relative flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[10px] z-10 text-[11px] font-semibold transition-colors ${isSelected() ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-700"}`, _v$10 = profile.color;
                      _v$1 !== _p$.e && className(_el$41, _p$.e = _v$1);
                      _v$10 !== _p$.t && setStyleProperty(_el$42, "background-color", _p$.t = _v$10);
                      return _p$;
                    }, {
                      e: void 0,
                      t: void 0
                    });
                    return _el$41;
                  })();
                }
              }), null);
              return _el$27;
            })(), (() => {
              var _el$31 = _tmpl$1$3(), _el$32 = _el$31.firstChild;
              _el$32.$$click = (e) => {
                e.stopPropagation();
                if (e.currentTarget.textContent?.includes("Confirm")) {
                  props.onDelete();
                } else {
                  e.currentTarget.textContent = "Confirm Delete";
                }
              };
              return _el$31;
            })()];
          }
        }));
        createRenderEffect((_p$) => {
          var _v$9 = `${props.configPos?.top || 0}px`, _v$0 = `${props.configPos?.left || 0}px`;
          _v$9 !== _p$.e && setStyleProperty(_el$21, "top", _p$.e = _v$9);
          _v$0 !== _p$.t && setStyleProperty(_el$21, "left", _p$.t = _v$0);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$21;
      })()];
    }
  });
}
delegateEvents(["keydown", "click", "contextmenu"]);
var _tmpl$$5 = /* @__PURE__ */ template(`<span class="flex items-center gap-1.5 pl-4 pr-2 mr-1 border-r border-neutral-200/70 select-none shrink-0"><span class=text-neutral-400></span><span class="text-[10.5px] font-semibold tracking-[0.14em] uppercase text-neutral-500 whitespace-nowrap max-w-[100px] truncate">`), _tmpl$2$4 = /* @__PURE__ */ template(`<span class="text-[11px] text-neutral-400 italic px-2 select-none shrink-0">No tabs — start one →`), _tmpl$3$4 = /* @__PURE__ */ template(`<div class="flex items-center gap-1.5 pointer-events-auto w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&amp;::-webkit-scrollbar]:hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] shrink-0"role=tablist style=-webkit-app-region:no-drag><div class="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&amp;::-webkit-scrollbar]:hidden shrink min-w-0"></div><div class="p-[2px] rounded-[12px] ml-0.5 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] bg-transparent hover:bg-neutral-900/10"><button title="New Tab"aria-label="New Tab"class="group/newtab flex items-center justify-center w-7 h-7 rounded-[10px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.92] bg-white/70 text-neutral-500 hover:bg-neutral-900 hover:text-white hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"><span class="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover/newtab:rotate-90 group-active/newtab:scale-[0.9]"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.75 stroke-linecap=round><path d="M12 5v14M5 12h14">`), _tmpl$4$4 = /* @__PURE__ */ template(`<button><svg width=8 height=8 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round><path d="M18 6 6 18M6 6l12 12">`), _tmpl$5$4 = /* @__PURE__ */ template(`<div class="relative group/tab shrink-0"role=presentation><div><button role=tab><span>`), _tmpl$6$3 = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[9998] pointer-events-auto">`), _tmpl$7$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 p-2"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest pl-1">Tab Name</span><div class="relative group/input"><input type=text autofocus class="w-full text-[13px] font-semibold text-neutral-800 bg-neutral-100/50 hover:bg-neutral-100 focus:bg-white focus:ring-2 focus:ring-neutral-200/60 rounded-xl px-2.5 py-1.5 outline-none transition-all placeholder-neutral-400"placeholder=Name>`), _tmpl$8$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1 px-2 pb-2"><span class="text-[9px] font-bold text-neutral-400 uppercase tracking-widest pl-1 mt-1">Isolated Session</span><div class="flex flex-wrap gap-1 bg-neutral-100/80 p-1 rounded-[14px] relative z-0"><div class="absolute bg-white rounded-[10px] shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04] -z-10">`), _tmpl$9$2 = /* @__PURE__ */ template(`<div class="pt-1 px-1"><button class="w-full text-center text-[11px] font-semibold text-red-500 hover:text-white hover:bg-red-500 py-2 rounded-xl transition-colors active:scale-95">Delete Tab`), _tmpl$0$2 = /* @__PURE__ */ template(`<div class="tab-island-popover fixed z-[9999] pointer-events-auto cursor-default transform origin-top-left"><div class="bg-white/90 backdrop-blur-3xl ring-1 ring-black/[0.06] rounded-[20px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] w-[260px] flex flex-col p-1.5 overflow-hidden">`), _tmpl$1$2 = /* @__PURE__ */ template(`<div class="flex flex-col gap-2 p-3 bg-neutral-50/50 rounded-xl"><div class="text-[12px] font-semibold text-neutral-800">Update current panes?</div><div class="text-[11px] text-neutral-500 leading-relaxed">Switch all active panes in this tab to <span class="font-bold text-neutral-800"></span>?</div><div class="flex flex-col gap-1 mt-1"><button class="w-full text-center text-[11px] font-medium bg-neutral-900 text-white py-2 rounded-lg transition-transform active:scale-[0.98]">Yes, update all panes</button><button class="w-full text-center text-[11px] font-medium text-neutral-500 hover:bg-neutral-200/50 py-2 rounded-lg transition-colors">No, new panes only`), _tmpl$10$2 = /* @__PURE__ */ template(`<button><div class="flex items-center justify-center w-[16px] h-[16px] rounded-full text-white text-[8px] font-bold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] shrink-0"></div><span class="truncate max-w-[60px]">`);
gsapWithCSS.registerPlugin(Flip);
function TabIsland(props) {
  const [configOpenId, setConfigOpenId] = createSignal(null);
  const [configPos, setConfigPos] = createSignal(null);
  const [cascadePrompt, setCascadePrompt] = createSignal(null);
  createSignal(false);
  const isCompact = () => props.tabs.length > 4;
  onMount(() => {
  });
  return (() => {
    var _el$ = _tmpl$3$4(), _el$5 = _el$.firstChild, _el$7 = _el$5.nextSibling, _el$8 = _el$7.firstChild;
    insert(_el$, createComponent(Show, {
      get when() {
        return props.activeWorkspaceName;
      },
      get children() {
        var _el$2 = _tmpl$$5(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
        insert(_el$3, () => getSmartIcon(props.activeWorkspaceName, {
          size: 12,
          strokeWidth: 1.75
        }));
        insert(_el$4, () => props.activeWorkspaceName);
        return _el$2;
      }
    }), _el$5);
    insert(_el$5, createComponent(For, {
      get each() {
        return props.tabs;
      },
      children: (tab) => {
        const isActive = () => props.activeTabId === tab.id;
        return (() => {
          var _el$9 = _tmpl$5$4(), _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$1.firstChild;
          _el$1.$$contextmenu = (e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            setConfigPos({
              top: rect.bottom + 8,
              left: rect.left
            });
            setConfigOpenId(tab.id);
          };
          _el$1.$$click = (e) => {
            if (isActive()) {
              if (configOpenId() === tab.id) {
                setConfigOpenId(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setConfigPos({
                  top: rect.bottom + 8,
                  left: rect.left
                });
                setConfigOpenId(tab.id);
              }
            } else {
              const oldIndex = props.tabs.findIndex((t) => t.id === props.activeTabId);
              const newIndex = props.tabs.findIndex((t) => t.id === tab.id);
              const direction = newIndex > oldIndex ? "forward" : "backward";
              props.onTabSelect(tab.id, direction);
              setConfigOpenId(null);
            }
          };
          insert(_el$10, () => tab.name);
          insert(_el$9, createComponent(Show, {
            get when() {
              return configOpenId() === tab.id;
            },
            get children() {
              return createComponent(TabPopover, {
                tab,
                get configPos() {
                  return configPos();
                },
                onClose: () => setConfigOpenId(null),
                onRename: (name) => {
                  window.api?.updateTab(tab.id, name);
                  props.onTabRename?.(tab.id, name);
                },
                onSelectProfile: (profileId, profileName) => {
                  setCascadePrompt({
                    profileId: profileId === "main" ? null : profileId,
                    profileName
                  });
                },
                onDelete: async () => {
                  await window.api?.deleteTab(tab.id);
                  setConfigOpenId(null);
                  if (props.onCloseTab) {
                    props.onCloseTab(tab.id);
                  }
                },
                get cascadePrompt() {
                  return cascadePrompt();
                },
                onCascadeResponse: async (updatePanes) => {
                  const p = cascadePrompt();
                  if (p) {
                    await window.api?.setTabDefaultProfile?.(tab.id, p.profileId);
                    if (updatePanes) {
                      await window.api?.updatePaneProfilesForTab(tab.id, p.profileId);
                      props.onTabSelect(tab.id, "forward");
                    }
                  }
                  setCascadePrompt(null);
                  setConfigOpenId(null);
                }
              });
            }
          }), null);
          insert(_el$9, createComponent(Show, {
            get when() {
              return props.onCloseTab;
            },
            get children() {
              var _el$11 = _tmpl$4$4();
              _el$11.$$click = (e) => {
                e.stopPropagation();
                props.onCloseTab?.(tab.id);
              };
              createRenderEffect((_p$) => {
                var _v$ = `Close ${tab.name}`, _v$2 = `absolute -right-1 -top-1 z-10 flex items-center justify-center w-4 h-4 rounded-full bg-white text-neutral-500 border border-neutral-200/80 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-red-500 hover:scale-110 active:scale-95 ${isActive() ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 pointer-events-none group-hover/tab:pointer-events-auto"}`;
                _v$ !== _p$.e && setAttribute(_el$11, "aria-label", _p$.e = _v$);
                _v$2 !== _p$.t && className(_el$11, _p$.t = _v$2);
                return _p$;
              }, {
                e: void 0,
                t: void 0
              });
              return _el$11;
            }
          }), null);
          createRenderEffect((_p$) => {
            var _v$3 = `p-[2px] rounded-[12px] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isActive() ? "bg-neutral-900/10 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.25)]" : "bg-transparent"}`, _v$4 = isActive(), _v$5 = tab.name, _v$6 = `tab-island-button flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-[12px] font-medium tracking-tight whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40 ${isActive() ? "bg-neutral-900 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.1)]" : "bg-white/70 text-neutral-600 hover:bg-white hover:text-neutral-900 hover:shadow-[0_2px_8px_-4px_rgba(0,0,0,0.1)]"}`, _v$7 = `truncate transition-all duration-300 ${isCompact() && !isActive() ? "max-w-[76px]" : "max-w-[140px]"}`;
            _v$3 !== _p$.e && className(_el$0, _p$.e = _v$3);
            _v$4 !== _p$.t && setAttribute(_el$1, "aria-selected", _p$.t = _v$4);
            _v$5 !== _p$.a && setAttribute(_el$1, "title", _p$.a = _v$5);
            _v$6 !== _p$.o && className(_el$1, _p$.o = _v$6);
            _v$7 !== _p$.i && className(_el$10, _p$.i = _v$7);
            return _p$;
          }, {
            e: void 0,
            t: void 0,
            a: void 0,
            o: void 0,
            i: void 0
          });
          return _el$9;
        })();
      }
    }));
    insert(_el$, createComponent(Show, {
      get when() {
        return props.tabs.length === 0;
      },
      get children() {
        return _tmpl$2$4();
      }
    }), _el$7);
    _el$8.$$click = (e) => props.onCreateTab(e.currentTarget.getBoundingClientRect());
    createRenderEffect(() => setAttribute(_el$, "aria-label", `Tabs in ${props.activeWorkspaceName}`));
    return _el$;
  })();
}
function TabPopover(props) {
  let popoverRef;
  let flipThumbRef;
  const profilesList = () => [{
    id: "main",
    color: "#64748b",
    name: "Main"
  }, ...layoutStore.profiles.filter((p) => p.id !== "main")];
  onMount(() => {
    if (popoverRef) {
      gsapWithCSS.from(popoverRef, {
        y: -10,
        opacity: 0,
        scale: 0.96,
        duration: 0.4,
        ease: "expo.out"
      });
    }
  });
  return createComponent(Portal, {
    get children() {
      return [(() => {
        var _el$12 = _tmpl$6$3();
        _el$12.$$click = (e) => {
          e.stopPropagation();
          props.onClose();
        };
        return _el$12;
      })(), (() => {
        var _el$13 = _tmpl$0$2(), _el$14 = _el$13.firstChild;
        _el$13.$$click = (e) => e.stopPropagation();
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$14) : popoverRef = _el$14;
        insert(_el$14, createComponent(Show, {
          get when() {
            return !props.cascadePrompt;
          },
          get fallback() {
            return (() => {
              var _el$25 = _tmpl$1$2(), _el$26 = _el$25.firstChild, _el$27 = _el$26.nextSibling, _el$28 = _el$27.firstChild, _el$29 = _el$28.nextSibling, _el$30 = _el$27.nextSibling, _el$31 = _el$30.firstChild, _el$32 = _el$31.nextSibling;
              insert(_el$29, () => props.cascadePrompt?.profileName);
              _el$31.$$click = (e) => {
                e.stopPropagation();
                props.onCascadeResponse(true);
              };
              _el$32.$$click = (e) => {
                e.stopPropagation();
                props.onCascadeResponse(false);
              };
              return _el$25;
            })();
          },
          get children() {
            return [(() => {
              var _el$15 = _tmpl$7$2(), _el$16 = _el$15.firstChild, _el$17 = _el$16.nextSibling, _el$18 = _el$17.firstChild;
              _el$18.$$keydown = (e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              };
              _el$18.addEventListener("blur", (e) => {
                const val = e.target.value.trim();
                if (val && val !== props.tab.name) props.onRename(val);
              });
              createRenderEffect(() => _el$18.value = props.tab.name);
              return _el$15;
            })(), (() => {
              var _el$19 = _tmpl$8$2(), _el$20 = _el$19.firstChild, _el$21 = _el$20.nextSibling, _el$22 = _el$21.firstChild;
              var _ref$2 = flipThumbRef;
              typeof _ref$2 === "function" ? use(_ref$2, _el$22) : flipThumbRef = _el$22;
              insert(_el$21, createComponent(For, {
                get each() {
                  return profilesList();
                },
                children: (profile) => {
                  let btnRef;
                  const isSelected = () => (props.tab.default_profile_id || "main") === profile.id;
                  onMount(() => {
                    if (isSelected() && btnRef && flipThumbRef) {
                      btnRef.appendChild(flipThumbRef);
                      gsapWithCSS.set(flipThumbRef, {
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0
                      });
                    }
                  });
                  return (() => {
                    var _el$33 = _tmpl$10$2(), _el$34 = _el$33.firstChild, _el$35 = _el$34.nextSibling;
                    _el$33.$$click = (e) => {
                      e.stopPropagation();
                      if (isSelected()) return;
                      if (flipThumbRef && btnRef) {
                        const state = Flip.getState(flipThumbRef);
                        btnRef.appendChild(flipThumbRef);
                        Flip.from(state, {
                          duration: 0.4,
                          ease: "power3.out",
                          absolute: true
                        });
                      }
                      props.onSelectProfile(profile.id, profile.name);
                    };
                    var _ref$3 = btnRef;
                    typeof _ref$3 === "function" ? use(_ref$3, _el$33) : btnRef = _el$33;
                    insert(_el$34, () => profile.name.charAt(0).toUpperCase());
                    insert(_el$35, () => profile.name);
                    createRenderEffect((_p$) => {
                      var _v$0 = `relative flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[10px] z-10 text-[11px] font-semibold transition-colors ${isSelected() ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-700"}`, _v$1 = profile.color;
                      _v$0 !== _p$.e && className(_el$33, _p$.e = _v$0);
                      _v$1 !== _p$.t && setStyleProperty(_el$34, "background-color", _p$.t = _v$1);
                      return _p$;
                    }, {
                      e: void 0,
                      t: void 0
                    });
                    return _el$33;
                  })();
                }
              }), null);
              return _el$19;
            })(), (() => {
              var _el$23 = _tmpl$9$2(), _el$24 = _el$23.firstChild;
              _el$24.$$click = (e) => {
                e.stopPropagation();
                if (e.currentTarget.textContent?.includes("Confirm")) {
                  props.onDelete();
                } else {
                  e.currentTarget.textContent = "Confirm Delete";
                }
              };
              return _el$23;
            })()];
          }
        }));
        createRenderEffect((_p$) => {
          var _v$8 = `${props.configPos?.top || 0}px`, _v$9 = `${props.configPos?.left || 0}px`;
          _v$8 !== _p$.e && setStyleProperty(_el$13, "top", _p$.e = _v$8);
          _v$9 !== _p$.t && setStyleProperty(_el$13, "left", _p$.t = _v$9);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$13;
      })()];
    }
  });
}
delegateEvents(["click", "contextmenu", "keydown"]);
const performTransition = async (type, direction, callback) => {
  if (!document.startViewTransition) {
    await callback();
    return;
  }
  const className2 = `transition-${type}-${direction === "forward" ? type === "vertical" ? "down" : "right" : type === "vertical" ? "up" : "left"}`;
  document.documentElement.classList.add(className2);
  const transition = document.startViewTransition(async () => {
    await callback();
  });
  try {
    await transition.finished;
  } finally {
    document.documentElement.classList.remove(className2);
  }
};
const safeSetLocal = (key, val) => {
  if (window.IS_WEB_DEMO) return;
  try {
    localStorage.setItem(key, val);
  } catch (e) {
  }
};
const safeGetLocal = (key) => {
  if (window.IS_WEB_DEMO) return null;
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
};
function useWorkspaceManager() {
  const [workspaces, setWorkspaces] = createSignal([]);
  const [activeWorkspace, setActiveWorkspace] = createSignal("");
  const [tabs, setTabs] = createSignal([]);
  const [activeTabId, setActiveTabId] = createSignal("");
  const [activePaneId, setActivePaneId] = createSignal("pane_initial");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = createSignal(false);
  const [closedItemsStack, setClosedItemsStack] = createSignal([]);
  let saveTimer = null;
  const getParent = (id) => {
    for (const key in layoutStore.nodes) {
      const node = layoutStore.nodes[key];
      if (node && node.type === "split") {
        if (node.a === id) return [node, "a"];
        if (node.b === id) return [node, "b"];
      }
    }
    return null;
  };
  const loadNodesForTab = async (tabId, preloadedTabs) => {
    const tabList = preloadedTabs || tabs();
    const tab = tabList.find((t) => t.id === tabId);
    if (!tab) return;
    setLayoutStore("rootId", "");
    if (tab.layout_state) {
      try {
        const state = JSON.parse(tab.layout_state);
        setLayoutStore("nodes", reconcile({ ...layoutStore.nodes, ...state.nodes }));
        setLayoutStore("rootId", state.rootId);
        let firstPaneId = state.rootId;
        const findPane = (id) => {
          const node = state.nodes[id];
          if (!node) return id;
          if (node.type === "pane") return id;
          return findPane(node.a);
        };
        setActivePaneId(findPane(state.rootId));
        return;
      } catch (e) {
        console.error("Failed to restore tab layout state", e);
      }
    }
    const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const initialId = `pane_${tabId}_${uniqueSuffix}`;
    const defaultProfile = workspaces().find((w) => w.id === activeWorkspace())?.default_profile_id;
    setLayoutStore("nodes", reconcile({
      ...layoutStore.nodes,
      [initialId]: { type: "pane", id: initialId, paneType: "web", title: "New Tab", profileId: defaultProfile }
    }));
    setLayoutStore("rootId", initialId);
    setActivePaneId(initialId);
  };
  const findFirstPane = (id) => {
    const node = layoutStore.nodes[id];
    if (!node) return id;
    if (node.type === "pane") return id;
    return findFirstPane(node.a);
  };
  const saveLayout = (immediate = false) => {
    const currentTabId = activeTabId();
    if (!currentTabId) return;
    const executeSave = () => {
      if (currentTabId !== activeTabId()) return;
      const getTreeNodes = (id, acc) => {
        const n = layoutStore.nodes[id];
        if (!n) return acc;
        acc[id] = n;
        if (n.type === "split") {
          getTreeNodes(n.a, acc);
          getTreeNodes(n.b, acc);
        }
        return acc;
      };
      const activeNodes = getTreeNodes(layoutStore.rootId, {});
      const serialized = JSON.stringify({ nodes: activeNodes, rootId: layoutStore.rootId });
      if (Object.keys(activeNodes).length > 0) {
        window.api?.saveTabLayout(currentTabId, serialized);
        setTabs((tbs) => tbs.map((t) => t.id === currentTabId ? { ...t, layout_state: serialized } : t));
      }
    };
    if (immediate) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      executeSave();
    } else {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = window.setTimeout(executeSave, 500);
    }
  };
  const handleCreateTab = async (rect) => {
    if (!activeWorkspace()) return;
    if (!layoutStore.isPremium && tabs().length >= 3) {
      if (rect) setLayoutStore("paywallAnchor", { top: rect.top, left: rect.left, width: rect.width, height: rect.height });
      setLayoutStore("paywallReason", "tab");
      setLayoutStore("showPaywall", true);
      return;
    }
    const id = `tab_${Date.now()}`;
    await window.api?.createTab(id, activeWorkspace(), "New Tab");
    const t = await window.api?.getTabs(activeWorkspace());
    setTabs(t || []);
    performTransition("horizontal", "forward", () => {
      setActiveTabId(id);
      safeSetLocal(`last_active_tab_${activeWorkspace()}`, id);
      loadNodesForTab(id, t);
    });
  };
  const handleSplit = (paneId, direction) => {
    const parent = getParent(paneId);
    const newPaneId = `pane_${Date.now()}`;
    const newSplitId = `split_${Date.now()}`;
    const defaultProfile = workspaces().find((w) => w.id === activeWorkspace())?.default_profile_id;
    setLayoutStore("nodes", newPaneId, { type: "pane", id: newPaneId, paneType: "web", title: "New Tab", profileId: defaultProfile });
    let aId = paneId;
    let bId = newPaneId;
    let splitDir = "horizontal";
    if (direction === "top" || direction === "bottom" || direction === "vertical") splitDir = "vertical";
    if (direction === "left" || direction === "top") {
      aId = newPaneId;
      bId = paneId;
    }
    setLayoutStore("nodes", newSplitId, {
      type: "split",
      id: newSplitId,
      direction: splitDir,
      ratio: 0.5,
      a: aId,
      b: bId
    });
    if (parent) setLayoutStore("nodes", parent[0].id, parent[1], newSplitId);
    else if (layoutStore.rootId === paneId) setLayoutStore("rootId", newSplitId);
    saveLayout(true);
  };
  const handleClose = async (paneId, killTerminal = true) => {
    if (layoutStore.rootId === paneId) {
      if (!activeTabId() || !activeWorkspace()) return;
      const deleteTree = (id) => {
        const n = layoutStore.nodes[id];
        if (!n) return;
        if (n.type === "split") {
          deleteTree(n.a);
          deleteTree(n.b);
        } else if (n.type === "pane" && n.paneType === "terminal" && killTerminal) {
          window.electron?.ipcRenderer.send("terminal.destroy", n.id);
        }
        setLayoutStore("nodes", id, void 0);
      };
      deleteTree(layoutStore.rootId);
      const currentTabId = activeTabId();
      const t = tabs();
      const tabToClose = t.find((tb) => tb.id === currentTabId);
      const tabIndex = t.findIndex((tb) => tb.id === currentTabId);
      if (tabToClose) {
        setClosedItemsStack((prev) => [...prev, {
          type: "tab",
          workspaceId: activeWorkspace(),
          layout: tabToClose.layout_state,
          name: tabToClose.name
        }]);
      }
      await window.api?.deleteTab(currentTabId).catch(console.error);
      const newTabs = await window.api?.getTabs(activeWorkspace()).catch(() => []);
      setTabs(newTabs || []);
      if (newTabs && newTabs.length > 0) {
        const nextTab = newTabs[tabIndex > 0 ? tabIndex - 1 : 0];
        performTransition("horizontal", "backward", () => {
          setActiveTabId(nextTab.id);
          loadNodesForTab(nextTab.id, newTabs);
        });
      } else {
        handleCreateTab();
      }
      return;
    }
    const closingPane = layoutStore.nodes[paneId];
    if (closingPane && closingPane.type === "pane" && closingPane.paneType === "terminal" && killTerminal) {
      window.electron?.ipcRenderer.send("terminal.destroy", paneId);
    }
    const parent = getParent(paneId);
    if (!parent) return;
    const siblingId = parent[1] === "a" ? parent[0].b : parent[0].a;
    const grandParent = getParent(parent[0].id);
    setClosedItemsStack((prev) => [...prev, {
      type: "pane",
      workspaceId: activeWorkspace(),
      tabId: activeTabId(),
      paneData: closingPane,
      siblingId,
      splitDir: parent[0].direction,
      wasA: parent[1] === "a"
    }]);
    setLayoutStore("nodes", paneId, void 0);
    setLayoutStore("nodes", parent[0].id, void 0);
    if (grandParent) setLayoutStore("nodes", grandParent[0].id, grandParent[1], siblingId);
    else setLayoutStore("rootId", siblingId);
    if (activePaneId() === paneId) {
      setActivePaneId(findFirstPane(siblingId));
    }
    saveLayout(true);
  };
  const handleRatioChange = (splitId, ratio) => {
    setLayoutStore("nodes", splitId, "ratio", ratio);
    saveLayout();
  };
  const handleUpdatePane = (paneId, data) => {
    setLayoutStore("nodes", paneId, (p) => ({ ...p, ...data }));
    if (data.profileId) {
      window.api?.viewUpdateProfile?.(paneId, data.profileId);
    }
    saveLayout(true);
  };
  const applyLayoutTemplate = (paneId, templateType) => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const defaultProfile = workspaces().find((w) => w.id === activeWorkspace())?.default_profile_id || "main";
    let splitMainId = "";
    let nodesToAdd = {};
    if (templateType === "agency") {
      const paneSlackId = `pane_slack_${suffix}`;
      const paneGmailId = `pane_gmail_${suffix}`;
      const paneNotionId = `pane_notion_${suffix}`;
      const splitRightId = `split_right_${suffix}`;
      splitMainId = `split_main_${suffix}`;
      nodesToAdd = {
        [paneSlackId]: { type: "pane", id: paneSlackId, paneType: "web", url: "https://slack.com", title: "Slack", profileId: defaultProfile },
        [paneGmailId]: { type: "pane", id: paneGmailId, paneType: "web", url: "https://mail.google.com", title: "Gmail", profileId: defaultProfile },
        [paneNotionId]: { type: "pane", id: paneNotionId, paneType: "web", url: "https://notion.so", title: "Notion", profileId: defaultProfile },
        [splitRightId]: { type: "split", id: splitRightId, direction: "vertical", ratio: 0.5, a: paneGmailId, b: paneNotionId },
        [splitMainId]: { type: "split", id: splitMainId, direction: "horizontal", ratio: 0.3, a: paneSlackId, b: splitRightId }
      };
    } else if (templateType === "dev") {
      const paneGithubId = `pane_github_${suffix}`;
      const paneChatgptId = `pane_chatgpt_${suffix}`;
      splitMainId = `split_main_${suffix}`;
      nodesToAdd = {
        [paneGithubId]: { type: "pane", id: paneGithubId, paneType: "web", url: "https://github.com", title: "GitHub", profileId: defaultProfile },
        [paneChatgptId]: { type: "pane", id: paneChatgptId, paneType: "web", url: "https://chatgpt.com", title: "ChatGPT", profileId: defaultProfile },
        [splitMainId]: { type: "split", id: splitMainId, direction: "horizontal", ratio: 0.5, a: paneGithubId, b: paneChatgptId }
      };
    } else if (templateType === "marketing") {
      const paneCanvaId = `pane_canva_${suffix}`;
      const paneHubspotId = `pane_hubspot_${suffix}`;
      splitMainId = `split_main_${suffix}`;
      nodesToAdd = {
        [paneCanvaId]: { type: "pane", id: paneCanvaId, paneType: "web", url: "https://canva.com", title: "Canva", profileId: defaultProfile },
        [paneHubspotId]: { type: "pane", id: paneHubspotId, paneType: "web", url: "https://hubspot.com", title: "HubSpot", profileId: defaultProfile },
        [splitMainId]: { type: "split", id: splitMainId, direction: "horizontal", ratio: 0.5, a: paneCanvaId, b: paneHubspotId }
      };
    }
    const parent = getParent(paneId);
    if (parent) {
      setLayoutStore("nodes", parent[0].id, parent[1], splitMainId);
    } else if (layoutStore.rootId === paneId) {
      setLayoutStore("rootId", splitMainId);
    }
    setLayoutStore("nodes", (nodes) => {
      const nextNodes = { ...nodes, ...nodesToAdd };
      delete nextNodes[paneId];
      return nextNodes;
    });
    setActivePaneId(findFirstPane(splitMainId));
    saveLayout(true);
  };
  const fastSwitchWorkspace = async (wsId) => {
    setLayoutStore("isTransitioning", true);
    window.api?.viewHideAll();
    setActiveWorkspace(wsId);
    safeSetLocal("last_active_workspace", wsId);
    let t = await window.api?.getTabs(wsId).catch(() => []);
    setTabs(t || []);
    if (t && t.length > 0) {
      const lastTab = safeGetLocal(`last_active_tab_${wsId}`);
      const activeTab = t.find((tab) => tab.id === lastTab) ? lastTab : t[0].id;
      setActiveTabId(activeTab);
      await loadNodesForTab(activeTab, t);
    }
    setLayoutStore("isTransitioning", false);
  };
  const demoTransitionTo = async (targetWsId, targetTabId, mockTabs, direction) => {
    const currentWs = activeWorkspace();
    const isWorkspaceSwitch = currentWs !== targetWsId;
    try {
      await window.api?.viewHibernateAllActive();
    } catch (e) {
      console.warn("Failed to hibernate panes for transition", e);
    }
    setLayoutStore("isTransitioning", true);
    window.api?.viewHideAll();
    if (isWorkspaceSwitch) {
      await performTransition("vertical", direction, async () => {
        setActiveWorkspace(targetWsId);
        safeSetLocal("last_active_workspace", targetWsId);
        setTabs(mockTabs);
        setActiveTabId(targetTabId);
        safeSetLocal(`last_active_tab_${targetWsId}`, targetTabId);
        await loadNodesForTab(targetTabId, mockTabs);
      });
    } else {
      await performTransition("horizontal", direction, async () => {
        setTabs(mockTabs);
        setActiveTabId(targetTabId);
        safeSetLocal(`last_active_tab_${targetWsId}`, targetTabId);
        await loadNodesForTab(targetTabId, mockTabs);
      });
    }
    setLayoutStore("isTransitioning", false);
    if (window.IS_WEB_DEMO) {
      window.dispatchEvent(new CustomEvent("demo:tab-switched", { detail: targetTabId }));
    }
  };
  const demoSwitchTo = async (wsId, tabId, mockTabs) => {
    setLayoutStore("isTransitioning", true);
    window.api?.viewHideAll();
    setActiveWorkspace(wsId);
    safeSetLocal("last_active_workspace", wsId);
    setTabs(mockTabs);
    setActiveTabId(tabId);
    safeSetLocal(`last_active_tab_${wsId}`, tabId);
    await loadNodesForTab(tabId, mockTabs);
    setLayoutStore("isTransitioning", false);
  };
  const switchWorkspace = async (wsId, direction) => {
    try {
      await window.api?.viewHibernateAllActive();
    } catch (e) {
      console.warn("Failed to hibernate panes for transition", e);
    }
    setLayoutStore("isTransitioning", true);
    if (layoutStore.maximizedPaneId) setLayoutStore("maximizedPaneId", null);
    window.api?.viewHideAll();
    await performTransition("vertical", direction, async () => {
      setActiveWorkspace(wsId);
      safeSetLocal("last_active_workspace", wsId);
      let t = await window.api?.getTabs(wsId).catch(() => []);
      setTabs(t || []);
      if (t && t.length > 0) {
        const lastTab = safeGetLocal(`last_active_tab_${wsId}`);
        const activeTab = t.find((tab) => tab.id === lastTab) ? lastTab : t[0].id;
        setActiveTabId(activeTab);
        await loadNodesForTab(activeTab, t);
      }
    });
    setLayoutStore("isTransitioning", false);
    if (window.IS_WEB_DEMO) {
      window.dispatchEvent(new CustomEvent("demo:workspace-switched", { detail: wsId }));
    }
  };
  const switchTab = async (tabId, direction) => {
    try {
      await window.api?.viewHibernateAllActive();
    } catch (e) {
      console.warn("Failed to hibernate panes for transition", e);
    }
    setLayoutStore("isTransitioning", true);
    if (layoutStore.maximizedPaneId) setLayoutStore("maximizedPaneId", null);
    window.api?.viewHideAll();
    await performTransition("horizontal", direction, async () => {
      setActiveTabId(tabId);
      safeSetLocal(`last_active_tab_${activeWorkspace()}`, tabId);
      await loadNodesForTab(tabId);
    });
    setLayoutStore("isTransitioning", false);
    if (window.IS_WEB_DEMO) {
      window.dispatchEvent(new CustomEvent("demo:tab-switched", { detail: tabId }));
    }
  };
  const reopenClosedTab = async () => {
    const stack = closedItemsStack();
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    setClosedItemsStack(stack.slice(0, -1));
    if (last.type === "tab" && last.workspaceId) {
      const id = `tab_${Date.now()}`;
      await window.api?.createTab(id, last.workspaceId, last.name || "Restored Tab");
      if (last.layout) {
        await window.api?.saveTabLayout(id, last.layout);
      }
      if (activeWorkspace() === last.workspaceId) {
        const t = await window.api?.getTabs(last.workspaceId);
        setTabs(t || []);
        performTransition("horizontal", "backward", () => {
          setActiveTabId(id);
          safeSetLocal(`last_active_tab_${last.workspaceId}`, id);
          loadNodesForTab(id, t);
        });
      }
    } else if (last.type === "pane" && last.workspaceId === activeWorkspace() && last.tabId === activeTabId() && last.paneData && last.siblingId) {
      let targetSiblingId = last.siblingId;
      if (!layoutStore.nodes[targetSiblingId]) {
        targetSiblingId = layoutStore.rootId;
      }
      const restoredPaneId = `pane_${Date.now()}`;
      const newSplitId = `split_${Date.now()}`;
      setLayoutStore("nodes", restoredPaneId, { ...last.paneData, id: restoredPaneId });
      let aId = last.wasA ? restoredPaneId : targetSiblingId;
      let bId = last.wasA ? targetSiblingId : restoredPaneId;
      setLayoutStore("nodes", newSplitId, {
        type: "split",
        id: newSplitId,
        direction: last.splitDir || "horizontal",
        ratio: 0.5,
        a: aId,
        b: bId
      });
      const parent = getParent(targetSiblingId);
      if (parent) {
        setLayoutStore("nodes", parent[0].id, parent[1], newSplitId);
      } else if (layoutStore.rootId === targetSiblingId) {
        setLayoutStore("rootId", newSplitId);
      }
      setActivePaneId(restoredPaneId);
      saveLayout(true);
    } else if (last.type === "workspace") ;
  };
  const navigatePaneFocus = (dir) => {
    let current = activePaneId();
    const requiredPos = {
      "up": "b",
      "down": "a",
      "left": "b",
      "right": "a"
    }[dir];
    const targetDir = dir === "up" || dir === "down" ? "vertical" : "horizontal";
    let parent = getParent(current);
    let splitBoundary = null;
    let entranceDir = "";
    while (parent) {
      const [node, pos] = parent;
      if (node.direction === targetDir && pos === requiredPos) {
        splitBoundary = node;
        entranceDir = dir;
        break;
      }
      current = node.id;
      parent = getParent(current);
    }
    if (!splitBoundary) return;
    let targetNodeId = requiredPos === "a" ? splitBoundary.b : splitBoundary.a;
    while (true) {
      const n = layoutStore.nodes[targetNodeId];
      if (!n || n.type === "pane") {
        setActivePaneId(targetNodeId);
        if (layoutStore.maximizedPaneId) setLayoutStore("maximizedPaneId", targetNodeId);
        break;
      }
      if (n.type === "split") {
        if (n.direction === "vertical") {
          targetNodeId = entranceDir === "up" ? n.b : entranceDir === "down" ? n.a : n.a;
        } else {
          targetNodeId = entranceDir === "left" ? n.b : entranceDir === "right" ? n.a : n.a;
        }
      }
    }
  };
  const swapPaneNode = (dir) => {
    let current = activePaneId();
    const requiredPos = {
      "up": "b",
      "down": "a",
      "left": "b",
      "right": "a"
    }[dir];
    const targetDir = dir === "up" || dir === "down" ? "vertical" : "horizontal";
    let parent = getParent(current);
    let splitBoundary = null;
    while (parent) {
      const [node, pos] = parent;
      if (node.direction === targetDir && pos === requiredPos) {
        splitBoundary = node;
        break;
      }
      current = node.id;
      parent = getParent(current);
    }
    if (!splitBoundary) return;
    const temp = splitBoundary.a;
    setLayoutStore("nodes", splitBoundary.id, "a", splitBoundary.b);
    setLayoutStore("nodes", splitBoundary.id, "b", temp);
    saveLayout();
  };
  onMount(() => {
    window.api?.getProfiles().then((p) => {
      if (p) setLayoutStore("profiles", p);
    }).catch(console.error);
    window.api?.getWorkspaces().then((data) => {
      if (data && data.length > 0) {
        setWorkspaces(data);
        const lastWs = safeGetLocal("last_active_workspace");
        const activeWs = data.find((w) => w.id === lastWs) ? lastWs : data[0].id;
        setActiveWorkspace(activeWs);
        window.api?.getTabs(activeWs).then((t) => {
          setTabs(t || []);
          if (t && t.length > 0) {
            const lastTab = safeGetLocal(`last_active_tab_${activeWs}`);
            const activeTab = t.find((tab) => tab.id === lastTab) ? lastTab : t[0].id;
            setActiveTabId(activeTab);
            loadNodesForTab(activeTab, t);
          }
        });
      }
    }).catch(console.error);
  });
  createEffect(() => {
    const active = activePaneId();
    if (active) {
      setTimeout(() => {
        window.api?.viewFocus?.(active);
      }, 50);
    }
  });
  return {
    workspaces,
    setWorkspaces,
    activeWorkspace,
    setActiveWorkspace,
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    activePaneId,
    setActivePaneId,
    isCreatingWorkspace,
    setIsCreatingWorkspace,
    // Actions
    handleCreateTab,
    handleSplit,
    handleClose,
    handleRatioChange,
    handleUpdatePane,
    applyLayoutTemplate,
    switchWorkspace,
    fastSwitchWorkspace,
    demoSwitchTo,
    demoTransitionTo,
    switchTab,
    loadNodesForTab,
    getParent,
    saveLayout,
    reopenClosedTab,
    navigatePaneFocus,
    swapPaneNode
  };
}
const DEFAULT_SHORTCUTS = [
  { id: "next_tab", key: "arrowright", mod: true, label: "Next Tab", category: "Navigation" },
  { id: "next_tab_alt", key: "tab", mod: true, label: "Next Tab (Alt)", category: "Navigation" },
  { id: "prev_tab", key: "arrowleft", mod: true, label: "Previous Tab", category: "Navigation" },
  { id: "prev_tab_alt", key: "tab", mod: true, shift: true, label: "Previous Tab (Alt)", category: "Navigation" },
  { id: "next_workspace", key: "arrowdown", mod: true, label: "Next Workspace", category: "Navigation" },
  { id: "prev_workspace", key: "arrowup", mod: true, label: "Previous Workspace", category: "Navigation" },
  { id: "cmd_palette", key: " ", alt: true, label: "Command Palette", category: "General" },
  { id: "cmd_palette_mac", key: " ", mod: true, label: "Command Palette (Mac)", category: "General" },
  { id: "focus_address", key: "l", mod: true, label: "Focus Address Bar", category: "General" },
  { id: "focus_address_alt", key: "k", mod: true, label: "Focus Address Bar (Alt)", category: "General" },
  { id: "zen_mode", key: "z", alt: true, label: "Toggle Zen Mode", category: "View" },
  { id: "zen_mode_f11", key: "f11", label: "Zen Mode (F11)", category: "View" },
  { id: "escape", key: "escape", label: "Escape", category: "General" },
  { id: "split_vert", key: "\\", mod: true, label: "Split Vertically", category: "Layout" },
  { id: "split_vert_alt", key: "d", mod: true, shift: true, label: "Split Vertically (Alt)", category: "Layout" },
  { id: "split_right", key: "arrowright", mod: true, shift: true, label: "Split Right", category: "Layout" },
  { id: "split_left", key: "arrowleft", mod: true, shift: true, label: "Split Left", category: "Layout" },
  { id: "split_horiz", key: "e", mod: true, shift: true, label: "Split Horizontally", category: "Layout" },
  { id: "split_down", key: "arrowdown", mod: true, shift: true, label: "Split Down", category: "Layout" },
  { id: "split_up", key: "arrowup", mod: true, shift: true, label: "Split Up", category: "Layout" },
  { id: "new_tab", key: "t", mod: true, label: "New Tab", category: "General" },
  { id: "close_tab", key: "w", mod: true, label: "Close Tab", category: "General" },
  { id: "reopen_tab", key: "t", mod: true, shift: true, label: "Reopen Closed Tab", category: "General" },
  { id: "pin_tab", key: "p", mod: true, shift: true, label: "Pin / Unpin Tab", category: "General" },
  { id: "new_workspace", key: "n", mod: true, shift: true, label: "New Workspace", category: "General" },
  { id: "find_in_page", key: "f", mod: true, label: "Find in Page", category: "General" },
  { id: "reload", key: "r", mod: true, label: "Reload", category: "View" },
  { id: "reload_f5", key: "f5", label: "Reload (F5)", category: "View" },
  { id: "toggle_immersion", key: "f", mod: true, shift: true, label: "Toggle Immersion", category: "View" },
  { id: "mute_pane", key: "m", mod: true, shift: true, label: "Mute/Unmute Pane", category: "View" },
  { id: "zoom_in", key: "=", mod: true, label: "Zoom In", category: "View" },
  { id: "zoom_out", key: "-", mod: true, label: "Zoom Out", category: "View" },
  { id: "zoom_reset", key: "0", mod: true, label: "Reset Zoom", category: "View" },
  { id: "lock_grid", key: "l", mod: true, shift: true, label: "Lock Layout Grid", category: "Layout" },
  { id: "focus_pane_up", key: "arrowup", alt: true, label: "Focus Pane Up", category: "Layout" },
  { id: "focus_pane_down", key: "arrowdown", alt: true, label: "Focus Pane Down", category: "Layout" },
  { id: "focus_pane_left", key: "arrowleft", alt: true, label: "Focus Pane Left", category: "Layout" },
  { id: "focus_pane_right", key: "arrowright", alt: true, label: "Focus Pane Right", category: "Layout" },
  { id: "swap_pane_up", key: "arrowup", alt: true, shift: true, label: "Swap Pane Up", category: "Layout" },
  { id: "swap_pane_down", key: "arrowdown", alt: true, shift: true, label: "Swap Pane Down", category: "Layout" },
  { id: "swap_pane_left", key: "arrowleft", alt: true, shift: true, label: "Swap Pane Left", category: "Layout" },
  { id: "swap_pane_right", key: "arrowright", alt: true, shift: true, label: "Swap Pane Right", category: "Layout" },
  { id: "cheat_sheet", key: "?", shift: true, label: "Show Keyboard Shortcuts", category: "General" },
  { id: "cheat_sheet_alt", key: "/", mod: true, label: "Show Keyboard Shortcuts (Alt)", category: "General" }
];
function loadShortcuts() {
  try {
    const saved = localStorage.getItem("apposition_shortcuts");
    if (saved) {
      const parsed = JSON.parse(saved);
      return DEFAULT_SHORTCUTS.map((def) => {
        const override = parsed.find((p) => p.id === def.id);
        return override ? { ...def, key: override.key, mod: override.mod, shift: override.shift, alt: override.alt } : def;
      });
    }
  } catch (e) {
  }
  return [...DEFAULT_SHORTCUTS];
}
const [activeShortcuts, setActiveShortcuts] = createSignal(loadShortcuts());
function saveShortcut(id, newDef) {
  const current = activeShortcuts();
  const next = current.map((s) => s.id === id ? { ...s, ...newDef } : s);
  setActiveShortcuts(next);
  localStorage.setItem("apposition_shortcuts", JSON.stringify(next));
}
function matchShortcut(e, isMac) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const key = e.key.toLowerCase();
  for (const shortcut of activeShortcuts()) {
    if (shortcut.key === key && !!shortcut.mod === mod && !!shortcut.shift === e.shiftKey && !!shortcut.alt === e.altKey) {
      return shortcut.id;
    }
  }
  if (mod && !e.shiftKey && !e.altKey && key >= "1" && key <= "9") return "jump_tab_" + key;
  if (e.altKey && !mod && !e.shiftKey && key >= "1" && key <= "9") return "jump_workspace_" + key;
  if (mod && e.shiftKey && !e.altKey && key >= "1" && key <= "9") return "jump_profile_" + key;
  return null;
}
var _tmpl$$4 = /* @__PURE__ */ template(`<span class="text-neutral-400 mx-1 text-[10px] font-medium">+`), _tmpl$2$3 = /* @__PURE__ */ template(`<div class="flex items-center"><kbd class="px-2 py-1 rounded-md bg-white border border-neutral-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_-1px_0_rgba(0,0,0,0.02)] text-[11px] font-mono font-semibold text-neutral-700 tracking-wide">`), _tmpl$3$3 = /* @__PURE__ */ template(`<div class="flex items-center">`), _tmpl$4$3 = /* @__PURE__ */ template(`<div data-shortcut-recorder=true tabindex=0>`), _tmpl$5$3 = /* @__PURE__ */ template(`<span class="text-[11px] font-medium text-blue-600 animate-pulse">Press any key... (Esc to cancel)`), _tmpl$6$2 = /* @__PURE__ */ template(`<div class="space-y-3 mt-4 border-t border-neutral-100 pt-4"><div class=space-y-0.5><h4 class="text-xs font-bold text-neutral-800 uppercase tracking-wider">Launchpad Apps</h4><p class="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Configure shortcuts for this profile</p></div><div class="flex items-center gap-2"><input type=text class="flex-1 bg-white border border-neutral-200 rounded-xl px-3 py-2 text-xs text-neutral-800 outline-none focus:border-neutral-300 focus:ring-1 focus:ring-neutral-300 font-medium"placeholder="Website URL (e.g. app.todoist.com)"><button class="text-xs font-semibold bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl px-4 py-2 disabled:opacity-50 transition-colors cursor-pointer">Add Shortcut</button></div><div class="border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100 max-h-40 overflow-y-auto bg-neutral-50/50">`), _tmpl$7$1 = /* @__PURE__ */ template(`<div class="p-3 text-center text-xs text-neutral-450 font-medium italic">No app shortcuts added.`), _tmpl$8$1 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-2 hover:bg-white transition-colors"><div class="flex items-center gap-2 min-w-0"><div class="flex flex-col min-w-0"><span class="text-xs font-bold text-neutral-700 truncate"></span><span class="text-[9px] text-neutral-400 font-medium truncate"></span></div></div><div class="flex items-center gap-1 shrink-0"><button class="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 transition-colors cursor-pointer text-xs"title="Move Up">▲</button><button class="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30 transition-colors cursor-pointer text-xs"title="Move Down">▼</button><button class="p-1 text-neutral-400 hover:text-red-500 transition-colors ml-1 cursor-pointer"title=Delete><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2">`), _tmpl$9$1 = /* @__PURE__ */ template(`<img class="w-20 h-20 rounded-full border-4 border-white shadow-sm object-cover">`), _tmpl$0$1 = /* @__PURE__ */ template(`<div class="absolute -bottom-2 -right-2 bg-neutral-900 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full border-2 border-white shadow-sm flex items-center gap-1"><svg width=10 height=10 viewBox="0 0 24 24"fill=currentColor class=text-yellow-400><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>PRO`), _tmpl$1$1 = /* @__PURE__ */ template(`<span class="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-md flex items-center gap-1.5 shadow-sm"><span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span> Active`), _tmpl$10$1 = /* @__PURE__ */ template(`<div class=space-y-2><div class="flex items-center justify-between"><span class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">License Key</span><button class="text-[10px] font-semibold text-neutral-400 hover:text-neutral-700 transition-colors">Refresh Status</button></div><div class="flex items-center justify-between bg-white rounded-lg border border-neutral-200 p-3 shadow-sm"><span class="font-mono text-sm font-medium text-neutral-700"></span><button class="text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 px-3 py-1.5 rounded-md transition-colors">Copy`), _tmpl$11$1 = /* @__PURE__ */ template(`<div class="pt-2 flex justify-between items-center text-sm"><span class=text-neutral-500>Renewal Date</span><span class="text-neutral-900 font-medium">`), _tmpl$12$1 = /* @__PURE__ */ template(`<div class="pt-4 text-center"><p class="text-sm text-neutral-500 mb-4">Upgrade to unlock unlimited workspaces, tabs, and incognito profiles.</p><button class="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg shadow-sm transition-colors">Upgrade to Pro`), _tmpl$13$1 = /* @__PURE__ */ template(`<div class="max-w-md mx-auto"><div class="flex flex-col items-center justify-center space-y-4 py-6"><div class=relative></div><div class=text-center><h3 class="text-lg font-semibold text-neutral-900"></h3><p class="text-sm text-neutral-500"></p></div></div><div class="mt-4 bg-white/50 border border-black/[0.04] rounded-[16px] p-5 space-y-5"><div class="flex items-center justify-between pb-4 border-b border-neutral-200"><span class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Subscription`), _tmpl$14$1 = /* @__PURE__ */ template(`<div class="max-w-xl mx-auto"><p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-4">Default Profiles</p><div class="bg-white/50 border border-black/[0.04] rounded-[16px] overflow-hidden divide-y divide-black/[0.04]">`), _tmpl$15$1 = /* @__PURE__ */ template(`<div class="flex items-center justify-between mb-4"><p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Isolated Sessions</p><button class="flex items-center gap-1.5 text-xs font-medium bg-neutral-900 hover:bg-neutral-800 text-white px-3 py-2 rounded-lg transition-colors shadow-sm"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><line x1=12 y1=5 x2=12 y2=19></line><line x1=5 y1=12 x2=19 y2=12></line></svg>New Profile`), _tmpl$16$1 = /* @__PURE__ */ template(`<div class="grid grid-cols-1 gap-3">`), _tmpl$17$1 = /* @__PURE__ */ template(`<div class="max-w-xl mx-auto">`), _tmpl$18$1 = /* @__PURE__ */ template(`<div class="max-w-xl mx-auto"><div class="flex items-center justify-between mb-4"><p class="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Keyboard Shortcuts</p><button class="text-xs font-medium text-neutral-500 hover:text-red-600 transition-colors px-2 py-1 rounded hover:bg-red-50">Reset Defaults</button></div><div class="space-y-6 pb-6">`), _tmpl$19 = /* @__PURE__ */ template(`<div class="fixed z-[99999] w-[600px] h-[480px] bg-white/90 backdrop-blur-3xl ring-1 ring-black/[0.06] rounded-[20px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"><div class="flex items-center justify-between px-5 py-4 border-b border-black/[0.04] bg-transparent"><div class="flex items-center gap-6"><h2 class="text-sm font-semibold text-neutral-800">Settings</h2><div class="flex items-center gap-1 bg-neutral-100/80 p-1 rounded-[14px]"></div></div></div><div class="flex-1 overflow-y-auto bg-transparent p-6">`), _tmpl$20 = /* @__PURE__ */ template(`<button>`), _tmpl$21 = /* @__PURE__ */ template(`<div class="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center border-4 border-white shadow-sm"><svg width=32 height=32 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 class=text-blue-500><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx=12 cy=7 r=4>`), _tmpl$22 = /* @__PURE__ */ template(`<span class="text-xs font-medium text-neutral-600 bg-white border border-neutral-200 px-2.5 py-1 rounded-md shadow-sm">Free Plan`), _tmpl$23 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-4 hover:bg-neutral-50 transition-colors"><div class="flex items-center gap-3"><div class="relative shrink-0 flex items-center justify-center w-8 h-8 rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600"></div><div class="text-sm font-medium text-neutral-900"></div></div><select class="text-sm border border-neutral-200 rounded-lg py-2 px-3 bg-white text-neutral-700 focus:outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900 cursor-pointer shadow-sm hover:border-neutral-300 transition-colors"><option value=main>Main (Default)`), _tmpl$24 = /* @__PURE__ */ template(`<option>`), _tmpl$25 = /* @__PURE__ */ template(`<div class="bg-white/50 border border-black/[0.04] rounded-[16px] p-5 animate-in fade-in zoom-in-95 duration-200"><h3 class="text-sm font-semibold text-neutral-900 mb-4">`), _tmpl$26 = /* @__PURE__ */ template(`<span class="px-2 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-[10px] font-semibold text-neutral-600 uppercase tracking-wider">Incognito`), _tmpl$27 = /* @__PURE__ */ template(`<span class="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Default`), _tmpl$28 = /* @__PURE__ */ template(`<div class="text-[11px] text-neutral-500 mt-1 flex items-center gap-1"><svg width=10 height=10 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9">`), _tmpl$29 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-4 bg-white/60 border border-black/[0.04] rounded-[16px] hover:border-black/[0.08] transition-colors group"><div class="flex items-center gap-4"><div class="flex items-center justify-center w-8 h-8 rounded-full text-white text-xs font-semibold shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)] ring-4 ring-neutral-50 shrink-0"></div><div><div class="flex items-center gap-2"><span class="text-sm font-medium text-neutral-900"></span></div></div></div><button class="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-all">Configure`), _tmpl$30 = /* @__PURE__ */ template(`<div><h3 class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-3 px-1"></h3><div class="bg-white border border-neutral-200 rounded-xl overflow-hidden divide-y divide-neutral-100 shadow-sm">`), _tmpl$31 = /* @__PURE__ */ template(`<div class="flex items-center justify-between p-3 hover:bg-neutral-50 transition-colors"><span class="text-sm text-neutral-700">`);
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
    let keyName = s.key.toUpperCase();
    if (keyName === " ") keyName = "Space";
    if (keyName === "ARROWUP") keyName = "↑";
    if (keyName === "ARROWDOWN") keyName = "↓";
    if (keyName === "ARROWLEFT") keyName = "←";
    if (keyName === "ARROWRIGHT") keyName = "→";
    parts.push(keyName);
    return parts.map((p, i) => (() => {
      var _el$ = _tmpl$2$3(), _el$2 = _el$.firstChild;
      insert(_el$2, p);
      insert(_el$, createComponent(Show, {
        get when() {
          return i < parts.length - 1;
        },
        get children() {
          return _tmpl$$4();
        }
      }), null);
      return _el$;
    })());
  };
  return (() => {
    var _el$4 = _tmpl$4$3();
    _el$4.addEventListener("blur", () => setIsRecording(false));
    addEventListener(_el$4, "keydown", isRecording() ? handleKeyDown : void 0, true);
    _el$4.$$click = () => setIsRecording(true);
    insert(_el$4, createComponent(Show, {
      get when() {
        return !isRecording();
      },
      get fallback() {
        return _tmpl$5$3();
      },
      get children() {
        var _el$5 = _tmpl$3$3();
        insert(_el$5, () => displayKey(props.shortcut));
        return _el$5;
      }
    }));
    createRenderEffect(() => className(_el$4, `flex items-center justify-end min-w-[120px] h-9 px-2 rounded-lg transition-all cursor-pointer ${isRecording() ? "bg-blue-50 ring-1 ring-blue-500 shadow-[inset_0_1px_1px_rgba(0,0,0,0.05)]" : "hover:bg-neutral-50 border border-transparent hover:border-neutral-200/60"}`));
    return _el$4;
  })();
}
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
      const defaults2 = appDirectory.slice(0, 7);
      setApps(defaults2);
      localStorage.setItem(key, JSON.stringify(defaults2));
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
    } catch (e) {
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
    var _el$7 = _tmpl$6$2(), _el$8 = _el$7.firstChild, _el$9 = _el$8.nextSibling, _el$0 = _el$9.firstChild, _el$1 = _el$0.nextSibling, _el$10 = _el$9.nextSibling;
    _el$0.$$input = (e) => setNewUrl(e.currentTarget.value);
    _el$1.$$click = handleAdd;
    insert(_el$10, createComponent(Show, {
      get when() {
        return apps().length > 0;
      },
      get fallback() {
        return _tmpl$7$1();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return apps();
          },
          children: (app, idx) => (() => {
            var _el$12 = _tmpl$8$1(), _el$13 = _el$12.firstChild, _el$14 = _el$13.firstChild, _el$15 = _el$14.firstChild, _el$16 = _el$15.nextSibling, _el$17 = _el$13.nextSibling, _el$18 = _el$17.firstChild, _el$19 = _el$18.nextSibling, _el$20 = _el$19.nextSibling;
            insert(_el$13, createComponent(AppIcon, {
              app,
              "class": "w-5 h-5"
            }), _el$14);
            insert(_el$15, () => app.name);
            insert(_el$16, () => app.domain);
            _el$18.$$click = () => handleMove(idx(), -1);
            _el$19.$$click = () => handleMove(idx(), 1);
            _el$20.$$click = () => handleDelete(idx());
            createRenderEffect((_p$) => {
              var _v$ = idx() === 0, _v$2 = idx() === apps().length - 1;
              _v$ !== _p$.e && (_el$18.disabled = _p$.e = _v$);
              _v$2 !== _p$.t && (_el$19.disabled = _p$.t = _v$2);
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$12;
          })()
        });
      }
    }));
    createRenderEffect(() => _el$1.disabled = !newUrl().trim());
    createRenderEffect(() => _el$0.value = newUrl());
    return _el$7;
  })();
}
function SettingsPopover(props) {
  const ws = useWorkspaceManager();
  const [activeTab, setActiveTab] = createSignal("account");
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
    const handleClickOutside = (e) => {
      if (popoverRef && !popoverRef.contains(e.target)) {
        const anchor = layoutStore.settingsAnchor;
        if (anchor) {
          const clickX = e.clientX;
          const clickY = e.clientY;
          if (clickX >= anchor.left && clickX <= anchor.left + anchor.width && clickY >= anchor.top && clickY <= anchor.top + anchor.height) {
            return;
          }
        }
        props.onClose();
      }
    };
    setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 50);
    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
    });
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
  const formatDate = (dateStr) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium"
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };
  return createComponent(Portal, {
    get children() {
      var _el$21 = _tmpl$19(), _el$22 = _el$21.firstChild, _el$23 = _el$22.firstChild, _el$24 = _el$23.firstChild, _el$25 = _el$24.nextSibling, _el$26 = _el$22.nextSibling;
      var _ref$ = popoverRef;
      typeof _ref$ === "function" ? use(_ref$, _el$21) : popoverRef = _el$21;
      insert(_el$25, createComponent(For, {
        each: ["account", "profiles", "workspaces", "shortcuts"],
        children: (tab) => (() => {
          var _el$65 = _tmpl$20();
          _el$65.$$click = () => setActiveTab(tab);
          insert(_el$65, () => tab.charAt(0).toUpperCase() + tab.slice(1));
          createRenderEffect(() => className(_el$65, `px-3 py-1.5 rounded-[10px] text-[11px] font-semibold transition-colors ${activeTab() === tab ? "bg-white text-neutral-900 shadow-[0_2px_8px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]" : "text-neutral-500 hover:text-neutral-700"}`));
          return _el$65;
        })()
      }));
      insert(_el$26, createComponent(Show, {
        get when() {
          return activeTab() === "account";
        },
        get children() {
          var _el$27 = _tmpl$13$1(), _el$28 = _el$27.firstChild, _el$29 = _el$28.firstChild, _el$32 = _el$29.nextSibling, _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling, _el$35 = _el$28.nextSibling, _el$36 = _el$35.firstChild;
          _el$36.firstChild;
          insert(_el$29, createComponent(Show, {
            get when() {
              return layoutStore.licenseState?.customer?.avatar_url;
            },
            get fallback() {
              return _tmpl$21();
            },
            get children() {
              var _el$30 = _tmpl$9$1();
              createRenderEffect(() => setAttribute(_el$30, "src", layoutStore.licenseState.customer.avatar_url));
              return _el$30;
            }
          }), null);
          insert(_el$29, createComponent(Show, {
            get when() {
              return layoutStore.isPremium;
            },
            get children() {
              return _tmpl$0$1();
            }
          }), null);
          insert(_el$33, () => layoutStore.licenseState?.customer?.name || "Local Profile");
          insert(_el$34, () => layoutStore.licenseState?.customer?.email || "No connected email");
          insert(_el$36, createComponent(Show, {
            get when() {
              return layoutStore.isPremium;
            },
            get fallback() {
              return _tmpl$22();
            },
            get children() {
              return _tmpl$1$1();
            }
          }), null);
          insert(_el$35, createComponent(Show, {
            get when() {
              return layoutStore.licenseState?.key;
            },
            get children() {
              return [(() => {
                var _el$39 = _tmpl$10$1(), _el$40 = _el$39.firstChild, _el$41 = _el$40.firstChild, _el$42 = _el$41.nextSibling, _el$43 = _el$40.nextSibling, _el$44 = _el$43.firstChild, _el$45 = _el$44.nextSibling;
                _el$42.$$click = async () => {
                  const key = layoutStore.licenseState?.key;
                  if (key) {
                    await window.api?.validateLicenseKey(key);
                    const state = await window.api?.getLicenseState?.();
                    if (state) setLayoutStore("licenseState", state);
                  }
                };
                insert(_el$44, () => layoutStore.licenseState.key.replace(/^(.{8}).*(.{4})$/, "$1-****-****-$2"));
                _el$45.$$click = () => navigator.clipboard.writeText(layoutStore.licenseState.key);
                return _el$39;
              })(), createComponent(Show, {
                get when() {
                  return layoutStore.licenseState?.expiresAt;
                },
                get children() {
                  var _el$46 = _tmpl$11$1(), _el$47 = _el$46.firstChild, _el$48 = _el$47.nextSibling;
                  insert(_el$48, () => formatDate(layoutStore.licenseState.expiresAt));
                  return _el$46;
                }
              })];
            }
          }), null);
          insert(_el$35, createComponent(Show, {
            get when() {
              return !layoutStore.isPremium;
            },
            get children() {
              var _el$49 = _tmpl$12$1(), _el$50 = _el$49.firstChild, _el$51 = _el$50.nextSibling;
              _el$51.$$click = () => {
                props.onClose();
                setLayoutStore("paywallReason", "workspace");
                setLayoutStore("showPaywall", true);
              };
              return _el$49;
            }
          }), null);
          return _el$27;
        }
      }), null);
      insert(_el$26, createComponent(Show, {
        get when() {
          return activeTab() === "workspaces";
        },
        get children() {
          var _el$52 = _tmpl$14$1(), _el$53 = _el$52.firstChild, _el$54 = _el$53.nextSibling;
          insert(_el$54, createComponent(For, {
            get each() {
              return ws.workspaces();
            },
            children: (workspace) => (() => {
              var _el$68 = _tmpl$23(), _el$69 = _el$68.firstChild, _el$70 = _el$69.firstChild, _el$71 = _el$70.nextSibling, _el$72 = _el$69.nextSibling;
              _el$72.firstChild;
              insert(_el$70, () => getSmartIcon(workspace.name, {
                size: 16,
                strokeWidth: 1.75
              }));
              insert(_el$71, () => workspace.name);
              _el$72.addEventListener("change", async (e) => {
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
                  if (refreshed) ws.setWorkspaces(refreshed);
                }
              });
              insert(_el$72, createComponent(For, {
                get each() {
                  return layoutStore.profiles.filter((p) => p.id !== "main");
                },
                children: (profile) => (() => {
                  var _el$74 = _tmpl$24();
                  insert(_el$74, () => profile.name);
                  createRenderEffect(() => _el$74.value = profile.id);
                  return _el$74;
                })()
              }), null);
              createRenderEffect(() => _el$72.value = workspace.default_profile_id || "main");
              return _el$68;
            })()
          }));
          return _el$52;
        }
      }), null);
      insert(_el$26, createComponent(Show, {
        get when() {
          return activeTab() === "profiles";
        },
        get children() {
          var _el$55 = _tmpl$17$1();
          insert(_el$55, createComponent(Show, {
            get when() {
              return memo(() => !!!isCreatingProfile())() && !editingProfileId();
            },
            get fallback() {
              return (() => {
                var _el$75 = _tmpl$25(), _el$76 = _el$75.firstChild;
                insert(_el$76, () => isCreatingProfile() ? "Create New Profile" : "Edit Profile");
                insert(_el$75, createComponent(ProfileForm, {
                  get initialData() {
                    const p = layoutStore.profiles.find((p2) => p2.id === editingProfileId());
                    if (!p) return void 0;
                    return {
                      ...p,
                      is_ephemeral: !!p.is_ephemeral,
                      proxy_server: p.proxy_server || "",
                      user_agent: p.user_agent || ""
                    };
                  },
                  onSave: handleSaveProfile,
                  onCancel: () => {
                    setIsCreatingProfile(false);
                    setEditingProfileId(null);
                  },
                  get onDelete() {
                    return editingProfileId() && editingProfileId() !== "main" ? () => {
                      handleDeleteProfile(editingProfileId());
                      setEditingProfileId(null);
                    } : void 0;
                  }
                }), null);
                insert(_el$75, createComponent(Show, {
                  get when() {
                    return editingProfileId();
                  },
                  get children() {
                    return createComponent(ProfileShortcutsManager, {
                      get profileId() {
                        return editingProfileId();
                      }
                    });
                  }
                }), null);
                return _el$75;
              })();
            },
            get children() {
              return [(() => {
                var _el$56 = _tmpl$15$1(), _el$57 = _el$56.firstChild, _el$58 = _el$57.nextSibling;
                _el$58.$$click = (e) => {
                  if (!layoutStore.isPremium && layoutStore.profiles.length >= 2) {
                    props.onClose();
                    setLayoutStore("paywallReason", "profile");
                    setLayoutStore("showPaywall", true);
                    return;
                  }
                  setIsCreatingProfile(true);
                };
                return _el$56;
              })(), (() => {
                var _el$59 = _tmpl$16$1();
                insert(_el$59, createComponent(For, {
                  get each() {
                    return layoutStore.profiles;
                  },
                  children: (profile) => (() => {
                    var _el$77 = _tmpl$29(), _el$78 = _el$77.firstChild, _el$79 = _el$78.firstChild, _el$80 = _el$79.nextSibling, _el$81 = _el$80.firstChild, _el$82 = _el$81.firstChild, _el$87 = _el$78.nextSibling;
                    insert(_el$79, () => profile.name.charAt(0).toUpperCase());
                    insert(_el$82, () => profile.name);
                    insert(_el$81, createComponent(Show, {
                      get when() {
                        return profile.is_ephemeral;
                      },
                      get children() {
                        return _tmpl$26();
                      }
                    }), null);
                    insert(_el$81, createComponent(Show, {
                      get when() {
                        return profile.id === "main";
                      },
                      get children() {
                        return _tmpl$27();
                      }
                    }), null);
                    insert(_el$80, createComponent(Show, {
                      get when() {
                        return profile.proxy_server;
                      },
                      get children() {
                        var _el$85 = _tmpl$28();
                        _el$85.firstChild;
                        insert(_el$85, () => profile.proxy_server, null);
                        return _el$85;
                      }
                    }), null);
                    _el$87.$$click = () => setEditingProfileId(profile.id);
                    createRenderEffect((_$p) => setStyleProperty(_el$79, "background-color", profile.color));
                    return _el$77;
                  })()
                }));
                return _el$59;
              })()];
            }
          }));
          return _el$55;
        }
      }), null);
      insert(_el$26, createComponent(Show, {
        get when() {
          return activeTab() === "shortcuts";
        },
        get children() {
          var _el$60 = _tmpl$18$1(), _el$61 = _el$60.firstChild, _el$62 = _el$61.firstChild, _el$63 = _el$62.nextSibling, _el$64 = _el$61.nextSibling;
          _el$63.$$click = () => {
            localStorage.removeItem("apposition_shortcuts");
            window.location.reload();
          };
          insert(_el$64, createComponent(For, {
            get each() {
              return [...new Set(activeShortcuts().map((s) => s.category || "Other"))];
            },
            children: (category) => (() => {
              var _el$88 = _tmpl$30(), _el$89 = _el$88.firstChild, _el$90 = _el$89.nextSibling;
              insert(_el$89, category);
              insert(_el$90, createComponent(For, {
                get each() {
                  return activeShortcuts().filter((s) => s.category === category);
                },
                children: (shortcut) => (() => {
                  var _el$91 = _tmpl$31(), _el$92 = _el$91.firstChild;
                  insert(_el$92, () => shortcut.label || shortcut.id);
                  insert(_el$91, createComponent(ShortcutRecorder, {
                    shortcut
                  }), null);
                  return _el$91;
                })()
              }));
              return _el$88;
            })()
          }));
          return _el$60;
        }
      }), null);
      createRenderEffect((_$p) => style(_el$21, position(), _$p));
      return _el$21;
    }
  });
}
delegateEvents(["click", "keydown", "input"]);
var _tmpl$$3 = /* @__PURE__ */ template(`<span class="text-neutral-400 mx-0.5 text-[10px] font-medium">+`), _tmpl$2$2 = /* @__PURE__ */ template(`<div class="flex items-center"><kbd class="px-1.5 py-0.5 rounded-md bg-white border border-neutral-200/80 shadow-[0_1px_2px_rgba(0,0,0,0.05),inset_0_-1px_0_rgba(0,0,0,0.02)] text-[10px] font-mono font-semibold text-neutral-700 tracking-wide">`), _tmpl$3$2 = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4 animate-in fade-in duration-200"><div class="w-full max-w-3xl max-h-[80vh] bg-white rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col scale-in-center animate-in zoom-in-95 duration-200"><div class="flex items-center justify-between px-6 py-4 border-b border-neutral-100"><h2 class="text-base font-semibold text-neutral-800">Keyboard Shortcuts</h2><button class="text-neutral-400 hover:text-neutral-800 transition-colors bg-neutral-100 hover:bg-neutral-200 p-1.5 rounded-full"><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button></div><div class="flex-1 overflow-y-auto p-6"><div class="grid grid-cols-2 gap-8">`), _tmpl$4$2 = /* @__PURE__ */ template(`<div><h3 class="text-[11px] font-bold text-neutral-400 uppercase tracking-widest mb-3 px-1"></h3><div class=space-y-1>`), _tmpl$5$2 = /* @__PURE__ */ template(`<div class="flex items-center justify-between py-1.5 px-2 hover:bg-neutral-50 rounded-lg transition-colors"><span class="text-xs font-medium text-neutral-600"></span><div class="flex items-center">`);
function CheatSheetModal() {
  const [isOpen, setIsOpen] = createSignal(false);
  const toggle = () => setIsOpen(!isOpen());
  onMount(() => {
    window.addEventListener("app:toggle-cheat-sheet", toggle);
  });
  onCleanup(() => {
    window.removeEventListener("app:toggle-cheat-sheet", toggle);
  });
  const displayKey = (s) => {
    const isMac = navigator.userAgent.toLowerCase().includes("mac");
    const parts = [];
    if (s.mod) parts.push(isMac ? "⌘" : "Ctrl");
    if (s.alt) parts.push(isMac ? "⌥" : "Alt");
    if (s.shift) parts.push(isMac ? "⇧" : "Shift");
    let keyName = s.key.toUpperCase();
    if (keyName === " ") keyName = "Space";
    if (keyName === "ARROWUP") keyName = "↑";
    if (keyName === "ARROWDOWN") keyName = "↓";
    if (keyName === "ARROWLEFT") keyName = "←";
    if (keyName === "ARROWRIGHT") keyName = "→";
    parts.push(keyName);
    return parts.map((p, i) => (() => {
      var _el$ = _tmpl$2$2(), _el$2 = _el$.firstChild;
      insert(_el$2, p);
      insert(_el$, createComponent(Show, {
        get when() {
          return i < parts.length - 1;
        },
        get children() {
          return _tmpl$$3();
        }
      }), null);
      return _el$;
    })());
  };
  return createComponent(Show, {
    get when() {
      return isOpen();
    },
    get children() {
      var _el$4 = _tmpl$3$2(), _el$5 = _el$4.firstChild, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$6.nextSibling, _el$0 = _el$9.firstChild;
      _el$4.$$click = toggle;
      _el$5.$$click = (e) => e.stopPropagation();
      _el$8.$$click = toggle;
      insert(_el$0, createComponent(For, {
        get each() {
          return [...new Set(activeShortcuts().map((s) => s.category || "Other"))];
        },
        children: (category) => (() => {
          var _el$1 = _tmpl$4$2(), _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling;
          insert(_el$10, category);
          insert(_el$11, createComponent(For, {
            get each() {
              return activeShortcuts().filter((s) => s.category === category);
            },
            children: (shortcut) => (() => {
              var _el$12 = _tmpl$5$2(), _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling;
              insert(_el$13, () => shortcut.label || shortcut.id);
              insert(_el$14, () => displayKey(shortcut));
              return _el$12;
            })()
          }));
          return _el$1;
        })()
      }));
      return _el$4;
    }
  });
}
delegateEvents(["click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[999999] flex items-center justify-center bg-neutral-900/60 p-4 animate-in fade-in duration-200"><div class="w-full max-w-sm bg-white rounded-2xl shadow-[0_24px_64px_-24px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col scale-in-center animate-in zoom-in-95 duration-200"><div class=p-6><h3 class="text-lg font-semibold text-neutral-900 mb-2"></h3><p class="text-sm text-neutral-500 leading-relaxed"></p></div><div class="bg-neutral-50/50 px-6 py-4 flex items-center justify-end gap-3 border-t border-neutral-100"><button class="text-sm font-medium text-neutral-600 hover:text-neutral-900 px-3 py-2 transition-colors"></button><button class="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors shadow-sm">`);
function ConfirmationModal(props) {
  return createComponent(Show, {
    get when() {
      return props.isOpen;
    },
    get children() {
      var _el$ = _tmpl$$2(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$5 = _el$4.nextSibling, _el$6 = _el$3.nextSibling, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling;
      insert(_el$4, () => props.title);
      insert(_el$5, () => props.description);
      addEventListener(_el$7, "click", props.onCancel, true);
      insert(_el$7, () => props.cancelText || "Cancel");
      addEventListener(_el$8, "click", props.onConfirm, true);
      insert(_el$8, () => props.confirmText || "Confirm");
      return _el$;
    }
  });
}
delegateEvents(["click"]);
var _tmpl$$1 = /* @__PURE__ */ template(`<div class="fixed inset-0 z-[99998] pointer-events-auto">`), _tmpl$2$1 = /* @__PURE__ */ template(`<svg class="animate-spin h-3.5 w-3.5"xmlns=http://www.w3.org/2000/svg fill=none viewBox="0 0 24 24"><circle class=opacity-25 cx=12 cy=12 r=10 stroke=currentColor stroke-width=4></circle><path class=opacity-75 fill=currentColor d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">`), _tmpl$3$1 = /* @__PURE__ */ template(`<span class="text-[11px] text-red-500 font-medium px-0.5">`), _tmpl$4$1 = /* @__PURE__ */ template(`<form class="flex flex-col gap-2.5 mt-2"><div class="flex flex-col gap-1.5"><div class="flex gap-2"><input type=text placeholder="Paste license key..."class="flex-1 px-3 py-1.5 text-[12px] bg-white border border-neutral-200/80 rounded-[8px] focus:outline-none focus:ring-1 focus:ring-neutral-900 focus:border-neutral-900 transition-all placeholder-neutral-400 text-neutral-800 shadow-sm"><button type=submit class="px-3.5 py-1.5 bg-neutral-900 hover:bg-black disabled:bg-neutral-200 disabled:text-neutral-400 disabled:cursor-not-allowed text-white rounded-[8px] text-[12px] font-medium transition-all shadow-sm flex items-center justify-center min-w-[70px]"></button></div></div><div class=mt-1><button type=button class="w-full py-1.5 bg-white hover:bg-neutral-50 border border-neutral-200/80 text-neutral-800 font-medium rounded-[8px] text-[12px] transition-all shadow-sm flex items-center justify-center gap-1.5"><svg xmlns=http://www.w3.org/2000/svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>View Premium Plans`), _tmpl$5$1 = /* @__PURE__ */ template(`<div class="fixed z-[99999] w-[320px] bg-white ring-1 ring-black/[0.06] border border-neutral-200/60 rounded-[16px] shadow-[0_20px_60px_-16px_rgba(0,0,0,0.15)] p-4 animate-in fade-in zoom-in-[0.98] duration-200 pointer-events-auto"><button class="absolute top-3.5 right-3.5 text-neutral-400 hover:text-neutral-700 transition-colors p-1 rounded-md hover:bg-neutral-100"><svg xmlns=http://www.w3.org/2000/svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18></line></svg></button><div class="flex flex-col gap-3"><div><div class="inline-block px-2 py-0.5 bg-neutral-100 rounded-md border border-neutral-200/60 mb-2"><span class="text-[10px] font-semibold tracking-widest text-neutral-500 uppercase">Pro Feature</span></div><h3 class="text-[14px] font-semibold text-neutral-900 leading-tight">Unlock full access</h3></div><p class="text-[12px] text-neutral-500 leading-relaxed"> Upgrade to Premium to unlock unlimited access with our <strong class="text-neutral-800 font-medium">Monthly or Lifetime</strong> plans.`), _tmpl$6$1 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-center py-4 text-center animate-in zoom-in-95 duration-200"><div class="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center text-green-500 mb-2 border border-green-200/50"><svg xmlns=http://www.w3.org/2000/svg width=20 height=20 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round><polyline points="20 6 9 17 4 12"></polyline></svg></div><p class="text-[12px] font-semibold text-green-700">Premium Activated!</p><p class="text-[11px] text-neutral-500 mt-0.5">Thank you for your support.`);
function PaywallPopover() {
  const [key, setKey] = createSignal("");
  const [loading, setLoading] = createLoadingState();
  const [error, setError] = createSignal(null);
  const [success, setSuccess] = createSignal(false);
  let popoverRef;
  function createLoadingState() {
    const [val, setVal] = createSignal(false);
    return [val, setVal];
  }
  const getReasonText = () => {
    switch (layoutStore.paywallReason) {
      case "workspace":
        return "You have reached the free limit of 1 workspace.";
      case "tab":
        return "You have reached the free limit of 3 tabs per workspace.";
      case "profile":
        return "You have reached the free limit of 2 isolated profiles.";
      default:
        return "You have reached a free tier usage limit.";
    }
  };
  const getPopoverStyle = () => {
    const anchor = layoutStore.paywallAnchor;
    if (!anchor) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)"
      };
    }
    const popoverWidth = 320;
    const popoverHeight = 180;
    let left = anchor.left + anchor.width + 16;
    if (left + popoverWidth > window.innerWidth - 20) {
      left = anchor.left - popoverWidth - 16;
    }
    let top = anchor.top + anchor.height / 2 - popoverHeight / 2;
    if (top < 20) top = 20;
    if (top + popoverHeight > window.innerHeight - 20) top = window.innerHeight - popoverHeight - 20;
    return {
      top: `${top}px`,
      left: `${left}px`
    };
  };
  const handleActivate = async (e) => {
    e.preventDefault();
    if (!key().trim()) {
      setError("Please enter a license key.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.api?.activateLicenseKey(key().trim());
      if (res && res.success) {
        setSuccess(true);
        setTimeout(() => {
          setLayoutStore("isPremium", true);
          setLayoutStore("showPaywall", false);
          setSuccess(false);
          setKey("");
        }, 1500);
      } else {
        setError(res?.error || "Invalid license key. Please check and try again.");
      }
    } catch (err) {
      setError(err.message || "An error occurred during activation.");
    } finally {
      setLoading(false);
    }
  };
  const handleBuy = () => {
    const checkoutUrl = "https://buy.polar.sh/polar_cl_oZG349Un7DYqCKRhf4bpUenuq69PtLsKuyKWX2stFns";
    window.electron?.ipcRenderer.send("window.openExternal", checkoutUrl);
  };
  const close = () => {
    setLayoutStore("showPaywall", false);
    setLayoutStore("paywallAnchor", null);
  };
  return createComponent(Show, {
    get when() {
      return layoutStore.showPaywall;
    },
    get children() {
      return createComponent(Portal, {
        get children() {
          return [(() => {
            var _el$ = _tmpl$$1();
            _el$.$$click = (e) => {
              e.stopPropagation();
              close();
            };
            return _el$;
          })(), (() => {
            var _el$2 = _tmpl$5$1(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.firstChild, _el$6 = _el$5.nextSibling, _el$7 = _el$6.firstChild;
            var _ref$ = popoverRef;
            typeof _ref$ === "function" ? use(_ref$, _el$2) : popoverRef = _el$2;
            _el$3.$$click = close;
            insert(_el$6, getReasonText, _el$7);
            insert(_el$4, createComponent(Show, {
              get when() {
                return !success();
              },
              get fallback() {
                return _tmpl$6$1();
              },
              get children() {
                var _el$8 = _tmpl$4$1(), _el$9 = _el$8.firstChild, _el$0 = _el$9.firstChild, _el$1 = _el$0.firstChild, _el$10 = _el$1.nextSibling, _el$13 = _el$9.nextSibling, _el$14 = _el$13.firstChild;
                _el$8.addEventListener("submit", handleActivate);
                _el$1.$$input = (e) => setKey(e.currentTarget.value);
                insert(_el$10, createComponent(Show, {
                  get when() {
                    return loading();
                  },
                  fallback: "Activate",
                  get children() {
                    return _tmpl$2$1();
                  }
                }));
                insert(_el$9, createComponent(Show, {
                  get when() {
                    return error();
                  },
                  get children() {
                    var _el$12 = _tmpl$3$1();
                    insert(_el$12, error);
                    return _el$12;
                  }
                }), null);
                _el$14.$$click = handleBuy;
                createRenderEffect((_p$) => {
                  var _v$ = loading(), _v$2 = loading() || !key().trim();
                  _v$ !== _p$.e && (_el$1.disabled = _p$.e = _v$);
                  _v$2 !== _p$.t && (_el$10.disabled = _p$.t = _v$2);
                  return _p$;
                }, {
                  e: void 0,
                  t: void 0
                });
                createRenderEffect(() => _el$1.value = key());
                return _el$8;
              }
            }), null);
            createRenderEffect((_$p) => style(_el$2, getPopoverStyle(), _$p));
            return _el$2;
          })()];
        }
      });
    }
  });
}
delegateEvents(["click", "input"]);
function useDragEngine(saveLayout, handleClose, getParent) {
  const [activeDragId, setActiveDragId] = createSignal(null);
  const [dragTarget, setDragTarget] = createSignal(null);
  const [dragRect, setDragRect] = createSignal({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  onMount(() => {
    const onDragStart = (e) => {
      const { id, e: pointerEvent } = e.detail;
      setActiveDragId(id);
      window.api?.viewSleep?.(id);
      const draggedElement = document.querySelector(`[data-pane-id="${id}"]`);
      if (draggedElement) {
        const r = draggedElement.getBoundingClientRect();
        setDragRect({
          width: r.width,
          height: r.height,
          offsetX: pointerEvent.clientX - r.left,
          offsetY: pointerEvent.clientY - r.top
        });
      } else {
        setDragRect({ width: 250, height: 150, offsetX: 125, offsetY: 75 });
      }
      let isTearing = false;
      let lastTearFrame = 0;
      let targetX = pointerEvent.clientX;
      let targetY = pointerEvent.clientY;
      let currentX = targetX;
      let currentY = targetY;
      let velX = 0;
      let velY = 0;
      let rAF;
      const dRect = dragRect();
      const loop = () => {
        if (!activeDragId()) return;
        velX = (velX + (targetX - currentX) * 0.15) * 0.7;
        velY = (velY + (targetY - currentY) * 0.15) * 0.7;
        currentX += velX;
        currentY += velY;
        const draggedPane = document.querySelector(`[data-target-id="pane-container-${activeDragId()}"]`);
        if (draggedPane) {
          draggedPane.style.transform = `translate3d(${currentX - dRect.offsetX}px, ${currentY - dRect.offsetY}px, 0) scale(0.95)`;
        }
        rAF = requestAnimationFrame(loop);
      };
      rAF = requestAnimationFrame(loop);
      const onPointerMove = (ev) => {
        targetX = ev.clientX;
        targetY = ev.clientY;
        const screenX = window.screenX + ev.clientX;
        const screenY = window.screenY + ev.clientY;
        const isOutside = ev.clientX < 0 || ev.clientY < 0 || ev.clientX > window.innerWidth || ev.clientY > window.innerHeight;
        if (isOutside) {
          isTearing = true;
          if (performance.now() - lastTearFrame > 16) {
            window.api?.updateTearWindow(id, screenX, screenY);
            lastTearFrame = performance.now();
          }
          setDragTarget(null);
          return;
        } else if (isTearing) {
          isTearing = false;
          window.api?.hideTearWindow(id);
        }
        let targetMatch = null;
        const tabElements = document.querySelectorAll("[data-tab-id]");
        for (let i = 0; i < tabElements.length; i++) {
          const tab = tabElements[i];
          const rect = tab.getBoundingClientRect();
          if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
            targetMatch = { id: tab.getAttribute("data-tab-id"), direction: "tab" };
            break;
          }
        }
        if (!targetMatch) {
          const activePanes = document.querySelectorAll("[data-pane-id]");
          for (let i = 0; i < activePanes.length; i++) {
            const pane = activePanes[i];
            const pid = pane.getAttribute("data-pane-id");
            if (pid === activeDragId()) continue;
            const rect = pane.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              if (ev.clientX >= rect.left && ev.clientX <= rect.right && ev.clientY >= rect.top && ev.clientY <= rect.bottom) {
                const xPct = (ev.clientX - rect.left) / rect.width;
                const yPct = (ev.clientY - rect.top) / rect.height;
                const isTopRight = yPct < xPct;
                const isTopLeft = yPct < 1 - xPct;
                let direction = "";
                if (isTopRight && isTopLeft) direction = "top";
                else if (!isTopRight && !isTopLeft) direction = "bottom";
                else if (!isTopRight && isTopLeft) direction = "left";
                else direction = "right";
                targetMatch = { id: pid, direction };
                break;
              }
            }
          }
        }
        setDragTarget(targetMatch);
      };
      const onPointerUp = () => {
        cancelAnimationFrame(rAF);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("mouseleave", onPointerUp);
        const target = dragTarget();
        const draggedId = activeDragId();
        if (draggedId) {
          window.api?.viewWake?.(draggedId);
        }
        setActiveDragId(null);
        setDragTarget(null);
        if (isTearing && draggedId) {
          window.api?.commitTearWindow(draggedId);
          handleClose(draggedId, true);
          return;
        }
        if (target && draggedId) {
          if (target.id === draggedId) return;
          if (target.direction === "tab") {
            window.api?.moveNodeToTab(draggedId, target.id);
            handleClose(draggedId, false);
            return;
          }
          if (draggedId.startsWith("new_pane_")) {
            setLayoutStore("nodes", draggedId, { type: "pane", id: draggedId, paneType: "web", title: "New Tab" });
          }
          const parentDragged = getParent(draggedId);
          if (parentDragged) {
            const siblingId = parentDragged[1] === "a" ? parentDragged[0].b : parentDragged[0].a;
            const grandParent = getParent(parentDragged[0].id);
            if (grandParent) setLayoutStore("nodes", grandParent[0].id, grandParent[1], siblingId);
            else setLayoutStore("rootId", siblingId);
            setLayoutStore("nodes", parentDragged[0].id, void 0);
          }
          const parentTarget = getParent(target.id);
          const newSplitId = `split_${Date.now()}`;
          let aId = target.id;
          let bId = draggedId;
          let splitDir = "horizontal";
          if (target.direction === "top" || target.direction === "bottom") splitDir = "vertical";
          if (target.direction === "left" || target.direction === "top") {
            aId = draggedId;
            bId = target.id;
          }
          setLayoutStore("nodes", newSplitId, { type: "split", id: newSplitId, direction: splitDir, ratio: 0.5, a: aId, b: bId });
          if (parentTarget) setLayoutStore("nodes", parentTarget[0].id, parentTarget[1], newSplitId);
          else if (layoutStore.rootId === target.id) setLayoutStore("rootId", newSplitId);
          saveLayout(true);
        }
        requestAnimationFrame(() => {
          setTimeout(() => {
            const activePanes = document.querySelectorAll("[data-pane-id]");
            activePanes.forEach((pane) => {
              const pid = pane.getAttribute("data-pane-id");
              if (pid) {
                window.dispatchEvent(
                  new CustomEvent("pane-target-mounted", { detail: pid })
                );
              }
            });
            window.dispatchEvent(new CustomEvent("app:dragend"));
          }, 30);
        });
      };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
      window.addEventListener("mouseleave", onPointerUp);
    };
    window.addEventListener("app:dragstart", onDragStart);
    onCleanup(() => window.removeEventListener("app:dragstart", onDragStart));
  });
  return { activeDragId, dragTarget };
}
function useShortcutEngine(ws, ui) {
  const handleKeyDown = (e) => {
    const target = e.target;
    const isRecordingShortcut = target?.closest?.('[data-shortcut-recorder="true"]');
    if (isRecordingShortcut) return;
    const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable || e.__isPaneInputFocused;
    const isMac = navigator.userAgent.toLowerCase().includes("mac");
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();
    if (isInput) {
      if (!e.altKey && !mod) return;
      if (mod && ["a", "c", "v", "x", "z", "y"].includes(key)) return;
      if (mod && ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)) return;
    }
    const action = matchShortcut(e, isMac);
    if (!action) return;
    const jump = (arr, currentId, dir) => {
      if (!arr.length) return null;
      const idx = arr.findIndex((x) => x.id === currentId);
      if (idx === -1) return arr[0].id;
      let nextIdx = idx + dir;
      if (nextIdx < 0) nextIdx = arr.length - 1;
      if (nextIdx >= arr.length) nextIdx = 0;
      return arr[nextIdx].id;
    };
    switch (action) {
      case "next_tab":
      case "next_tab_alt": {
        e.preventDefault();
        const nextId = jump(ws.tabs(), ws.activeTabId(), 1);
        if (nextId) ws.switchTab(nextId, "forward");
        break;
      }
      case "prev_tab":
      case "prev_tab_alt": {
        e.preventDefault();
        const prevId = jump(ws.tabs(), ws.activeTabId(), -1);
        if (prevId) ws.switchTab(prevId, "backward");
        break;
      }
      case "next_workspace": {
        e.preventDefault();
        const nextId = jump(ws.workspaces(), ws.activeWorkspace(), 1);
        if (nextId) ws.switchWorkspace(nextId, "forward");
        break;
      }
      case "prev_workspace": {
        e.preventDefault();
        const prevId = jump(ws.workspaces(), ws.activeWorkspace(), -1);
        if (prevId) ws.switchWorkspace(prevId, "backward");
        break;
      }
      case "cmd_palette":
      case "cmd_palette_mac":
        e.preventDefault();
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "k", ctrlKey: !isMac, metaKey: isMac })
        );
        break;
      case "focus_address":
      case "focus_address_alt":
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("focus-address-bar", { detail: { activePaneId: ws.activeTabId() ? window._activePaneId : null } })
        );
        break;
      case "zen_mode":
      case "zen_mode_f11":
        e.preventDefault();
        ui.setIsUiCollapsed(!ui.isUiCollapsed());
        ui.setTempShowHeader(false);
        break;
      case "escape":
        if (ui.isUiCollapsed()) {
          e.preventDefault();
          ui.setIsUiCollapsed(false);
          ui.setTempShowHeader(false);
        }
        break;
      case "split_vert":
      case "split_vert_alt":
      case "split_right":
        e.preventDefault();
        if (ws.activePaneId()) ws.handleSplit(ws.activePaneId(), "right");
        break;
      case "split_left":
        e.preventDefault();
        if (ws.activePaneId()) ws.handleSplit(ws.activePaneId(), "left");
        break;
      case "split_horiz":
      case "split_horiz_alt":
      case "split_down":
        e.preventDefault();
        if (ws.activePaneId()) ws.handleSplit(ws.activePaneId(), "bottom");
        break;
      case "split_up":
        e.preventDefault();
        if (ws.activePaneId()) ws.handleSplit(ws.activePaneId(), "top");
        break;
      case "new_tab":
        e.preventDefault();
        ws.handleCreateTab();
        break;
      case "close_tab":
        e.preventDefault();
        if (ws.activePaneId()) ws.handleClose(ws.activePaneId());
        else if (ws.activeTabId()) ws.handleClose(ws.activeTabId());
        break;
      case "new_workspace":
        e.preventDefault();
        ws.setIsCreatingWorkspace(true);
        break;
      case "reload":
      case "reload_f5":
        e.preventDefault();
        if (ws.activePaneId()) {
          const paneNode = ws.layoutStore.nodes[ws.activePaneId()];
          if (paneNode && paneNode.paneType === "web") {
            window.api?.viewReload(ws.activePaneId());
          }
        }
        break;
      case "toggle_immersion":
        e.preventDefault();
        ui.setIsUiCollapsed(!ui.isUiCollapsed());
        break;
      case "lock_grid":
        e.preventDefault();
        ws.setLayoutStore("isGridLocked", !ws.layoutStore.isGridLocked);
        break;
      case "find_in_page":
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:find-in-page", { detail: { paneId: ws.activePaneId() } }));
        break;
      case "mute_pane":
        e.preventDefault();
        if (ws.activePaneId()) window.api?.viewToggleMute?.(ws.activePaneId());
        break;
      case "zoom_in":
        e.preventDefault();
        if (ws.activePaneId()) window.api?.viewZoomIn?.(ws.activePaneId());
        break;
      case "zoom_out":
        e.preventDefault();
        if (ws.activePaneId()) window.api?.viewZoomOut?.(ws.activePaneId());
        break;
      case "zoom_reset":
        e.preventDefault();
        if (ws.activePaneId()) window.api?.viewZoomReset?.(ws.activePaneId());
        break;
      case "cheat_sheet":
      case "cheat_sheet_alt":
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:toggle-cheat-sheet"));
        break;
      case "reopen_tab":
        e.preventDefault();
        if (ws.reopenClosedTab) ws.reopenClosedTab();
        break;
      case "pin_tab":
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("app:toggle-pin-tab", { detail: { tabId: ws.activeTabId() } }));
        break;
      // Spatial Pane Navigation (Delegated to WorkspaceManager or LayoutStore)
      case "focus_pane_up":
      case "focus_pane_down":
      case "focus_pane_left":
      case "focus_pane_right":
        e.preventDefault();
        if (ws.navigatePaneFocus) ws.navigatePaneFocus(action.split("_")[2]);
        break;
      case "swap_pane_up":
      case "swap_pane_down":
      case "swap_pane_left":
      case "swap_pane_right":
        e.preventDefault();
        if (ws.swapPaneNode) ws.swapPaneNode(action.split("_")[2]);
        break;
    }
    if (action.startsWith("jump_workspace_")) {
      e.preventDefault();
      const num = parseInt(action.split("_")[2]);
      const wss = ws.workspaces();
      if (num === 9) {
        ws.switchWorkspace(wss[wss.length - 1].id, "forward");
      } else if (num > 0 && num <= wss.length) {
        ws.switchWorkspace(wss[num - 1].id, "forward");
      }
    } else if (action.startsWith("jump_tab_")) {
      e.preventDefault();
      const num = parseInt(action.split("_")[2]);
      const tabs = ws.tabs();
      if (num === 9) {
        ws.switchTab(tabs[tabs.length - 1].id, "forward");
      } else if (num > 0 && num <= tabs.length) {
        ws.switchTab(tabs[num - 1].id, "forward");
      }
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  const unsubscribe = window.api?.onForwardedKey?.((e, keyEvent) => {
    const event = new KeyboardEvent("keydown", {
      key: keyEvent.key,
      code: keyEvent.code,
      ctrlKey: keyEvent.control,
      metaKey: keyEvent.meta,
      shiftKey: keyEvent.shift,
      altKey: keyEvent.alt,
      bubbles: true
    });
    event.__isPaneInputFocused = keyEvent.isInputFocused;
    window.dispatchEvent(event);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    if (unsubscribe) unsubscribe();
  });
}
const logo = "" + new URL("logo-yHKUUx0t.svg", import.meta.url).href;
var _tmpl$ = /* @__PURE__ */ template(`<div class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-100 group-hover:opacity-0"><img class="w-[14px] h-[14px] object-contain">`), _tmpl$2 = /* @__PURE__ */ template(`<div class="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-0 group-hover:opacity-100"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect width=18 height=18 x=3 y=3 rx=2></rect><path d="M9 3v18">`), _tmpl$3 = /* @__PURE__ */ template(`<div class="absolute inset-0 flex items-center justify-center"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><rect width=18 height=18 x=3 y=3 rx=2></rect><path d="M9 3v18"></path><path d="m16 15-3-3 3-3">`), _tmpl$4 = /* @__PURE__ */ template(`<div id=topbar class="absolute top-3 z-[60] h-[40px] pointer-events-auto flex items-center bg-white border border-neutral-200/60 rounded-2xl shadow-md overflow-hidden left-3 max-w-0 opacity-0"><div class="h-full flex items-center min-w-0 w-max px-1"style=-webkit-app-region:drag>`), _tmpl$5 = /* @__PURE__ */ template(`<div id=workspace-dock class="absolute left-3 z-[60] w-[40px] pointer-events-auto flex flex-col items-center bg-white border border-neutral-200/60 rounded-2xl shadow-md overflow-hidden top-3 max-h-0 opacity-0"><div class="w-full py-1 flex flex-col items-center shrink-0 h-full">`), _tmpl$6 = /* @__PURE__ */ template(`<div id=window-controls class="absolute top-3 right-3 z-[70] flex items-center gap-1.5 pointer-events-auto bg-white border border-neutral-200/60 p-1.5 rounded-2xl shadow-md ring-1 ring-black/[0.02]"style=-webkit-app-region:no-drag><button class="w-[24px] h-[24px] rounded-md hover:bg-white flex items-center justify-center text-neutral-600 transition-colors"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><path d="M5 12h14"></path></svg></button><button class="w-[24px] h-[24px] rounded-md hover:bg-white flex items-center justify-center text-neutral-600 transition-colors"><svg width=10 height=10 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><rect x=3 y=3 width=18 height=18 rx=2 ry=2></rect></svg></button><button class="w-[24px] h-[24px] rounded-md hover:bg-red-500 hover:text-white flex items-center justify-center text-neutral-600 transition-colors"><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round><path d="M18 6 6 18M6 6l12 12">`), _tmpl$7 = /* @__PURE__ */ template(`<div class="absolute left-0 top-0 bottom-0 w-3 z-[100]">`), _tmpl$8 = /* @__PURE__ */ template(`<div class="absolute left-0 top-0 right-0 h-3 z-[100]">`), _tmpl$9 = /* @__PURE__ */ template(`<div class="absolute right-0 top-0 bottom-0 w-3 z-[100]">`), _tmpl$0 = /* @__PURE__ */ template(`<div class="absolute left-0 bottom-0 right-0 h-3 z-[100]">`), _tmpl$1 = /* @__PURE__ */ template(`<div class="absolute left-0 top-0 w-8 h-8 z-[110]">`), _tmpl$10 = /* @__PURE__ */ template(`<div class="absolute right-0 top-0 w-8 h-8 z-[110]">`), _tmpl$11 = /* @__PURE__ */ template(`<div class="absolute left-0 bottom-0 w-8 h-8 z-[110]">`), _tmpl$12 = /* @__PURE__ */ template(`<div class="absolute right-0 bottom-0 w-8 h-8 z-[110]">`), _tmpl$13 = /* @__PURE__ */ template(`<div class="absolute bottom-3 left-3 z-[70] pointer-events-auto"style=-webkit-app-region:no-drag><div class="relative group/settings"><button title=Settings aria-label=Settings class="flex items-center justify-center w-[40px] h-[40px] rounded-2xl bg-white border border-neutral-200/60 shadow-md transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 active:scale-[0.92]"><svg width=18 height=18 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round class="transition-transform duration-500 group-hover/settings:rotate-45"><circle cx=12 cy=12 r=3></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button><div class="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[70] pointer-events-none opacity-0 group-hover/settings:opacity-100 transition-opacity"><div class="bg-neutral-900 text-white text-[11px] font-medium tracking-tight px-2.5 py-1 rounded-lg shadow-[0_8px_24px_-8px_rgba(0,0,0,0.4)] whitespace-nowrap">Settings`), _tmpl$14 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round class=text-green-500><polyline points="20 6 9 17 4 12">`), _tmpl$15 = /* @__PURE__ */ template(`<svg xmlns=http://www.w3.org/2000/svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round class=text-red-500><circle cx=12 cy=12 r=10></circle><line x1=12 y1=8 x2=12 y2=12></line><line x1=12 y1=16 x2=12.01 y2=16>`), _tmpl$16 = /* @__PURE__ */ template(`<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[20000] px-4 py-2.5 bg-white text-neutral-800 text-[13px] font-medium rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-neutral-200/60 flex items-center gap-2 animate-in slide-in-from-bottom-4 fade-in duration-300">`), _tmpl$17 = /* @__PURE__ */ template(`<div class="absolute inset-0 bg-transparent text-neutral-800 flex flex-row font-sans overflow-hidden select-none w-full h-full"><div id=ui-hub><button class="group relative w-[24px] h-[24px] rounded-md hover:bg-neutral-100 flex items-center justify-center text-neutral-600 transition-colors active:scale-95"style=-webkit-app-region:no-drag></button></div><div id=canvas-container class="flex-1 flex flex-col min-w-0 relative h-full transition-colors duration-300 z-0 bg-transparent"style=padding-top:0px;padding-left:0px;padding-right:0px;padding-bottom:0px><div id=main-canvas><div class="absolute inset-0 z-0 pointer-events-none rounded-xl overflow-hidden bg-transparent"></div><div class="absolute inset-0 z-10 pointer-events-none rounded-xl overflow-hidden">`), _tmpl$18 = /* @__PURE__ */ template(`<div class="w-full h-full bg-white flex flex-col items-center justify-center p-8 text-center pointer-events-auto"><div class="text-red-500 mb-4"><svg width=48 height=48 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2><circle cx=12 cy=12 r=10></circle><line x1=12 y1=8 x2=12 y2=12></line><line x1=12 y1=16 x2=12.01 y2=16></line></svg></div><h2 class="text-xl font-semibold text-neutral-800 mb-2">Workspace Layout Crashed</h2><p class="text-neutral-500 mb-6 text-sm max-w-md"></p><button class="px-4 py-2 bg-neutral-900 text-white rounded-lg text-sm font-medium hover:bg-neutral-800 transition-colors">Reload Workspace`);
function App() {
  const ws = useWorkspaceManager();
  const drag = useDragEngine(ws.saveLayout, ws.handleClose, ws.getParent);
  const [isUiCollapsed, setIsUiCollapsed] = createSignal(false);
  const [hoverZone, setHoverZone] = createSignal("none");
  const [tempShowHeader, setTempShowHeader] = createSignal(false);
  const [cascadePrompt, setCascadePrompt] = createSignal(null);
  const [toast, setToast] = createSignal(null);
  onMount(async () => {
    const loadInitialData = async () => {
      try {
        const storedProfiles = await window.api.getProfiles();
        setLayoutStore("profiles", storedProfiles || []);
        const isPremium = await window.api.checkPremiumStatus();
        setLayoutStore("isPremium", isPremium);
        const licenseState = await window.api.getLicenseState();
        if (licenseState) {
          setLayoutStore("licenseState", licenseState);
        }
      } catch (err) {
        console.error("Failed to load initial data", err);
      }
    };
    loadInitialData();
  });
  if (window.IS_WEB_DEMO) {
    window.demoController = {
      fastSwitchWorkspace: (id) => {
        ws.switchWorkspace(id, "forward");
      },
      demoSwitchTo: (wsId, tabId, mockTabs) => {
        ws.demoSwitchTo(wsId, tabId, mockTabs);
      },
      demoTransitionTo: (wsId, tabId, mockTabs, direction) => {
        ws.demoTransitionTo(wsId, tabId, mockTabs, direction);
      },
      setRatio: (splitId, ratio) => {
        ws.handleRatioChange(splitId, ratio);
      },
      switchWorkspace: (id, direction = "forward") => {
        ws.switchWorkspace(id, direction);
      },
      switchTab: (id, direction = "forward") => {
        ws.switchTab(id, direction);
      },
      setTabs: (tabs) => {
        ws.setTabs(tabs);
      },
      setActiveTabId: (id) => {
        ws.setActiveTabId(id);
      },
      loadNodesForTab: (id, tabs) => {
        ws.loadNodesForTab(id, tabs);
      }
    };
  }
  let hubRef;
  let topbarRef;
  let dockRef;
  let canvasContainerRef;
  let justCollapsed = false;
  let hideTimer;
  const handleZoneEnter = (zone) => {
    if (hoverZone() !== zone) setHoverZone(zone);
  };
  const handleZoneLeave = () => {
    if (hoverZone() !== "none") setHoverZone("none");
  };
  onMount(() => {
    let mouseX = -1;
    let mouseY = -1;
    let appWidth = window.innerWidth;
    let appHeight = window.innerHeight;
    let ticking = false;
    const checkProximity = () => {
      ticking = false;
      const x = mouseX;
      const y = mouseY;
      if (x < 0 || y < 0 || x > appWidth || y > appHeight) {
        handleZoneLeave();
        return;
      }
      const current = hoverZone();
      if (current === "none") return;
      const padding = 100;
      if (current === "topLeft") {
        const inTopbar = x <= 812 + padding && y <= 52 + padding;
        const inDock = x <= 52 + padding && y <= appHeight - 60 + padding;
        if (!inTopbar && !inDock) handleZoneLeave();
      } else if (current === "topRight") {
        const inBtn = x >= appWidth - 52 - padding && y <= 52 + padding;
        if (!inBtn) handleZoneLeave();
      } else if (current === "bottomLeft") {
        const inBtn = x <= 52 + padding && y >= appHeight - 52 - padding;
        if (!inBtn) handleZoneLeave();
      }
    };
    const handleMouseMove = (e) => {
      let relX = e.clientX;
      let relY = e.clientY;
      if (canvasContainerRef && canvasContainerRef.parentElement) {
        const rect = canvasContainerRef.parentElement.getBoundingClientRect();
        const logicalWidth = canvasContainerRef.parentElement.offsetWidth || rect.width;
        const logicalHeight = canvasContainerRef.parentElement.offsetHeight || rect.height;
        const scaleX = rect.width / logicalWidth;
        const scaleY = rect.height / logicalHeight;
        relX = (e.clientX - rect.left) / scaleX;
        relY = (e.clientY - rect.top) / scaleY;
        appWidth = logicalWidth;
        appHeight = logicalHeight;
      }
      mouseX = relX;
      mouseY = relY;
      if (!ticking) {
        requestAnimationFrame(checkProximity);
        ticking = true;
      }
    };
    window.addEventListener("mousemove", handleMouseMove, {
      passive: true
    });
    onCleanup(() => window.removeEventListener("mousemove", handleMouseMove));
  });
  useShortcutEngine({
    ...ws,
    layoutStore,
    setLayoutStore
  }, {
    isUiCollapsed,
    setIsUiCollapsed,
    setTempShowHeader
  });
  onMount(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        const profile = layoutStore.profiles[index];
        if (profile) {
          e.preventDefault();
          const paneId = ws.activePaneId();
          if (paneId) {
            ws.handleUpdatePane(paneId, {
              profileId: profile.id
            });
          }
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        const paneId = ws.activePaneId();
        if (paneId) {
          window.api?.viewReload?.(paneId);
        }
      }
      if (e.altKey && e.key.toLowerCase() === "z") {
        setIsUiCollapsed(!isUiCollapsed());
        setTempShowHeader(false);
      }
      if (e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        if (layoutStore.maximizedPaneId) {
          setLayoutStore("maximizedPaneId", null);
        } else {
          const activeId = ws.activePaneId();
          if (activeId) setLayoutStore("maximizedPaneId", activeId);
        }
      }
      if (e.key === "Escape" && layoutStore.maximizedPaneId) {
        setLayoutStore("maximizedPaneId", null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.api?.onPaneFocused?.((e, paneId) => {
      if (ws.activePaneId() !== paneId) {
        ws.setActivePaneId(paneId);
      }
      window.dispatchEvent(new CustomEvent("app:pane-clicked", {
        detail: paneId
      }));
    });
    window.api?.onViewNavigated((e, data) => {
      setLayoutStore("nodes", data.paneId, (node) => {
        let history = node.history ? [...node.history] : [];
        let historyIndex = node.historyIndex !== void 0 ? node.historyIndex : -1;
        if (data.url === node.url) {
          return {
            url: data.url,
            title: data.title,
            canGoBack: data.canGoBack,
            canGoForward: data.canGoForward,
            history,
            historyIndex
          };
        }
        if (historyIndex > 0 && data.url === history[historyIndex - 1]) {
          historyIndex -= 1;
        } else if (historyIndex < history.length - 1 && data.url === history[historyIndex + 1]) {
          historyIndex += 1;
        } else {
          history = history.slice(0, historyIndex + 1);
          history.push(data.url);
          if (history.length > 50) history.shift();
          historyIndex = history.length - 1;
        }
        return {
          url: data.url,
          title: data.title,
          canGoBack: data.canGoBack,
          canGoForward: data.canGoForward,
          history,
          historyIndex
        };
      });
      window.dispatchEvent(new CustomEvent("pane.navigated", {
        detail: data.paneId
      }));
      ws.saveLayout(false);
    });
    window.api?.onViewLoaded?.((e, paneId) => {
      window.dispatchEvent(new CustomEvent("pane.loaded", {
        detail: paneId
      }));
    });
    window.api?.onWorkspaceDeepLink?.((e, workspaceId) => {
      if (ws.workspaces().find((w) => w.id === workspaceId)) {
        ws.switchWorkspace(workspaceId, "forward");
      }
    });
    window.api?.onPaneContextMenu?.((e, data) => {
      window.dispatchEvent(new CustomEvent("app:pane-context-menu", {
        detail: data
      }));
    });
    const handleCascadePrompt = (e) => {
      setCascadePrompt(e.detail);
    };
    window.addEventListener("app:prompt-cascade-profile", handleCascadePrompt);
    let toastTimer;
    const handleToast = (e) => {
      setToast(e.detail);
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(null), 3e3);
    };
    window.api?.onToast?.((e, detail) => {
      handleToast(new CustomEvent("app:toast", {
        detail
      }));
    });
    onCleanup(() => {
      window.removeEventListener("app:prompt-cascade-profile", handleCascadePrompt);
    });
  });
  function useWheelGestures(switchWorkspace, switchTab, workspaces, tabs, activeWorkspace, activeTabId) {
    let accumY = 0;
    let accumX = 0;
    const THRESHOLD = 120;
    const COOLDOWN = 600;
    let lastSwitchTime = 0;
    const onWheel = (e) => {
      if (!e.altKey && !e.metaKey) return;
      const now = performance.now();
      if (now - lastSwitchTime < COOLDOWN) return;
      const {
        deltaX,
        deltaY
      } = e;
      if (Math.abs(deltaX) > Math.abs(deltaY) || e.shiftKey) {
        accumX += deltaX;
        accumY = 0;
        if (accumX > THRESHOLD) {
          accumX = 0;
          const ts = tabs();
          const idx = ts.findIndex((t) => t.id === activeTabId());
          if (idx < ts.length - 1) {
            lastSwitchTime = now;
            switchTab(ts[idx + 1].id, "forward");
          }
        } else if (accumX < -THRESHOLD) {
          accumX = 0;
          const ts = tabs();
          const idx = ts.findIndex((t) => t.id === activeTabId());
          if (idx > 0) {
            lastSwitchTime = now;
            switchTab(ts[idx - 1].id, "backward");
          }
        }
        return;
      }
      accumY += deltaY;
      accumX = 0;
      if (accumY > THRESHOLD) {
        accumY = 0;
        const ws2 = workspaces();
        const idx = ws2.findIndex((w) => w.id === activeWorkspace());
        if (idx < ws2.length - 1) {
          lastSwitchTime = now;
          switchWorkspace(ws2[idx + 1].id, "forward");
        }
      } else if (accumY < -THRESHOLD) {
        accumY = 0;
        const ws2 = workspaces();
        const idx = ws2.findIndex((w) => w.id === activeWorkspace());
        if (idx > 0) {
          lastSwitchTime = now;
          switchWorkspace(ws2[idx - 1].id, "backward");
        }
      }
    };
    return onWheel;
  }
  onMount(() => {
    const onWheel = useWheelGestures(ws.switchWorkspace, ws.switchTab, ws.workspaces, ws.tabs, ws.activeWorkspace, ws.activeTabId);
    window.addEventListener("wheel", onWheel, {
      passive: true
    });
    onCleanup(() => window.removeEventListener("wheel", onWheel));
  });
  onMount(() => {
    let ignoreMouseEvents = false;
    let frameId;
    let lastX = window.innerWidth / 2;
    let lastY = window.innerHeight / 2;
    const checkHoleAt = (x, y) => {
      if (drag.activeDragId()) {
        if (ignoreMouseEvents) {
          ignoreMouseEvents = false;
          window.api?.setIgnoreMouseEvents(false);
        }
        return;
      }
      const target = document.elementFromPoint(x, y);
      const isHole = !!target?.closest?.('[id^="webview-container-"]');
      if (isUiCollapsed()) {
        const isOverUiHeader = target?.closest("#ui-hub") || target?.closest("#topbar") || target?.closest("#workspace-dock");
        if (isOverUiHeader && !isHole) {
          if (justCollapsed) return;
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
          setTempShowHeader(true);
        } else {
          justCollapsed = false;
          if (tempShowHeader() && !hideTimer) {
            hideTimer = setTimeout(() => {
              setTempShowHeader(false);
              hideTimer = null;
            }, 300);
          }
        }
      }
      if (isHole && !ignoreMouseEvents) {
        ignoreMouseEvents = true;
        window.api?.setIgnoreMouseEvents(true, {
          forward: true
        });
      } else if (!isHole && ignoreMouseEvents) {
        ignoreMouseEvents = false;
        window.api?.setIgnoreMouseEvents(false);
      }
    };
    const handleMouseMove = (e) => {
      lastX = e.clientX;
      lastY = e.clientY;
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => checkHoleAt(lastX, lastY));
    };
    const handleDragEnd = () => {
      requestAnimationFrame(() => {
        checkHoleAt(lastX, lastY);
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("pointerup", handleDragEnd);
    window.addEventListener("app:dragend", handleDragEnd);
    onCleanup(() => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("pointerup", handleDragEnd);
      window.removeEventListener("app:dragend", handleDragEnd);
      cancelAnimationFrame(frameId);
    });
  });
  createEffect(() => {
    const collapsed = isUiCollapsed();
    const zone = hoverZone();
    if (hubRef) {
      gsapWithCSS.to(hubRef, {
        top: 12,
        left: 12,
        borderRadius: 16,
        duration: 0.5,
        ease: "power4.out",
        overwrite: "auto"
      });
    }
    if (topbarRef) {
      if (collapsed) {
        gsapWithCSS.to(topbarRef, {
          left: 12,
          maxWidth: 0,
          autoAlpha: 0,
          duration: 0.4,
          ease: "power3.out",
          overwrite: "auto"
        });
      } else {
        gsapWithCSS.to(topbarRef, {
          left: 60,
          maxWidth: 800,
          autoAlpha: 1,
          duration: 0.5,
          ease: "power4.out",
          overwrite: "auto"
        });
      }
    }
    if (dockRef) {
      const containerH = document.getElementById("canvas-container")?.clientHeight || window.innerHeight;
      if (collapsed) {
        gsapWithCSS.to(dockRef, {
          top: 12,
          maxHeight: 0,
          autoAlpha: 0,
          duration: 0.4,
          ease: "power3.out",
          overwrite: "auto"
        });
      } else {
        gsapWithCSS.to(dockRef, {
          top: 60,
          maxHeight: containerH - 120,
          autoAlpha: 1,
          duration: 0.5,
          ease: "power4.out",
          overwrite: "auto"
        });
      }
    }
    if (canvasContainerRef) {
      const isMaximized = !!layoutStore.maximizedPaneId;
      const pt = !isMaximized && (zone === "topLeft" || zone === "topRight") ? 60 : 0;
      const pl = !isMaximized && (zone === "topLeft" || zone === "bottomLeft") ? 60 : 0;
      const pb = 0;
      gsapWithCSS.to(canvasContainerRef, {
        paddingTop: pt,
        paddingLeft: pl,
        paddingBottom: pb,
        duration: 0.5,
        ease: "power4.out",
        overwrite: "auto"
      });
    }
  });
  return (() => {
    var _el$ = _tmpl$17(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$25 = _el$2.nextSibling, _el$26 = _el$25.firstChild, _el$27 = _el$26.firstChild, _el$28 = _el$27.nextSibling;
    _el$2.addEventListener("mouseenter", () => handleZoneEnter("topLeft"));
    var _ref$ = hubRef;
    typeof _ref$ === "function" ? use(_ref$, _el$2) : hubRef = _el$2;
    _el$3.$$click = () => {
      justCollapsed = true;
      setIsUiCollapsed(!isUiCollapsed());
    };
    insert(_el$3, createComponent(Show, {
      get when() {
        return isUiCollapsed();
      },
      get children() {
        return [(() => {
          var _el$4 = _tmpl$(), _el$5 = _el$4.firstChild;
          setAttribute(_el$5, "src", logo);
          return _el$4;
        })(), _tmpl$2()];
      }
    }), null);
    insert(_el$3, createComponent(Show, {
      get when() {
        return !isUiCollapsed();
      },
      get children() {
        return _tmpl$3();
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return !layoutStore.maximizedPaneId;
      },
      get children() {
        var _el$8 = _tmpl$4(), _el$9 = _el$8.firstChild;
        _el$8.addEventListener("mouseenter", () => handleZoneEnter("topLeft"));
        var _ref$2 = topbarRef;
        typeof _ref$2 === "function" ? use(_ref$2, _el$8) : topbarRef = _el$8;
        insert(_el$9, createComponent(TabIsland, {
          get tabs() {
            return ws.tabs();
          },
          get activeTabId() {
            return ws.activeTabId();
          },
          get activeWorkspaceName() {
            return ws.workspaces().find((w) => w.id === ws.activeWorkspace())?.name || "";
          },
          get activePaneId() {
            return ws.activePaneId();
          },
          get onTabSelect() {
            return ws.switchTab;
          },
          get onCreateTab() {
            return ws.handleCreateTab;
          },
          onTabRename: (id, name) => ws.setTabs(ws.tabs().map((t) => t.id === id ? {
            ...t,
            name
          } : t))
        }));
        return _el$8;
      }
    }), _el$25);
    insert(_el$, createComponent(Show, {
      get when() {
        return !layoutStore.maximizedPaneId;
      },
      get children() {
        var _el$0 = _tmpl$5(), _el$1 = _el$0.firstChild;
        _el$0.addEventListener("mouseenter", () => handleZoneEnter("topLeft"));
        var _ref$3 = dockRef;
        typeof _ref$3 === "function" ? use(_ref$3, _el$0) : dockRef = _el$0;
        insert(_el$1, createComponent(WorkspaceDock, {
          get workspaces() {
            return ws.workspaces();
          },
          get activeWorkspace() {
            return ws.activeWorkspace();
          },
          get isCreatingWorkspace() {
            return ws.isCreatingWorkspace();
          },
          setIsCreatingWorkspace: (isCreating, rect) => {
            if (isCreating && !layoutStore.isPremium && ws.workspaces().length >= 1) {
              if (rect) setLayoutStore("paywallAnchor", {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height
              });
              setLayoutStore("paywallReason", "workspace");
              setLayoutStore("showPaywall", true);
              return;
            }
            ws.setIsCreatingWorkspace(isCreating);
          },
          get onWorkspaceSelect() {
            return ws.switchWorkspace;
          },
          onCreateWorkspace: (name) => {
            const id = `ws_${Date.now()}`;
            window.api?.createWorkspace(id, name).then(() => {
              ws.setWorkspaces([...ws.workspaces(), {
                id,
                name
              }]);
              ws.setActiveWorkspace(id);
              ws.saveLayout(true);
              window.api?.getTabs(id).then((t) => {
                ws.setTabs(t || []);
                if (t && t.length > 0) {
                  ws.setActiveTabId(t[0].id);
                  ws.loadNodesForTab(t[0].id, t);
                }
              });
              ws.setIsCreatingWorkspace(false);
            }).catch((e) => {
              console.error("Failed to create workspace:", e);
              ws.setIsCreatingWorkspace(false);
            });
          },
          onWorkspaceRename: (id, name) => ws.setWorkspaces(ws.workspaces().map((w) => w.id === id ? {
            ...w,
            name
          } : w)),
          onOpenSettings: (e) => {
            const target = e.currentTarget;
            const rect = target.getBoundingClientRect();
            setLayoutStore("settingsAnchor", {
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            });
            setLayoutStore("showSettings", !layoutStore.showSettings);
          }
        }));
        return _el$0;
      }
    }), _el$25);
    insert(_el$, createComponent(Show, {
      get when() {
        return !layoutStore.maximizedPaneId;
      },
      get children() {
        var _el$10 = _tmpl$6(), _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling, _el$13 = _el$12.nextSibling;
        _el$10.addEventListener("mouseenter", () => handleZoneEnter("topRight"));
        _el$11.$$click = () => window.api?.minimizeWindow();
        _el$12.$$click = () => window.api?.maximizeWindow();
        _el$13.$$click = () => window.api?.closeWindow();
        return _el$10;
      }
    }), _el$25);
    insert(_el$, createComponent(Show, {
      get when() {
        return memo(() => !!!layoutStore.maximizedPaneId)() && isUiCollapsed();
      },
      get children() {
        return [(() => {
          var _el$14 = _tmpl$7();
          _el$14.addEventListener("mouseenter", () => handleZoneEnter("left"));
          return _el$14;
        })(), (() => {
          var _el$15 = _tmpl$8();
          _el$15.addEventListener("mouseenter", () => handleZoneEnter("top"));
          return _el$15;
        })(), (() => {
          var _el$16 = _tmpl$9();
          _el$16.addEventListener("mouseenter", () => handleZoneEnter("right"));
          return _el$16;
        })(), (() => {
          var _el$17 = _tmpl$0();
          _el$17.addEventListener("mouseenter", () => handleZoneEnter("bottom"));
          return _el$17;
        })(), (() => {
          var _el$18 = _tmpl$1();
          _el$18.addEventListener("mouseenter", () => handleZoneEnter("topLeft"));
          return _el$18;
        })(), (() => {
          var _el$19 = _tmpl$10();
          _el$19.addEventListener("mouseenter", () => handleZoneEnter("topRight"));
          return _el$19;
        })(), (() => {
          var _el$20 = _tmpl$11();
          _el$20.addEventListener("mouseenter", () => handleZoneEnter("bottomLeft"));
          return _el$20;
        })(), (() => {
          var _el$21 = _tmpl$12();
          _el$21.addEventListener("mouseenter", () => handleZoneEnter("bottomRight"));
          return _el$21;
        })()];
      }
    }), _el$25);
    insert(_el$, createComponent(Show, {
      get when() {
        return !layoutStore.maximizedPaneId;
      },
      get children() {
        var _el$22 = _tmpl$13(), _el$23 = _el$22.firstChild, _el$24 = _el$23.firstChild;
        _el$22.addEventListener("mouseenter", () => handleZoneEnter("bottomLeft"));
        _el$24.$$click = (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setLayoutStore("settingsAnchor", {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          });
          setLayoutStore("showSettings", !layoutStore.showSettings);
        };
        return _el$22;
      }
    }), _el$25);
    var _ref$4 = canvasContainerRef;
    typeof _ref$4 === "function" ? use(_ref$4, _el$25) : canvasContainerRef = _el$25;
    insert(_el$26, createComponent(CommandPalette, {}), _el$27);
    insert(_el$27, createComponent(For, {
      get each() {
        return Object.values(layoutStore.nodes).filter((n) => {
          if (!n || n.type !== "pane") return false;
          const checkInTree = (id, targetPaneId) => {
            const node = layoutStore.nodes[id];
            if (!node) return false;
            if (node.id === targetPaneId) return true;
            if (node.type === "split") {
              return checkInTree(node.a, targetPaneId) || checkInTree(node.b, targetPaneId);
            }
            return false;
          };
          return checkInTree(layoutStore.rootId, n.id);
        }).sort((a, b) => a.id.localeCompare(b.id));
      },
      children: (pane) => createComponent(AbsolutePane, {
        get targetId() {
          return `pane-container-${pane.id}`;
        },
        get paneId() {
          return pane.id;
        },
        get isDragging() {
          return drag.activeDragId() === pane.id;
        },
        get isGlobalDragging() {
          return !!drag.activeDragId();
        },
        isActive: true,
        get children() {
          return createComponent(Pane, {
            get id() {
              return pane.id;
            },
            get url() {
              return pane.url;
            },
            get paneType() {
              return pane.paneType;
            },
            get title() {
              return memo(() => pane.paneType === "terminal")() ? "Terminal" : pane.url || "New Tab";
            },
            get isActivePane() {
              return ws.activePaneId() === pane.id;
            },
            get profileId() {
              return pane.profileId || ws.workspaces().find((w) => w.id === ws.activeWorkspace())?.default_profile_id || "main";
            },
            onClose: () => ws.handleClose(pane.id),
            onUpdate: (data) => ws.handleUpdatePane(pane.id, data),
            onActive: () => ws.setActivePaneId(pane.id),
            onApplyTemplate: (template2) => ws.applyLayoutTemplate(pane.id, template2),
            get activeWorkspaceName() {
              return ws.workspaces().find((w) => w.id === ws.activeWorkspace())?.name || "";
            },
            get children() {
              return pane.component;
            }
          });
        }
      })
    }));
    insert(_el$28, createComponent(ErrorBoundary, {
      fallback: (err, reset) => (() => {
        var _el$32 = _tmpl$18(), _el$33 = _el$32.firstChild, _el$34 = _el$33.nextSibling, _el$35 = _el$34.nextSibling, _el$36 = _el$35.nextSibling;
        insert(_el$35, () => err.toString());
        addEventListener(_el$36, "click", reset, true);
        return _el$32;
      })(),
      get children() {
        return createComponent(Show, {
          get when() {
            return layoutStore.rootId;
          },
          get children() {
            return createComponent(LayoutNode, {
              get nodeId() {
                return layoutStore.rootId;
              },
              get activePaneId() {
                return ws.activePaneId();
              },
              get onActivePaneChange() {
                return ws.setActivePaneId;
              },
              get onSplit() {
                return ws.handleSplit;
              },
              get onClose() {
                return ws.handleClose;
              },
              get onRatioChange() {
                return ws.handleRatioChange;
              },
              get isOnlyPane() {
                return Object.values(layoutStore.nodes).filter((n) => n && n.type === "pane").length <= 1;
              },
              get dragTarget() {
                return drag.dragTarget();
              },
              get activeDragId() {
                return drag.activeDragId();
              },
              get onUpdatePane() {
                return ws.handleUpdatePane;
              }
            });
          }
        });
      }
    }));
    insert(_el$, createComponent(Show, {
      get when() {
        return layoutStore.showSettings;
      },
      get children() {
        return createComponent(SettingsPopover, {
          onClose: () => setLayoutStore("showSettings", false)
        });
      }
    }), null);
    insert(_el$, createComponent(CheatSheetModal, {}), null);
    insert(_el$, createComponent(ConfirmationModal, {
      get isOpen() {
        return !!cascadePrompt();
      },
      title: "Apply Profile to all Panes?",
      get description() {
        return `Would you like to switch all existing active web panes in the workspace/tab "${cascadePrompt()?.targetName}" to use this profile?`;
      },
      confirmText: "Switch All Panes",
      cancelText: "Only Apply to New Tabs",
      onConfirm: async () => {
        const prompt = cascadePrompt();
        if (prompt) {
          if (prompt.targetType === "workspace") {
            await window.api?.updatePaneProfilesForWorkspace(prompt.targetId, prompt.profileId);
            ws.switchWorkspace(prompt.targetId, "forward");
          } else {
            await window.api?.updatePaneProfilesForTab(prompt.targetId, prompt.profileId);
            ws.switchTab(prompt.targetId, "forward");
          }
        }
        setCascadePrompt(null);
      },
      onCancel: () => {
        setCascadePrompt(null);
      }
    }), null);
    insert(_el$, createComponent(PaywallPopover, {}), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return toast();
      },
      get children() {
        var _el$29 = _tmpl$16();
        insert(_el$29, createComponent(Show, {
          get when() {
            return toast()?.type === "success";
          },
          get children() {
            return _tmpl$14();
          }
        }), null);
        insert(_el$29, createComponent(Show, {
          get when() {
            return toast()?.type === "error";
          },
          get children() {
            return _tmpl$15();
          }
        }), null);
        insert(_el$29, () => toast()?.message, null);
        return _el$29;
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$ = `absolute z-[60] pointer-events-auto items-center justify-center w-[40px] h-[40px] bg-white border border-neutral-200/60 shadow-md top-3 left-3 rounded-2xl hover:bg-neutral-50 ${layoutStore.maximizedPaneId ? "hidden" : "flex"}`, _v$2 = isUiCollapsed() ? "Expand UI (Alt+Z)" : "Collapse UI (Alt+Z)", _v$3 = `flex-1 relative bg-transparent w-full h-full overflow-hidden transition-[border-radius,box-shadow] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${hoverZone() !== "none" ? "rounded-[16px] ring-1 ring-neutral-200/60 shadow-lg" : "rounded-none ring-0 ring-transparent shadow-none"}`;
      _v$ !== _p$.e && className(_el$2, _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$3, "title", _p$.t = _v$2);
      _v$3 !== _p$.a && className(_el$26, _p$.a = _v$3);
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
render(() => createComponent(App, {}), document.getElementById("root"));
