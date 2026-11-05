import type { DockviewApi } from "dockview-react";
import { useEffect } from "react";

import { PanelId, getPluginPanelId } from "@/panels";
import { useAppStore } from "@/stores/app";

/**
 * Keeps the built-in panels in the dockview layout in sync with the active
 * lens (see `Plugin.lens`)
 *
 * While a lens is active, the built-in panels it hides are removed from
 * the layout and its plugin's panel is made active. Panels that are no longer
 * hidden are added back to the group they share with the other panels, at
 * their original position among the built-in panels, using the
 * `PersistentPanelHeader` tab component.
 *
 * @param dockviewApi - The API of the ready dockview, or `null` while it is not
 * ready yet
 * @param builtInPanels - The built-in panels that a lens may hide, in
 * their original order
 */
export function useLensPanels(
  dockviewApi: DockviewApi | null,
  builtInPanels: readonly { id: string; title: string; component: string }[],
): void {
  const activeLensId = useAppStore((state) => state.activeLensId);
  // joined, so that the selector returns a value that compares by content
  const hiddenPanelIds = useAppStore((state) =>
    state.activeLensId === null
      ? ""
      : (state.plugins.get(state.activeLensId)?.lens?.hiddenPanels ?? []).join(
          "\n",
        ),
  );
  const setActivePanelId = useAppStore((state) => state.setActivePanelId);

  useEffect(() => {
    if (dockviewApi === null) {
      return;
    }
    const hidden = new Set(hiddenPanelIds.split("\n"));
    for (const { id } of builtInPanels) {
      const dockviewPanel = dockviewApi.getPanel(id);
      if (hidden.has(id) && dockviewPanel !== undefined) {
        dockviewApi.removePanel(dockviewPanel);
      }
    }
    builtInPanels.forEach((definition, index) => {
      if (hidden.has(definition.id) || dockviewApi.getPanel(definition.id)) {
        return;
      }
      const referenceGroup = dockviewApi.panels.find(
        (dockviewPanel) => dockviewPanel.id !== PanelId.viewer,
      )?.group;
      const precedingCount = builtInPanels
        .slice(0, index)
        .filter(
          ({ id }) => dockviewApi.getPanel(id)?.group === referenceGroup,
        ).length;
      dockviewApi.addPanel({
        ...definition,
        tabComponent: "PersistentPanelHeader",
        inactive: true,
        ...(referenceGroup !== undefined
          ? { position: { referenceGroup, index: precedingCount } }
          : {
              initialWidth: 420,
              position: { referencePanel: PanelId.viewer, direction: "right" },
            }),
      });
    });
    if (activeLensId !== null) {
      setActivePanelId(getPluginPanelId(activeLensId));
    }
  }, [
    dockviewApi,
    builtInPanels,
    hiddenPanelIds,
    activeLensId,
    setActivePanelId,
  ]);
}
