/**
 * The InSituPy viewer as a TissUUmaps plugin (see
 * docs/perspective-prototype-spec.md)
 *
 * The module's default export is the plugin, so that the app can load it
 * through "Load plugin from URL". Included in a page as a module script, it
 * registers itself, as described in docs/development/plugins.md.
 */
import { createRoot } from "react-dom/client";

import type { Plugin, PluginRegistry } from "@tissuumaps/core";

import css from "./plugin.css?inline";

declare global {
  interface Window {
    /** The TissUUmaps plugin registry, once the app has started up */
    tissuumaps?: PluginRegistry;
  }
}

/** The plugin's ID, also the suffix of its panel's ID */
export const pluginId = "insitupy";

const plugin: Plugin = {
  id: pluginId,
  name: "InSituPy",
  setup: () => {
    const style = document.createElement("style");
    style.dataset["plugin"] = pluginId;
    style.textContent = css;
    document.head.append(style);
    return () => style.remove();
  },
  mount: (container) => {
    const root = createRoot(container);
    root.render(
      <div className="insitupy-plugin p-3 text-sm">InSituPy plugin loaded</div>,
    );
    return () => root.unmount();
  },
};

export default plugin;

if (window.tissuumaps !== undefined) {
  window.tissuumaps.registerPlugin(plugin);
} else {
  window.addEventListener(
    "tissuumaps-loaded",
    () => window.tissuumaps?.registerPlugin(plugin),
    { once: true },
  );
}
