import { useEffect, useState } from "react";
import { api, type AppConfig } from "./api";
import { SettingsView } from "./pages/SettingsView";
import { TasksView } from "./pages/TasksView";

type View = "loading" | "tasks" | "settings";

export default function App(): JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    api.config.get().then((cfg) => {
      setConfig(cfg);
      // First-run: no token or no pairings → send to settings
      setView(!cfg.notionToken || cfg.pairings.length === 0 ? "settings" : "tasks");
    });
  }, []);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-white/50">
        Loading…
      </div>
    );
  }

  if (view === "settings") {
    return (
      <SettingsView
        config={config}
        onSaved={(next) => {
          setConfig(next);
          setView("tasks");
        }}
        onClose={() =>
          setView(config.notionToken && config.pairings.length > 0 ? "tasks" : "settings")
        }
      />
    );
  }

  return (
    <TasksView
      config={config}
      onOpenSettings={() => setView("settings")}
    />
  );
}
