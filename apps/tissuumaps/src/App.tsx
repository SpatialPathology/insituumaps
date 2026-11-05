import {
  type DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import { Moon, Sun } from "lucide-react";
import { type ReactNode, useLayoutEffect, useState } from "react";

import { IconButton } from "@/components/common/icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useActivePanelSync } from "@/hooks/useActivePanelSync";
import { useFileDragTracking } from "@/hooks/useFileDrag";
import { useLensPanels } from "@/hooks/useLensPanels";
import { usePluginPanels } from "@/hooks/usePluginPanels";

import "./App.css";
import { LensMenu } from "./components/app/LensMenu";
import { NotificationCenter } from "./components/app/NotificationCenter";
import { PanelDropTarget } from "./components/app/PanelDropTarget";
import { PluginMenu } from "./components/app/PluginMenu";
import { DialogProvider } from "./components/dialogs/DialogProvider";
import { ImagesPanel } from "./components/panels/ImagesPanel";
import { LabelsPanel } from "./components/panels/LabelsPanel";
import { PluginPanel } from "./components/panels/PluginPanel";
import { PointsPanel } from "./components/panels/PointsPanel";
import { ProjectPanel } from "./components/panels/ProjectPanel";
import { ShapesPanel } from "./components/panels/ShapesPanel";
import { TablesPanel } from "./components/panels/TablesPanel";
import { ViewerPanel } from "./components/panels/ViewerPanel";
import { PanelId } from "./panels";
import { pluginRegistry } from "./plugins";
import { useSettingsStore } from "./stores/settings";

/** The Tailwind CSS-styled dockview theme defined in `dockview.css` */
const dockviewTheme: DockviewTheme = {
  name: "tailwindcss",
  className: "dockview-theme-tailwindcss",
};

/**
 * Scrolls a panel's content within the panel, rather than letting it overflow
 *
 * The spacing around the content is padding rather than the content's own
 * margin, which a scroll container would cut off at its bottom end. Scrolling
 * one axis makes the browser scroll the other one too unless it is hidden, and
 * the widgets that are too wide for a panel scroll horizontally by themselves.
 */
function ScrollablePanelContent({ children }: { children: ReactNode }) {
  return (
    <div className="size-full overflow-x-hidden overflow-y-auto p-2">
      {children}
    </div>
  );
}

/** The panels that can be shown in the dockview layout, by component name */
const dockviewComponents = {
  ViewerPanel: () => <ViewerPanel className="size-full" />,
  ProjectPanel: () => (
    <PanelDropTarget panelId={PanelId.project} variant="content">
      <ScrollablePanelContent>
        <ProjectPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  ImagesPanel: () => (
    <PanelDropTarget panelId={PanelId.images} variant="content">
      <ScrollablePanelContent>
        <ImagesPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  LabelsPanel: () => (
    <PanelDropTarget panelId={PanelId.labels} variant="content">
      <ScrollablePanelContent>
        <LabelsPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  PointsPanel: () => (
    <PanelDropTarget panelId={PanelId.points} variant="content">
      <ScrollablePanelContent>
        <PointsPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  ShapesPanel: () => (
    <PanelDropTarget panelId={PanelId.shapes} variant="content">
      <ScrollablePanelContent>
        <ShapesPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  TablesPanel: () => (
    <PanelDropTarget panelId={PanelId.tables} variant="content">
      <ScrollablePanelContent>
        <TablesPanel />
      </ScrollablePanelContent>
    </PanelDropTarget>
  ),
  PluginPanel: (props: IDockviewPanelProps<{ pluginId: string }>) => (
    <ScrollablePanelContent>
      <PluginPanel pluginId={props.params.pluginId} />
    </ScrollablePanelContent>
  ),
};

/**
 * The tab headers available to panels, by component name: one that lets the
 * user close the panel, one for panels that are always shown, and one for the
 * panels contributed by plugins, whose close button unmounts the plugin
 */
const dockviewTabComponents = {
  ClosablePanelHeader: (props: IDockviewPanelHeaderProps) => {
    return <DockviewDefaultTab hideClose={false} {...props} />;
  },
  PersistentPanelHeader: (props: IDockviewPanelHeaderProps) => {
    return (
      <PanelDropTarget panelId={props.api.id} variant="tab">
        <DockviewDefaultTab hideClose={true} {...props} />
      </PanelDropTarget>
    );
  },
  PluginPanelHeader: (
    props: IDockviewPanelHeaderProps<{ pluginId: string }>,
  ) => {
    return (
      <DockviewDefaultTab
        {...props}
        hideClose={false}
        closeActionOverride={() =>
          pluginRegistry.unmountPlugin(props.params.pluginId)
        }
      />
    );
  },
};

/**
 * The lens menu, the plugins menu and the dark mode toggle shown at the
 * right end of the dockview tab bar
 */
function DockviewRightHeaderActionsComponent() {
  const dark = useSettingsStore((state) => state.dark);
  const setDark = useSettingsStore((state) => state.setDark);
  return (
    <div className="flex">
      <LensMenu />
      <PluginMenu />
      <IconButton
        label={dark ? "Light mode" : "Dark mode"}
        variant="default"
        size="icon"
        onClick={() => setDark(!dark)}
      >
        {dark ? <Sun /> : <Moon />}
      </IconButton>
    </div>
  );
}

/**
 * The built-in panels shown in the group to the right of the viewer, in their
 * initial order
 *
 * Lenses can hide some of them, see `useLensPanels`.
 */
const builtInPanels = [
  { id: PanelId.project, title: "Project", component: "ProjectPanel" },
  { id: PanelId.images, title: "Images", component: "ImagesPanel" },
  { id: PanelId.labels, title: "Labels", component: "LabelsPanel" },
  { id: PanelId.points, title: "Points", component: "PointsPanel" },
  { id: PanelId.shapes, title: "Shapes", component: "ShapesPanel" },
  { id: PanelId.tables, title: "Tables", component: "TablesPanel" },
];

/**
 * Creates the application's initial panel layout
 *
 * The viewer panel fills the window; its group is locked and its header hidden,
 * so that it cannot be closed or moved. All other panels share a group to its
 * right, with the project panel active.
 *
 * @param event - The event carrying the API of the ready dockview
 */
const onDockviewReady = (event: DockviewReadyEvent) => {
  const viewerPanel = event.api.addPanel({
    id: PanelId.viewer,
    title: "Viewer",
    component: "ViewerPanel",
  });
  viewerPanel.group.header.hidden = true;
  viewerPanel.group.locked = true;
  const [projectPanelDefinition, ...otherPanelDefinitions] = builtInPanels;
  const projectPanel = event.api.addPanel({
    ...projectPanelDefinition!,
    tabComponent: "PersistentPanelHeader",
    initialWidth: 420,
    position: {
      referencePanel: viewerPanel,
      direction: "right",
    },
  });
  for (const definition of otherPanelDefinitions) {
    event.api.addPanel({
      ...definition,
      tabComponent: "PersistentPanelHeader",
      position: { referenceGroup: projectPanel.group },
    });
  }
  projectPanel.api.setActive();
};

/**
 * The application's root component
 *
 * Renders the dockview layout within the app-level providers, and applies
 * Tailwind CSS's `dark` class to the document element according to the
 * settings store, so that inherited text colors and the popups portalled into
 * the body follow it too.
 */
export function App() {
  const dark = useSettingsStore((state) => state.dark);
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);

  // The panels contributed by plugins join the group of the project panel
  usePluginPanels(dockviewApi, PanelId.project);
  // ...and lenses hide some of the built-in ones (after plugin panels
  // are added, so that the lens's panel exists when it is activated)
  useLensPanels(dockviewApi, builtInPanels);
  useActivePanelSync(dockviewApi);
  useFileDragTracking();

  // Before paint, so that React never renders a light frame in dark mode
  // https://tailwindcss.com/docs/dark-mode
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <TooltipProvider delay={300}>
      <DialogProvider>
        <div className="w-screen h-screen overflow-hidden">
          <DockviewReact
            theme={dockviewTheme}
            components={dockviewComponents}
            tabComponents={dockviewTabComponents}
            rightHeaderActionsComponent={DockviewRightHeaderActionsComponent}
            onReady={(event) => {
              onDockviewReady(event);
              setDockviewApi(event.api);
            }}
          />
          <NotificationCenter />
        </div>
      </DialogProvider>
    </TooltipProvider>
  );
}
