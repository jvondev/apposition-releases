/**
 * @typedef {Object} PaneConfig
 * @property {string} url
 * @property {string} [profileId]
 * @property {string} [title]
 * @property {string} [appId]
 */

/**
 * @typedef {Object} LayoutSplitConfig
 * @property {"split"} type
 * @property {"horizontal" | "vertical"} [orientation]
 * @property {number} [ratio] Clamped between 0.05 and 0.95
 * @property {LayoutNodeConfig} a
 * @property {LayoutNodeConfig} b
 */

/**
 * @typedef {Object} LayoutPaneConfig
 * @property {"pane"} type
 * @property {string} url
 * @property {string} [profileId]
 * @property {string} [title]
 */

/**
 * @typedef {LayoutSplitConfig | LayoutPaneConfig} LayoutNodeConfig
 */

/**
 * @typedef {Object} TabConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [customName]
 * @property {string} [defaultProfileId]
 * @property {LayoutNodeConfig | { panes: PaneConfig[], orientation?: "horizontal" | "vertical", ratio?: number }} layout
 */

/**
 * @typedef {Object} WorkspaceConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [icon]
 * @property {string} [defaultProfileId]
 * @property {TabConfig[]} tabs
 */

/**
 * @typedef {Object} ProfileConfig
 * @property {string} id
 * @property {string} name
 * @property {string} [color]
 * @property {"auto" | "clone" | "snapshot" | "fresh"} [authSource]
 * @property {Record<string, any>} [identities]
 */

/**
 * @typedef {Object} WindowConfig
 * @property {number} [width]
 * @property {number} [height]
 * @property {boolean} [maximized]
 */

/**
 * @typedef {Object} ScenarioConfig
 * @property {string} name
 * @property {string} [description]
 * @property {WindowConfig} [window]
 * @property {ProfileConfig[]} [profiles]
 * @property {WorkspaceConfig[]} workspaces
 */

export const DEFAULT_WINDOW_CONFIG = {
  width: 1920,
  height: 1080,
  maximized: true
};
