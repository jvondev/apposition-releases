/**
 * Pure deterministic layout generator satisfying Apposition mathematical tree invariants:
 * For N leaf panes, exactly N-1 split nodes (N >= 1) with equal proportions by default.
 */

let counter = 0;
function nextId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function clampRatio(val) {
  if (typeof val !== "number" || Number.isNaN(val)) return 0.5;
  return Math.min(0.95, Math.max(0.05, val));
}

function normalizePane(pane, defaultProfileId = "main") {
  const paneId = pane.id || nextId("pane");
  const url = pane.url || "about:blank";
  return {
    id: paneId,
    type: "pane",
    paneType: "web",
    url,
    profileId: pane.profileId || defaultProfileId,
    title: pane.title || (url.startsWith("http") ? new URL(url).hostname : "Tab"),
    canGoBack: false,
    canGoForward: false,
    history: [url],
    historyIndex: 0
  };
}

export function buildLayoutTree(layoutInput, defaultProfileId = "main") {
  const nodes = {};
  let rootId = "";
  let firstPaneId = "";

  if (!layoutInput) {
    const single = normalizePane({ url: "https://linear.app" }, defaultProfileId);
    return { rootId: single.id, nodes: { [single.id]: single }, activePaneId: single.id };
  }

  // Handle flat convenience array of panes: { panes: [...], orientation, ratio }
  if (Array.isArray(layoutInput.panes) && layoutInput.panes.length > 0) {
    const paneList = layoutInput.panes.map((p) => normalizePane(p, defaultProfileId));
    firstPaneId = paneList[0].id;

    for (const p of paneList) {
      nodes[p.id] = p;
    }

    if (paneList.length === 1) {
      rootId = paneList[0].id;
    } else {
      const orientation = layoutInput.orientation === "vertical" ? "vertical" : "horizontal";

      function buildEqualTree(list) {
        if (list.length === 1) return list[0].id;
        const splitId = nextId("split");
        const ratio = list.length === 2 && layoutInput.ratio !== undefined
          ? clampRatio(layoutInput.ratio)
          : clampRatio(1 / list.length);

        const leftId = list[0].id;
        const rightId = buildEqualTree(list.slice(1));

        nodes[splitId] = {
          id: splitId,
          type: "split",
          direction: orientation,
          orientation,
          ratio,
          a: leftId,
          b: rightId
        };
        return splitId;
      }

      rootId = buildEqualTree(paneList);
    }

    return { rootId, nodes, activePaneId: firstPaneId };
  }

  // Handle recursive nested layout node
  function traverse(nodeConfig) {
    if (!nodeConfig) return "";
    if (nodeConfig.type === "pane" || nodeConfig.url) {
      const pane = normalizePane(nodeConfig, defaultProfileId);
      nodes[pane.id] = pane;
      if (!firstPaneId) firstPaneId = pane.id;
      return pane.id;
    }
    if (nodeConfig.type === "split") {
      const splitId = nodeConfig.id || nextId("split");
      const leftChild = traverse(nodeConfig.a);
      const rightChild = traverse(nodeConfig.b);
      const dir = (nodeConfig.direction || nodeConfig.orientation) === "vertical" ? "vertical" : "horizontal";
      nodes[splitId] = {
        id: splitId,
        type: "split",
        direction: dir,
        orientation: dir,
        ratio: clampRatio(nodeConfig.ratio ?? 0.5),
        a: leftChild,
        b: rightChild
      };
      return splitId;
    }
    const fallback = normalizePane({ url: "about:blank" }, defaultProfileId);
    nodes[fallback.id] = fallback;
    return fallback.id;
  }

  rootId = traverse(layoutInput);
  return { rootId, nodes, activePaneId: firstPaneId || rootId };
}
