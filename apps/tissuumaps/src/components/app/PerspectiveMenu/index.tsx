import { CheckIcon, PanelsTopLeftIcon } from "lucide-react";

import { IconButton } from "@/components/common/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pluginRegistry } from "@/plugins";
import { useAppStore } from "@/stores/app";

export type PerspectiveMenuProps = {
  className?: string;
};

/**
 * The menu for switching between the perspectives of the registered plugins
 * and the generic user interface, shown while any plugin has a perspective
 *
 * Picking a perspective mounts its plugin and hides the built-in panels it
 * hides; picking "Generic" unmounts the active perspective's plugin and shows
 * all built-in panels again. The project is never changed.
 */
export function PerspectiveMenu({ className }: PerspectiveMenuProps) {
  const plugins = useAppStore((state) => state.plugins);
  const activePerspectiveId = useAppStore((state) => state.activePerspectiveId);
  const setActivePerspectiveId = useAppStore(
    (state) => state.setActivePerspectiveId,
  );

  const perspectives = [...plugins]
    .filter(([, plugin]) => plugin.perspective !== undefined)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (perspectives.length === 0) {
    return null;
  }

  const checkIcon = (active: boolean) =>
    active ? <CheckIcon /> : <span className="size-4" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="Perspective" size="icon" className={className} />
        }
      >
        <PanelsTopLeftIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Perspective</DropdownMenuLabel>
          {perspectives.map(([pluginId, plugin]) => (
            <DropdownMenuItem
              key={pluginId}
              onClick={() => {
                setActivePerspectiveId(pluginId);
                pluginRegistry.mountPlugin(pluginId);
              }}
            >
              {checkIcon(activePerspectiveId === pluginId)}
              {plugin.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              setActivePerspectiveId(null);
              if (activePerspectiveId !== null) {
                pluginRegistry.unmountPlugin(activePerspectiveId);
              }
            }}
          >
            {checkIcon(activePerspectiveId === null)}
            Generic
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
