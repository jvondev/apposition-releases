import { i as insert, j as addEventListener, b as createRenderEffect, s as setAttribute, t as template, e as delegateEvents, a as createComponent, S as Show, F as For, c as createSignal, x as createMemo, o as onMount, r as onCleanup, d as setLayoutStore, u as style, v as use, w as Portal, l as layoutStore } from "./index-BaBsT-S7.js";
const releasesData = /* @__PURE__ */ JSON.parse('[{"version":"1.3.1","tag":"v1.3.1","title":"Apposition v1.3.1","publishedAt":"2026-09-12","categories":[{"category":"Features","items":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Communicator App Reload","description":"Added a dedicated reload button in the Communicator header to quickly refresh active web apps with visual feedback."}]},{"category":"Improvements","items":[{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."},{"title":"Tactile Edge Navigation Shelves","description":"Dragging panels to screen edges to navigate between tabs or workspaces now reveals flush, tactile bezel shelves with circular tension rings and target previews, featuring vertical shelves along the window sides for tabs and horizontal shelves along the top and bottom for workspaces."},{"title":"Real-Time Profile Details","description":"The profile switcher now updates instantly when signing into an account in any split pane, and displays connected account counts with detailed hover summaries."}]},{"category":"Bug Fixes","items":[{"title":"Automatic Account Identification","description":"Resolved an issue where signed-in accounts across workspaces were displayed with generic provider placeholders instead of their actual email address or username."},{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces, creating tabs, or splitting panes could cause panels to briefly flicker or display placeholder states, ensuring native web views remain instantly responsive."},{"title":"Continuous Background Web Sessions","description":"Background tabs and workspaces maintain their active state without unexpected reloads, preserving video progress, unsaved form inputs, and active sessions."},{"title":"Communicator Popovers & Settings","description":"Interacting with stack settings, app configuration menus, or account pickers no longer causes the Communicator drawer to inadvertently close."},{"title":"Stable Drag Focus & Screen-Edge Navigation","description":"Resolved an issue where the active panel focus ring could jitter or rapidly ping-pong while dragging panels across workspaces, and eliminated rapid duplicate tab creation when dragging near the screen edges."},{"title":"Intelligent Semantic Tab Naming","description":"Tabs now intelligently resolve authentic board, document, and channel names from live web applications, preventing cryptic database IDs, random alphanumeric routing slugs, or static brand placeholders from appearing on tabs."},{"title":"Intelligent Omnibar & Search Navigation","description":"Searching for apps like Gmail, Figma, or Notion now directly launches the application upon pressing Enter, while queries containing search terms like tutorials or tips dynamically prioritize web search results without false positives."}]}],"highlights":[{"title":"Persistent Media Playback Continuity","description":"Streaming media and video playback now reliably remember and restore your exact playback timestamp across page reloads and tab switches, seamlessly resuming where you left off."},{"title":"Interactive Audio Equalizer & Smart Indicator","description":"Active audio sessions now display a synchronized live visual equalizer across workspace tabs and the master dock control, intelligently pausing the animation when audio is muted, paused, or finished."},{"title":"Fluid Drag-and-Drop Spatial Previews","description":"When dragging a tab or panel to split the screen or dock against the entire window, existing panels now smoothly glide and compress out of the way with responsive spring transitions, showing an exact live preview of the resulting layout before you release."}]},{"version":"1.3.0","tag":"v1.3.0","title":"Introducing the App Directory, Dedicated Release Feed & Fluid Multi-Pane Navigation","publishedAt":"2026-09-11","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.3.0/app-directory.webp","categories":[{"category":"Features","items":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Tactile App Shortcuts & Split Dock","description":"Pinned shortcuts and stacked split sessions now feature tactile cursor-tracking 3D tilt with smooth elevation, keeping each shortcut isolated while completely preventing dock shift or hover flickering in narrow panels."},{"title":"Flexible Annual Plan","description":"Added a streamlined annual subscription ($120/year) alongside the limited Founder Lifetime License."}]},{"category":"Improvements","items":[{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."},{"title":"In-App Release Notes Viewer","description":"Redesigned the update viewer with a spacious layout, one-click update checks, progressive instant loading, and direct web archive navigation."},{"title":"Visual Release Previews","description":"Key milestone release notes now display high-resolution visual previews directly within the in-app release viewer and website feed."},{"title":"Enhanced Motion & Performance","description":"Optimized motion, panel transitions, and scrolling performance across all workspace navigation views."},{"title":"Clean App Catalog","description":"Removed redundant duplicate listings and disambiguated service entries across shared domains."}]},{"category":"Bug Fixes","items":[{"title":"Workspace Airspace & Transitions","description":"Resolved an issue where switching workspaces or splitting panes could cause the address bar to temporarily blank out, the profile badge to flicker, or empty panes to display a blank screen."},{"title":"Search Input & Sleep Recovery","description":"Resolved an issue where opening the App Directory from a new tab could prevent typing into the search bar, and fixed a bug where waking the computer from sleep could cause the interface to temporarily disappear."},{"title":"Command Bar Behavior","description":"Prevented accidental transitions to notes when pressing Escape in the workspace search bar."}]}],"highlights":[{"title":"Introducing the App Directory","description":"Discover, search, and launch hundreds of web apps organized across curated categories. Features an adaptive layout that provides full app details even in compact split panes, fluid 3D magnetic hover physics, instant keyboard navigation, and zero-stutter scrolling."},{"title":"Dedicated Product Changelog","description":"Browse release notes, search past updates, filter by category, and subscribe via RSS feeds directly inside the app."},{"title":"Minimalist Tab Titles","description":"Refined workspace tabs with a minimalist icon-focused view that smoothly reveals tab titles upon hover, while newly created tabs immediately present clear labels."}]},{"version":"1.2.7","tag":"v1.2.7","title":"Smart Window Persistence, Dynamic Omnibar Expansion, and Instant Cold Starts","publishedAt":"2026-09-09","categories":[{"category":"Features","items":[{"title":"Smart Window Persistence & Multi-Monitor Recovery","description":"The desktop app now seamlessly remembers your window size, position, and maximized state across restarts, and automatically rescues windows onto your main screen if an external monitor is disconnected."},{"title":"Dynamic Omnibar Expansion","description":"The address search bar now smoothly expands into available window space when editing and seamlessly morphs back into place upon dismissal, while tab labels compress smoothly under pressure without visual overlap."},{"title":"Semantic Title Distillation","description":"Tabs now automatically distill deep page titles into concise sub-task labels like Proposals, Pull requests, or Inbox instead of repeating brand names, and single tabs collapse into clean icon capsules to keep your workspace header uncluttered."}]},{"category":"Improvements","items":[{"title":"Instant Cold Starts","description":"App startup and workspace launch times are now significantly faster, eliminating initial launch freezes and accelerating background tab hydration."},{"title":"Zero-Flicker Launch","description":"The application now opens instantaneously with a fully rendered workspace, eliminating initial blank window delays and keeping active tabs immediately responsive."}]},{"category":"Bug Fixes","items":[{"title":"Duplicate Split Prevention","description":"Splitting panes via keyboard shortcuts now reliably creates a single new pane, eliminating accidental duplicate splits."},{"title":"Split View Focus Synchronization","description":"Active pane navigation and panel closing now synchronize flawlessly across split views, ensuring shortcuts like Ctrl+W consistently close the selected pane."}]}],"highlights":[{"title":"Smart Window Persistence","description":"Apposition automatically remembers your window positions and multi-monitor layouts across restarts."},{"title":"Dynamic Omnibar Expansion","description":"The address and search bar smoothly adapts to fit long queries and collapses into a compact capsule."},{"title":"Instant Cold Starts","description":"Workspaces and active panes now launch instantaneously with zero initial blank window lag."}]},{"version":"1.2.6","tag":"v1.2.6","title":"Seamless Workspace Dropdowns & Visual Branding Polish","publishedAt":"2026-09-09","categories":[{"category":"Improvements","items":[{"title":"Consolidated Brand Mark","description":"Updated all application installer assets and web icons to consistently display the refreshed brand mark across tabs and installer dialogs."}]},{"category":"Bug Fixes","items":[{"title":"Dropdown Menu Stability","description":"Resolved an issue where dropdown menus, selection filters, and model pickers in web workspaces would immediately collapse when clicked."},{"title":"Address Bar Hijack Guard","description":"Resolved an issue where websites containing embedded frames or interactive widgets could unexpectedly hijack the active tab address bar."}]}],"highlights":[{"title":"Dropdown Menu Stability","description":"Dropdown pickers and menus in web applications now stay open reliably during interaction."},{"title":"Address Bar Hijack Guard","description":"Embedded iframes are prevented from modifying tab address state unexpectedly."}]},{"version":"1.2.5","tag":"v1.2.5","title":"Self-Serve Device Licensing, Polished Brand Identity & 35% Partner Program","publishedAt":"2026-09-08","categories":[{"category":"Features","items":[{"title":"Self-Serve Device Licensing","description":"Added seamless in-app and web license checkout, self-serve device seat management directly from Account settings, and launched the 35% Partner Program."}]},{"category":"Improvements","items":[{"title":"Refreshed Visual Identity","description":"Updated the official application icon, website branding, and browser tab favicons with our new split-monolith visual identity."}]}],"highlights":[{"title":"Self-Serve Device Licensing","description":"Manage active device seats and license transfers directly from your Account settings screen."},{"title":"35% Partner Program","description":"Earn recurring rewards for referring teams and collaborators to Apposition."}]},{"version":"1.2.4","tag":"v1.2.4","title":"Silent Background Updates & Precision Workspace Controls","publishedAt":"2026-09-05","categories":[{"category":"Features","items":[{"title":"Dedicated Drawer Resize Controls","description":"Dedicated drawer resize controls in the header and settings menu to customize your workspace layout with precision."},{"title":"Silent Background Updates","description":"Seamless background application updates that download quietly and apply instantly upon restart without interrupting your work."}]},{"category":"Improvements","items":[{"title":"Smarter Omnibar Search Classification","description":"Reliably differentiates search queries from web addresses, ensuring terms like code snippets or decimal numbers open web searches correctly."},{"title":"Anchored Popover Dialogs","description":"Add App and Stack configuration menus now open cleanly as anchored popovers without dimming the workspace."}]},{"category":"Bug Fixes","items":[{"title":"Search Query Desync Fix","description":"Fixed an issue where search queries typed into the address bar were intermittently dropped or desynchronized when navigating."},{"title":"Google Search Redirection Guard","description":"Resolved unexpected authentication prompts and redirection loops when browsing Google search results."}]}],"highlights":[{"title":"Silent Background Updates","description":"Updates download in the background without popups or work interruptions."},{"title":"Workspace Drawer Controls","description":"Fine-tune sidebar and drawer dimensions with tactile resize handles."}]},{"version":"1.2.3","tag":"v1.2.3","title":"Workspace Isolation & Tab Management Polish","publishedAt":"2026-09-02","categories":[{"category":"Features","items":[{"title":"Strict Workspace Sandboxing","description":"Dedicated profile cookies and storage partitions across isolated tabs."}]},{"category":"Improvements","items":[{"title":"Fluid Tab Switching","description":"Zero-latency keyboard shortcuts to cycle through workspaces and tabs."}]}],"highlights":[{"title":"Strict Workspace Sandboxing","description":"Completely isolated session cookies and partitions per tab."}]},{"version":"1.2.2","tag":"v1.2.2","title":"Connected Account Detection & Precision Workspace Isolation","publishedAt":"2026-08-31","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.2/profile-isolation.webp","categories":[{"category":"Features","items":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."}]},{"category":"Improvements & Fixes","items":[{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."},{"title":"Enhanced connected account identification and","description":"Enhanced connected account identification and avatar presentation in pane headers, omniboxes, and workspace menus."}]}],"highlights":[{"title":"Added automated connected account detection","description":"Added automated connected account detection across workspace profiles with one-click authentication and live session status."},{"title":"Introduced instant email and handle","description":"Introduced instant email and handle copying, account filtering, and refined color themes for profile management."},{"title":"Restored seamless pointer event isolation","description":"Restored seamless pointer event isolation across multi-pane split layouts, preventing focus drift when interacting with profile popovers."}]},{"version":"1.2.1","tag":"v1.2.1","title":"Floating Communicator Hub, Fluid Spatial Drag, and Workspace Interaction Polish","publishedAt":"2026-08-31","categories":[{"category":"Features","items":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."}]},{"category":"Improvements","items":[{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."},{"title":"Improved modal dialogs and overlay","description":"Improved modal dialogs and overlay menus to close smoothly on outside clicks or the Escape key."}]},{"category":"Bug Fixes","items":[{"title":"The floating Communicator now stays","description":"The floating Communicator now stays reliably on top of all workspace panes, eliminates visual bleed-through from background pages, and smoothly dismisses whenever you click outside."},{"title":"Fixed an issue where interacting","description":"Fixed an issue where interacting with web applications and links inside split panels could cause unexpected page reloads or unrendered views."}]}],"highlights":[{"title":"Introduced the Communicator Hub","description":"seamlessly access your messengers and work inboxes with instant hover peek, customizable stacks, session-isolated profiles, and full floating palette support."},{"title":"Refined the Communicator Hub with","description":"Refined the Communicator Hub with fluid drag-to-float window physics, magnetic corner docking, and a streamlined capsule header."},{"title":"Streamlined messaging app layouts with","description":"Streamlined messaging app layouts with smooth zero-latency dragging and crisp edge-to-edge content framing for web apps like Gmail and Slack."}]},{"version":"1.2.0","tag":"v1.2.0","title":"Next-Gen Spatial Engine & Universal Communicator","publishedAt":"2026-08-27","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.2.0/communicator-hub.webp","categories":[{"category":"Features","items":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for Slack, Gmail, Telegram, and Discord."},{"title":"Dynamic Split Panes","description":"Tactile drag-and-drop spatial multi-pane tiling with zero webview reloads."}]}],"highlights":[{"title":"Universal Communicator Hub","description":"Unified floating messaging cluster for all your daily apps."},{"title":"Dynamic Split Panes","description":"Tactile spatial tiling with zero pane reloads."}]},{"version":"1.1.8","tag":"v1.1.8","title":"Stability Fixes, Install Improvements & Google Sign-in Reliability","publishedAt":"2026-08-23","categories":[{"category":"Bug Fixes","items":[{"title":"Fixed a rare crash that","description":"Fixed a rare crash that could close the entire app unexpectedly while browsing."},{"title":"Resolved an issue where certain","description":"Resolved an issue where certain network requests and cross-origin authentications could cause the application to crash unexpectedly."}]},{"category":"Sign-in & Accounts","items":[{"title":"Signing in with Google now","description":"Signing in with Google now works reliably inside panels as well as the dedicated login window - including retries after a failed attempt."},{"title":"Google sign-in no longer interrupts","description":"Google sign-in no longer interrupts you with Windows passkey popups; it goes straight to password entry."}]},{"category":"Improvements","items":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]}],"highlights":[{"title":"Streamlined one-click installation and clipboard","description":"Streamlined one-click installation and clipboard copy commands across download guides."}]},{"version":"1.1.7","tag":"v1.1.7","title":"Resilient Startup & Seamless Session Recovery","publishedAt":"2026-08-22","categories":[{"category":"Improvements & Bug Fixes","items":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]}],"highlights":[{"title":"Resolved an intermittent startup interruption","description":"Resolved an intermittent startup interruption on desktop sessions and introduced automatic background session self-healing to seamlessly recover tabs and active workspaces."},{"title":"Streamlined cross-platform installer setup with","description":"Streamlined cross-platform installer setup with guided post-download instructions for smoother initial onboarding."},{"title":"Optimized modal rendering layers and","description":"Optimized modal rendering layers and window transitions for smoother workspace interactions."}]},{"version":"1.1.6","tag":"v1.1.6","title":"Seamless Media Continuity, Instant Tab Restoration & Streamlined Installers","publishedAt":"2026-08-20","categories":[{"category":"Features","items":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Streamlined Setup & Package Managers","description":"Introduced a distraction-free installation assistant with one-click terminal setup for macOS, Windows, and Linux, plus instant cryptographic verification."}]},{"category":"Improvements & Fixes","items":[{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."},{"title":"Immediate Split Pane Reflow","description":"Closing split panes now instantly reflows remaining views with zero delay and completely halts background audio upon close."},{"title":"Reliable Keyboard Navigation","description":"Workspace shortcuts now reliably trigger even when active web apps attempt to capture keyboard focus."}]}],"highlights":[{"title":"Background Media Continuity","description":"Playing videos and background audio now persist seamlessly without reloads or interruptions when switching between tabs and workspaces."},{"title":"Workspace-Isolated Audio Indicators","description":"Animated equalizer waves now indicate audio playback strictly within their active workspace."},{"title":"Instant Tab & Pane Undo","description":"Reopening closed tabs and split panes (Ctrl+Shift+T) is now instant, accompanied by a live visual undo notification showing site favicons."}]},{"version":"1.1.5","tag":"v1.1.5","title":"Spatial Navigation, Omnibox Browser Bar & Audio Multitasking","publishedAt":"2026-08-18","heroImage":"https://github.com/jvondev/apposition-releases/releases/download/v1.1.5/apposition-v1.1.5-spatial-navigation.png","categories":[{"category":"Features","items":[{"title":"Top-Center Omnibox Browser Bar","description":"Browser navigation bar with omnibox search suggestions, back/forward history, and quick layout actions."},{"title":"3-Way Spatial Layout Mode","description":"Toggle for docked, floating overlap, and full collapse views with persistent user preferences."},{"title":"Panel Dynamic Island & Focus Mode","description":"Distraction-free single-pane work triggered with Alt+F shortcut."}]},{"category":"Improvements","items":[{"title":"Responsive Soundwave Indicator","description":"Tabs display live soundwaves when audio is playing, with instant one-click muting."},{"title":"Synchronized Spatial Grid","description":"Refined window border margins, split gaps, and drop snap ghosts onto a synchronized grid."}]},{"category":"Bug Fixes","items":[{"title":"Window Control Hit-Testing","description":"Optimized window control responsiveness and hit-testing across all edge layout modes."}]}],"highlights":[{"title":"Top-Center Omnibox Browser Bar","description":"Instant search suggestions and quick layout actions right from the header."},{"title":"3-Way Spatial Layout Mode","description":"Docked, floating overlap, and full collapse workspace arrangements."},{"title":"Audio Indicator & 1-Click Mute","description":"Live soundwaves on active tabs with instant one-click muting."}]},{"version":"1.1.4","tag":"v1.1.4","title":"Multi-Profile Single Sign-On & Persistent Session Sync","publishedAt":"2026-08-18","categories":[{"category":"Features","items":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."}]},{"category":"Improvements","items":[{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."},{"title":"Profile switching preserves the exact","description":"Profile switching preserves the exact active webpage without accidental sign-outs."},{"title":"Profile switcher rows now feature","description":"Profile switcher rows now feature full-width selection highlights and floating hover micro-actions."}]},{"category":"Fixes","items":[{"title":"Switching profiles on a split","description":"Switching profiles on a split pane now instantly switches session partitions and cookies without latency."},{"title":"Active account logins and cookies","description":"Active account logins and cookies are now reliably preserved across app restarts and system sleep."},{"title":"Workspace quick-switching via Command Palette","description":"Workspace quick-switching via Command Palette now previews icons with keyboard navigation."}]}],"highlights":[{"title":"Redesigned the profile manager with","description":"Redesigned the profile manager with an instant Single Sign-On provider bar, streamlined profile settings, and dynamic active pane detection."},{"title":"Added an interactive profile switcher","description":"Added an interactive profile switcher popover with the Alt+P shortcut and full arrow-key keyboard navigation."},{"title":"Opening or splitting panes under","description":"Opening or splitting panes under the same profile now automatically synchronizes login sessions in real time."}]},{"version":"1.1.3","tag":"v1.1.3","title":"Seamless System Browser Sign-In, Workspace Context Menus & Enhanced Navigation","publishedAt":"2026-08-16","categories":[{"category":"Features","items":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"History Jump Menu & Navigation Shortcuts","description":"Long-press or right-click the back/forward navigation buttons to open a visual jump menu with site icons, or navigate back and forward instantly using Ctrl+[ and Ctrl+]."},{"title":"Power-User Search Keywords","description":"Address inputs now resolve Google Search directly with instant search engine shortcut keywords for YouTube, GitHub, and Google Drive."}]},{"category":"Improvements","items":[{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."},{"title":"Streamlined Single-Click Setup","description":"Windows installation is now completely silent and lock-free, with instant setup and automatic workspace layout restoration on launch."},{"title":"Fluid Floating Island Transitions","description":"Refined hovering and edge cursor tracking for floating window controls, preventing accidental window collapses and preserving direct click access to underlying web elements."}]},{"category":"Bug Fixes","items":[{"title":"Resilient Split Pane Sessions","description":"Closing a split pane no longer triggers unnecessary page reloads or active session interruptions in adjacent open panes."},{"title":"Reliable Embedded Shortcut Handling","description":"Fixed an issue where keyboard navigation shortcuts could become unresponsive while focused inside web panels, restoring instant focus upon clicking into any pane."},{"title":"Display Scaling Alignment","description":"Resolved an issue where interactive workspace preview tiles appeared scaled down or misaligned on smaller displays."},{"title":"Login Compatibility","description":"Eliminated unexpected firewall prompts and resolved authentication dialog blocks across third-party web services."}]}],"highlights":[{"title":"Seamless System Browser Sign-In","description":"Sign in to Google Workspace, Slack, Notion, and other protected services using your default browser with 1-click verification."},{"title":"Pane Context Menu & Reload Controls","description":"Right-click anywhere in an active pane to access quick navigation, clipboard tools, pane splitting, and workspace layout controls, or quickly refresh active panes using standard keyboard shortcuts (Ctrl+R / F5 / Ctrl+Shift+R)."},{"title":"Performance & Memory Efficiency","description":"Dramatically reduced memory consumption and input latency when running demanding web applications like Canva and Figma, with smoother split resizing and faster workspace loading."}]},{"version":"1.1.2","tag":"v1.1.2","title":"Zero-Reload Split Persistence & 120 FPS Resizing","publishedAt":"2026-08-13","categories":[{"category":"Improvements","items":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"category":"Bug Fixes","items":[{"title":"Fixed an issue where first-time","description":"Fixed an issue where first-time installations could render an empty screen by guaranteeing robust default workspace and tab initialization."}]}],"highlights":[{"title":"Added options in the Windows","description":"Added options in the Windows installer to create Desktop and Start Menu shortcuts, and enable one-click launch immediately after installation."},{"title":"Integrated single-instance protection to prevent","description":"Integrated single-instance protection to prevent accidental duplicate instances and ensure smooth window focusing."},{"title":"Pane state and active documents","description":"Pane state and active documents now remain completely persistent without reloading during split navigation, tab changes, and dragging, alongside real-time 120 FPS split resizing."}]},{"version":"1.1.1","tag":"v1.1.1","title":"Layout History, Spatial Keyboard Swapping & Crash Recovery","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added visual audio activity indicators","description":"Added visual audio activity indicators on active tabs to easily identify audio sources across complex multi-pane workspaces."},{"title":"Added intelligent address bar navigation","description":"Added intelligent address bar navigation for local development ports, alongside a one-click terminal install option."}]},{"category":"Improvements","items":[{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."},{"title":"Completely redesigned the pane toolbar","description":"Completely redesigned the pane toolbar with a jitter-free tactile aesthetic and refined double-bezel styling."},{"title":"Upgraded tab hover tooltips to","description":"Upgraded tab hover tooltips to instantly display rich session context with a polished tactile feel."},{"title":"Enhanced workspace docking and pane","description":"Enhanced workspace docking and pane splitting reliability with smoother drag transitions and robust offline session persistence."}]},{"category":"Bug Fixes","items":[{"title":"Fixed a startup crash on","description":"Fixed a startup crash on Windows and macOS caused by an engine compilation mismatch, and ensured the official Apposition icon displays correctly across all desktop platforms."},{"title":"Resolved an issue where dragging","description":"Resolved an issue where dragging panels in workspaces with multiple panes could cause duplicate panels, layout freezes, or dropped keyboard shortcuts."},{"title":"Resolved an issue where closing","description":"Resolved an issue where closing the final tab or pane in a workspace could cause the interface to freeze or display an empty background."},{"title":"Resolved navigation bugs that caused","description":"Resolved navigation bugs that caused the search input to occasionally lose typed text or drop focus when switching workspaces."},{"title":"Resolved an issue where rapidly","description":"Resolved an issue where rapidly switching workspaces could cause tabs to display the wrong environment."}]}],"highlights":[{"title":"Added support for Layout History","description":"Added support for Layout History with Undo (Ctrl+Alt+Z) and Redo (Ctrl+Alt+Y), allowing you to instantly revert layout adjustments."},{"title":"Added keyboard shortcuts (Alt+Shift+Arrows) to","description":"Added keyboard shortcuts (Alt+Shift+Arrows) to swiftly swap adjacent panels or cycle stacking direction at screen edges."},{"title":"Added tactile splitter handles, clean","description":"Added tactile splitter handles, clean boundary previews when docking panels, and a self-healing layout recovery system."}]},{"version":"1.1.0","tag":"v1.1.0","title":"Seamless Updates, Standalone Inspector & Draggable Tabs","publishedAt":"2026-08-12","categories":[{"category":"Features","items":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Opening the Inspector (F12) now","description":"Opening the Inspector (F12) now launches a clean, standalone floating window instead of squeezing into a sidebar."},{"title":"You can now view our","description":"You can now view our latest release notes in a dedicated popover and submit feedback directly from the new sidebar Support Cluster without leaving your workspace."},{"title":"Opening external links from the","description":"Opening external links from the changelog now seamlessly creates a new workspace tab instead of launching an external browser."}]},{"category":"Improvements","items":[{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."},{"title":"Dragging a pane into an","description":"Dragging a pane into an empty tab now cleanly replaces it with a clear visual drop preview, and moving panes between tabs no longer leaves behind orphaned blank tabs."},{"title":"Dragging the last panel out","description":"Dragging the last panel out of a tab or workspace now automatically cleans up the empty space instead of leaving an abandoned tab."}]},{"category":"Bug Fixes","items":[{"title":"Re-engineered the window manager to","description":"Re-engineered the window manager to completely eliminate cursor jitter and flickering when hovering over panes, while ensuring floating buttons and menus remain perfectly responsive."},{"title":"Resolved multi-window shortcut conflicts, ensuring","description":"Resolved multi-window shortcut conflicts, ensuring actions like splitting panels, closing tabs, and swiping between workspaces are perfectly instantaneous and correctly targeted."},{"title":"Fixed an issue where the","description":"Fixed an issue where the search bar would not automatically receive keyboard focus when opening a new tab or switching back to an empty tab."},{"title":"Resolved an issue that caused","description":"Resolved an issue that caused active workspace panels to unexpectedly refresh or blink when opening the settings menu."}]}],"highlights":[{"title":"Apposition now automatically detects new","description":"Apposition now automatically detects new versions and lets you restart to apply them with a single click."},{"title":"Added a manual \\"Check for","description":"Added a manual \\"Check for Updates\\" button in the Account Settings menu."},{"title":"Dragging a pane to the","description":"Dragging a pane to the edge of the screen to switch tabs or workspaces is now significantly faster, visually sharper, and correctly transfers the pane without it disappearing."}]},{"version":"1.0.0","tag":"v1.0.0","title":"Initial Launch of Apposition","publishedAt":"2026-08-02","categories":[{"category":"Features","items":[{"title":"Multi-Pane Workspace Canvas","description":"The digital workspace designed for deep parallel work without tab chaos."}]}],"highlights":[{"title":"Multi-Pane Workspace Canvas","description":"Organize web applications and accounts in one unified window."}]}]');
var _tmpl$$3 = /* @__PURE__ */ template(`<div class="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200/60 bg-white shrink-0"><div class="flex items-center gap-2"><h2 class="text-sm font-semibold text-neutral-900 tracking-tight">Release Notes</h2><span class="text-[11px] font-mono text-neutral-600 bg-neutral-100 border border-neutral-200/90 px-2 py-0.5 rounded-full font-medium shadow-2xs"></span></div><div class="flex items-center gap-1.5"><button title="Check for updates"class="flex items-center gap-1.5 text-xs font-medium text-neutral-700 hover:text-neutral-950 bg-neutral-100/90 hover:bg-neutral-200/80 active:scale-[0.97] border border-neutral-200/90 px-2.5 py-1 rounded-lg transition-all duration-150 cursor-pointer disabled:opacity-50 select-none shadow-2xs"><svg width=13 height=13 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg><span></span></button><button title="Open full changelog on web"class="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"><svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1=10 y1=14 x2=21 y2=3></line></svg></button><button title=Close class="text-neutral-400 hover:text-neutral-700 transition-colors p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"><svg width=15 height=15 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=2 stroke-linecap=round stroke-linejoin=round><line x1=18 y1=6 x2=6 y2=18></line><line x1=6 y1=6 x2=18 y2=18>`);
function ChangelogHeader(props) {
  return (() => {
    var _el$ = _tmpl$$3(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$2.nextSibling, _el$6 = _el$5.firstChild, _el$7 = _el$6.firstChild, _el$8 = _el$7.nextSibling, _el$9 = _el$6.nextSibling, _el$0 = _el$9.nextSibling;
    insert(_el$4, () => props.latestTag);
    addEventListener(_el$6, "click", props.onCheckUpdates, true);
    insert(_el$8, () => props.checking ? "Checking..." : "Check for Updates");
    addEventListener(_el$9, "click", props.onOpenWeb, true);
    addEventListener(_el$0, "click", props.onClose, true);
    createRenderEffect((_p$) => {
      var _v$ = props.checking, _v$2 = props.checking ? "animate-spin" : "";
      _v$ !== _p$.e && (_el$6.disabled = _p$.e = _v$);
      _v$2 !== _p$.t && setAttribute(_el$7, "class", _p$.t = _v$2);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$$2 = /* @__PURE__ */ template(`<span class="text-[10px] font-mono font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-1.5 py-0.5 rounded-full">Current`), _tmpl$2$2 = /* @__PURE__ */ template(`<div class="w-full rounded-xl overflow-hidden border border-neutral-200/80 bg-neutral-50 max-h-48"><img class="w-full h-auto object-cover"loading=lazy>`, true, false, false), _tmpl$3$1 = /* @__PURE__ */ template(`<div class="w-full bg-white border border-neutral-200/90 rounded-2xl p-4 shadow-xs flex flex-col gap-3 shrink-0"><div class="flex items-center justify-between border-b border-neutral-100 pb-2.5"><div class="flex items-center gap-2"><span class="text-xs font-mono font-semibold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded-full border border-neutral-200/80 shadow-2xs"></span><span class="text-[11px] text-neutral-400 font-mono"></span></div></div><h3 class="text-xs font-bold text-neutral-900 leading-snug"></h3><div class="flex flex-col gap-3">`), _tmpl$4$1 = /* @__PURE__ */ template(`<div class="flex flex-col gap-1.5"><span class="text-[10px] font-mono uppercase tracking-wider font-semibold text-neutral-500"></span><ul class="flex flex-col gap-1.5 pl-1">`), _tmpl$5 = /* @__PURE__ */ template(`<li class="flex items-start gap-2 text-xs text-neutral-600 leading-relaxed"><span class="w-1.5 h-1.5 rounded-full bg-neutral-400 mt-1.5 shrink-0"></span><div><strong class="font-semibold text-neutral-800">: </strong><span>`);
function ChangelogCard(props) {
  const release = () => props.release;
  return (() => {
    var _el$ = _tmpl$3$1(), _el$2 = _el$.firstChild, _el$3 = _el$2.firstChild, _el$4 = _el$3.firstChild, _el$6 = _el$4.nextSibling, _el$7 = _el$2.nextSibling, _el$0 = _el$7.nextSibling;
    insert(_el$4, () => release().tag || `v${release().version}`);
    insert(_el$3, createComponent(Show, {
      get when() {
        return props.isLatest;
      },
      get children() {
        return _tmpl$$2();
      }
    }), _el$6);
    insert(_el$6, () => release().publishedAt);
    insert(_el$7, () => release().title);
    insert(_el$, createComponent(Show, {
      get when() {
        return release().heroImage;
      },
      get children() {
        var _el$8 = _tmpl$2$2(), _el$9 = _el$8.firstChild;
        _el$9.addEventListener("error", (e) => e.currentTarget.parentElement.style.display = "none");
        createRenderEffect((_p$) => {
          var _v$ = release().heroImage, _v$2 = release().title;
          _v$ !== _p$.e && setAttribute(_el$9, "src", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$9, "alt", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$8;
      }
    }), _el$0);
    insert(_el$0, createComponent(For, {
      get each() {
        return release().categories;
      },
      children: (cat) => (() => {
        var _el$1 = _tmpl$4$1(), _el$10 = _el$1.firstChild, _el$11 = _el$10.nextSibling;
        insert(_el$10, () => cat.category);
        insert(_el$11, createComponent(For, {
          get each() {
            return cat.items;
          },
          children: (item) => (() => {
            var _el$12 = _tmpl$5(), _el$13 = _el$12.firstChild, _el$14 = _el$13.nextSibling, _el$15 = _el$14.firstChild, _el$16 = _el$15.firstChild, _el$17 = _el$15.nextSibling;
            insert(_el$15, () => item.title, _el$16);
            insert(_el$17, () => item.description);
            return _el$12;
          })()
        }));
        return _el$1;
      })()
    }));
    return _el$;
  })();
}
var _tmpl$$1 = /* @__PURE__ */ template(`<button class="flex items-center gap-2 text-xs font-medium text-neutral-700 hover:text-neutral-950 bg-white hover:bg-neutral-50 active:scale-[0.98] border border-neutral-200/90 rounded-xl px-4 py-2 shadow-2xs transition-all duration-150 cursor-pointer"><span>Load older releases</span><span class="text-[10px] font-mono text-neutral-500 bg-neutral-100 border border-neutral-200/60 px-1.5 py-0.5 rounded-md font-semibold">+`), _tmpl$2$1 = /* @__PURE__ */ template(`<span class="text-[11px] font-mono text-neutral-400">Showing <!> of <!> releases`), _tmpl$3 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-center py-3 text-center gap-1 w-full border-t border-neutral-200/60 mt-1"><span class="text-xs text-neutral-500 font-medium">You've reached the end of recent releases.</span><button class="text-xs text-neutral-800 hover:text-neutral-950 font-medium underline underline-offset-3 transition-colors cursor-pointer">Explore full changelog archive on web &rarr;`), _tmpl$4 = /* @__PURE__ */ template(`<div class="flex flex-col items-center justify-center pt-2 pb-2 gap-2.5">`);
function ChangelogFooter(props) {
  const remainingCount = () => Math.min(5, props.totalCount - props.loadedCount);
  return (() => {
    var _el$ = _tmpl$4();
    insert(_el$, createComponent(Show, {
      get when() {
        return props.hasMore;
      },
      get children() {
        return [(() => {
          var _el$2 = _tmpl$$1(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling;
          _el$4.firstChild;
          addEventListener(_el$2, "click", props.onLoadMore, true);
          insert(_el$4, remainingCount, null);
          return _el$2;
        })(), (() => {
          var _el$6 = _tmpl$2$1(), _el$7 = _el$6.firstChild, _el$0 = _el$7.nextSibling, _el$8 = _el$0.nextSibling, _el$1 = _el$8.nextSibling;
          _el$1.nextSibling;
          insert(_el$6, () => props.loadedCount, _el$0);
          insert(_el$6, () => props.totalCount, _el$1);
          return _el$6;
        })()];
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return !props.hasMore;
      },
      get children() {
        var _el$10 = _tmpl$3(), _el$11 = _el$10.firstChild, _el$12 = _el$11.nextSibling;
        addEventListener(_el$12, "click", props.onOpenWeb, true);
        return _el$10;
      }
    }), null);
    return _el$;
  })();
}
delegateEvents(["click"]);
var _tmpl$ = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed inset-0 z-[99998] bg-transparent pointer-events-auto">`), _tmpl$2 = /* @__PURE__ */ template(`<div data-overlay-chrome class="fixed z-[99999] w-[580px] h-[560px] max-h-[calc(100vh-32px)] bg-white border border-neutral-200/80 rounded-[20px] shadow-[0_24px_64px_-16px_rgba(0,0,0,0.22)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 select-none"style=background-color:#ffffff><div class="flex-1 overflow-y-auto overscroll-contain p-4 pb-6 flex flex-col gap-4 bg-[#fafaf9] scrollbar-thin">`);
const INITIAL_BATCH = 5;
const BATCH_SIZE = 5;
function ChangelogPopover(props) {
  let popoverRef;
  const releases = releasesData;
  const [checking, setChecking] = createSignal(false);
  const [visibleCount, setVisibleCount] = createSignal(INITIAL_BATCH);
  const visibleReleases = createMemo(() => releases.slice(0, visibleCount()));
  const hasMore = createMemo(() => visibleCount() < releases.length);
  onMount(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
    setLayoutStore("hasUnreadRelease", false);
    window.api?.markChangelogSeen?.(releases[0]?.version);
  });
  const position = () => {
    const anchor = layoutStore.changelogAnchor;
    const margin = 12;
    const style2 = {
      bottom: "16px"
    };
    if (!anchor) {
      style2.left = "56px";
      return style2;
    }
    const isLeftHalf = anchor.left < window.innerWidth / 2;
    if (isLeftHalf) {
      style2.left = `${anchor.left + anchor.width + margin}px`;
    } else {
      style2.right = `${window.innerWidth - anchor.left + margin}px`;
    }
    return style2;
  };
  const handleOpenBrowser = () => {
    const url = "https://apposition.app/changelog";
    if (typeof window.api?.openExternal === "function") {
      window.api.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };
  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, releases.length));
  };
  const handleCheckUpdates = async () => {
    if (checking()) return;
    setChecking(true);
    window.dispatchEvent(new CustomEvent("app:toast", {
      detail: {
        message: "Checking for updates...",
        type: "info"
      }
    }));
    try {
      const res = await window.api?.checkForUpdates?.();
      if (res?.hasUpdate) {
        window.dispatchEvent(new CustomEvent("app:toast", {
          detail: {
            message: `New version ${res.version} available!`,
            type: "success"
          }
        }));
      } else if (res?.isDev) {
        window.dispatchEvent(new CustomEvent("app:toast", {
          detail: {
            message: "App is up to date (dev mode).",
            type: "success"
          }
        }));
      } else if (res?.success) {
        window.dispatchEvent(new CustomEvent("app:toast", {
          detail: {
            message: "You're running the latest version.",
            type: "success"
          }
        }));
      } else {
        throw new Error(res?.error || "Update check failed");
      }
    } catch {
      window.dispatchEvent(new CustomEvent("app:toast", {
        detail: {
          message: "Update check failed",
          type: "error"
        }
      }));
    } finally {
      setChecking(false);
    }
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
        var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild;
        var _ref$ = popoverRef;
        typeof _ref$ === "function" ? use(_ref$, _el$2) : popoverRef = _el$2;
        insert(_el$2, createComponent(ChangelogHeader, {
          get latestTag() {
            return releases[0]?.tag || "v1.2.7";
          },
          get checking() {
            return checking();
          },
          onCheckUpdates: handleCheckUpdates,
          onOpenWeb: handleOpenBrowser,
          get onClose() {
            return props.onClose;
          }
        }), _el$3);
        insert(_el$3, createComponent(For, {
          get each() {
            return visibleReleases();
          },
          children: (release, idx) => createComponent(ChangelogCard, {
            release,
            get isLatest() {
              return idx() === 0;
            }
          })
        }), null);
        insert(_el$3, createComponent(ChangelogFooter, {
          get loadedCount() {
            return visibleReleases().length;
          },
          get totalCount() {
            return releases.length;
          },
          get hasMore() {
            return hasMore();
          },
          onLoadMore: handleLoadMore,
          onOpenWeb: handleOpenBrowser
        }), null);
        createRenderEffect((_$p) => style(_el$2, {
          ...position()
        }, _$p));
        return _el$2;
      })()];
    }
  });
}
delegateEvents(["mousedown"]);
export {
  ChangelogPopover as default
};
