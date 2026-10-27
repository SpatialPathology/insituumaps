import { FolderOpen, Globe } from "lucide-react";
import { useState } from "react";

import { useAppStore } from "@/state/store";

import { Button, Spinner, TextInput } from "./controls";

const supportsDirectoryPicker =
  typeof window !== "undefined" && "showDirectoryPicker" in window;

export function StartScreen() {
  const openUrl = useAppStore((s) => s.openUrl);
  const openDirectory = useAppStore((s) => s.openDirectory);
  const openStatus = useAppStore((s) => s.openStatus);
  const projectStatus = useAppStore((s) => s.projectStatus);
  const source = useAppStore((s) => s.source);
  const [url, setUrl] = useState(source?.kind === "url" ? source.label : "");

  const submit = () => {
    if (url.trim() !== "") {
      void openUrl(url.trim());
    }
  };
  const pickDirectory = async () => {
    try {
      const handle = await (
        window as unknown as {
          showDirectoryPicker: (
            options?: object,
          ) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: "read" });
      await openDirectory(handle);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  };
  const loading =
    openStatus.phase === "loading" || projectStatus.phase === "loading";
  const error =
    openStatus.phase === "error"
      ? openStatus.message
      : projectStatus.phase === "error"
        ? projectStatus.message
        : null;

  return (
    <div className="flex flex-1 items-start justify-center overflow-auto bg-zinc-100 p-8">
      <div className="w-full max-w-xl rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">
          Open a sample or an experiment
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          InSitUUmaps shows InSituPy projects (one sample) and experiments (many
          samples) directly from their folders. Nothing is uploaded; the browser
          reads only what is shown.
        </p>
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label
            htmlFor="source-url"
            className="mb-1 block text-sm font-medium"
          >
            Web address of the project or experiment folder
          </label>
          <div className="flex gap-2">
            <TextInput
              id="source-url"
              type="url"
              value={url}
              onChange={setUrl}
              placeholder="https://example.org/data/experiment/"
              className="h-9"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={loading || url.trim() === ""}
            >
              {loading ? (
                <Spinner className="border-white border-t-transparent" />
              ) : (
                <Globe className="size-4" />
              )}
              Open
            </Button>
          </div>
        </form>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200" />
          <span className="text-xs text-zinc-400">or</span>
          <div className="h-px flex-1 bg-zinc-200" />
        </div>
        <div className="mt-4">
          <Button
            onClick={() => void pickDirectory()}
            size="md"
            disabled={!supportsDirectoryPicker || loading}
          >
            <FolderOpen className="size-4" /> Open a folder on this computer
          </Button>
          {!supportsDirectoryPicker && (
            <p className="mt-1 text-xs text-zinc-500">
              Opening local folders needs a Chromium-based browser (Chrome,
              Edge); other browsers can open web addresses.
            </p>
          )}
        </div>
        {loading && (
          <p className="mt-4 flex items-center gap-2 text-sm text-zinc-600">
            <Spinner />
            {openStatus.phase === "loading"
              ? openStatus.message
              : projectStatus.phase === "loading"
                ? projectStatus.message
                : "Loading"}
          </p>
        )}
        {error !== null && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">Could not open the data</p>
            <p className="mt-1 break-words">{error}</p>
          </div>
        )}
        <p className="mt-6 text-xs text-zinc-500">
          A link can carry the folder and the view, e.g.
          <code className="ml-1 rounded bg-zinc-100 px-1">
            ?source=…&amp;sample=0&amp;color=gene:EPCAM
          </code>
        </p>
      </div>
    </div>
  );
}
