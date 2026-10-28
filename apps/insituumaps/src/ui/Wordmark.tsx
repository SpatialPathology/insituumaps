import { cn } from "@/lib/utils";

/**
 * Text wordmark in the InSituPy logo colours until the logo graphic exists
 * (D26): "InSitU" in navy, "Umaps" in the logo red, so that the "UU" of
 * TissUUmaps joins the two parts
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-semibold tracking-tight whitespace-nowrap",
        className,
      )}
    >
      <span className="text-primary">InSitU</span>
      <span className="text-brand-red">Umaps</span>
    </span>
  );
}
