import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAppStore } from "@/state/store";

export function Notices() {
  const notices = useAppStore((s) => s.notices);
  const dismiss = useAppStore((s) => s.dismissNotice);
  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-30 flex w-80 flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          role={notice.severity === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-sm shadow-md",
            notice.severity === "error" &&
              "border-red-200 bg-red-50 text-red-900",
            notice.severity === "warning" &&
              "border-amber-200 bg-amber-50 text-amber-900",
            notice.severity === "info" &&
              "border-zinc-200 bg-white text-zinc-800",
          )}
        >
          <span className="flex-1 break-words">{notice.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(notice.id)}
            className="rounded p-0.5 hover:bg-black/5"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
