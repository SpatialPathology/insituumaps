import { useEffect } from "react";

import { useAppStore } from "@/state/store";
import { readStateFromUrl } from "@/state/url";
import { Header } from "@/ui/Header";
import { Notices } from "@/ui/Notices";
import { SampleBrowser } from "@/ui/SampleBrowser";
import { Sidebar } from "@/ui/Sidebar";
import { StartScreen } from "@/ui/StartScreen";
import { ViewerPanel } from "@/ui/ViewerPanel";

export function App() {
  const source = useAppStore((s) => s.source);
  const openStatus = useAppStore((s) => s.openStatus);
  const project = useAppStore((s) => s.project);
  const openUrl = useAppStore((s) => s.openUrl);

  // open the source named in the URL on start
  useEffect(() => {
    const { source: url } = readStateFromUrl();
    if (url !== undefined && useAppStore.getState().source === null) {
      void openUrl(url);
    }
  }, [openUrl]);

  const showStart =
    source === null ||
    openStatus.phase === "error" ||
    (project === null && openStatus.phase !== "ready");

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="relative flex min-h-0 flex-1">
        {showStart ? (
          <StartScreen />
        ) : (
          <>
            <Sidebar />
            <ViewerPanel />
          </>
        )}
        <SampleBrowser />
        <Notices />
      </div>
    </div>
  );
}
