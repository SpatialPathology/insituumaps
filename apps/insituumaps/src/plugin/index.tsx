/**
 * The InSituPy viewer as a TissUUmaps plugin (see
 * docs/lens-prototype-spec.md)
 *
 * Setting the plugin up registers its data providers and its project importer
 * and starts copying the fork store's model into the app's project store;
 * mounting it shows the start screen or the sidebar sections in the plugin's
 * panel. The plugin is also a lens for the importer's projects, which
 * hides the generic panels. In an app without project importers, the plugin
 * opens a `source` GET parameter itself.
 *
 * The module's default export is the plugin, so that the app can load it
 * through "Load plugin from URL". Included in a page as a module script, it
 * registers itself, as described in docs/development/plugins.md.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { Plugin, PluginRegistry, PluginStores } from "@tissuumaps/core";

import { useAppStore as insitupyStore } from "@/state/store";
import { readStateFromUrl } from "@/state/url";

import { PluginRoot } from "./PluginRoot";
import { startProjectBridge } from "./bridge";
import { insitupyImporter, insitupyImporterId } from "./importer";
import css from "./plugin.css?inline";
import { registerDataProviders } from "./providers";

declare global {
  interface Window {
    /** The TissUUmaps plugin registry, once the app has started up */
    tissuumaps?: PluginRegistry;
    /** The fork store and the app's stores, for the console and smoke tests */
    insitupyPlugin?: {
      insitupyStore: typeof insitupyStore;
      stores: PluginStores;
    };
  }
}

/** The plugin's ID, also the suffix of its panel's ID */
export const pluginId = "insitupy";

const plugin: Plugin = {
  id: pluginId,
  name: "InSituPy",
  // replaces the generic panels for the projects of the InSituPy importer
  lens: {
    appliesTo: [insitupyImporterId],
    hiddenPanels: ["images", "labels", "points", "shapes", "tables"],
  },
  setup: (stores) => {
    const style = document.createElement("style");
    style.dataset["plugin"] = pluginId;
    style.textContent = css;
    document.head.append(style);
    registerDataProviders(stores);
    const stopBridge = startProjectBridge(stores);
    window.insitupyPlugin = { insitupyStore, stores };

    // an app with project importers opens datasets itself, also the one named
    // in the URL; older apps leave that to the plugin
    const app = stores.appStore.getState();
    const appImportsDatasets = "registerProjectImporter" in app;
    if (appImportsDatasets) {
      app.registerProjectImporter(insitupyImporter);
    }

    // a dataset named in the URL is opened and shown right away
    const { source } = readStateFromUrl();
    if (
      !appImportsDatasets &&
      source !== undefined &&
      insitupyStore.getState().source === null
    ) {
      void insitupyStore.getState().openUrl(source);
      // the plugin is only registered once setup has returned
      queueMicrotask(() => window.tissuumaps?.mountPlugin(pluginId));
    }

    return () => {
      stopBridge();
      delete window.insitupyPlugin;
      style.remove();
    };
  },
  mount: (container) => {
    const root = createRoot(container);
    root.render(
      <StrictMode>
        <PluginRoot />
      </StrictMode>,
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
