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

export type LensMenuProps = {
  className?: string;
};

/**
 * The menu for switching between the lenses of the registered plugins
 * and the generic user interface, shown while any plugin has a lens
 *
 * Picking a lens mounts its plugin and hides the built-in panels it
 * hides; picking "Generic" unmounts the active lens's plugin and shows
 * all built-in panels again. The project is never changed.
 */
export function LensMenu({ className }: LensMenuProps) {
  const plugins = useAppStore((state) => state.plugins);
  const activeLensId = useAppStore((state) => state.activeLensId);
  const setActiveLensId = useAppStore((state) => state.setActiveLensId);

  const lenses = [...plugins]
    .filter(([, plugin]) => plugin.lens !== undefined)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (lenses.length === 0) {
    return null;
  }

  const checkIcon = (active: boolean) =>
    active ? <CheckIcon /> : <span className="size-4" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton label="Lens" size="icon" className={className} />}
      >
        <PanelsTopLeftIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Lens</DropdownMenuLabel>
          {lenses.map(([pluginId, plugin]) => (
            <DropdownMenuItem
              key={pluginId}
              onClick={() => {
                setActiveLensId(pluginId);
                pluginRegistry.mountPlugin(pluginId);
              }}
            >
              {checkIcon(activeLensId === pluginId)}
              {plugin.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              setActiveLensId(null);
              if (activeLensId !== null) {
                pluginRegistry.unmountPlugin(activeLensId);
              }
            }}
          >
            {checkIcon(activeLensId === null)}
            Generic
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
