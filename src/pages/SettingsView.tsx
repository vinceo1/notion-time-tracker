import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  api,
  type AppConfig,
  type DbPairing,
  type NotionUser,
  type TaskType,
} from "../api";

// Space reserved on macOS for the hidden-inset traffic-light buttons.
const MAC_TRAFFIC_LIGHT_PX = 78;

const ALL_TYPES: TaskType[] = [
  "To do List",
  "Scorecard",
  "Weekly Report",
  "Time Tracking Tasks",
];

interface Props {
  config: AppConfig;
  onSaved: (next: AppConfig) => void;
  onClose: () => void;
}

export function SettingsView({ config, onSaved, onClose }: Props): JSX.Element {
  const [tokenInput, setTokenInput] = useState(config.notionToken);
  const [teamMemberId, setTeamMemberId] = useState(config.teamMemberId ?? "");
  const [parentUrl, setParentUrl] = useState(config.workSessionsParentUrl);
  const [typeFilter, setTypeFilter] = useState<TaskType[]>(config.typeFilter);
  const [pairings, setPairings] = useState<DbPairing[]>(config.pairings);

  const [users, setUsers] = useState<NotionUser[]>([]);
  const [usersLoading, setUsersLoading] = useState<boolean>(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [discoverLoading, setDiscoverLoading] = useState<boolean>(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discoverWarnings, setDiscoverWarnings] = useState<string[]>([]);

  const [saving, setSaving] = useState<boolean>(false);

  const tokenChanged = tokenInput !== config.notionToken;

  async function saveTokenFirst() {
    if (!tokenChanged) return;
    await api.config.set({ notionToken: tokenInput });
  }

  async function handleLoadUsers() {
    setUsersLoading(true);
    setUsersError(null);
    try {
      await saveTokenFirst();
      const list = await api.notion.listUsers();
      setUsers(list);
      if (!teamMemberId && list.length > 0) {
        // Default to Victor if found
        const victor = list.find((u) => u.name.toLowerCase().startsWith("victor"));
        if (victor) setTeamMemberId(victor.id);
      }
    } catch (err) {
      setUsersError((err as Error).message ?? "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleDiscover() {
    setDiscoverLoading(true);
    setDiscoverError(null);
    setDiscoverWarnings([]);
    try {
      await saveTokenFirst();
      if (parentUrl !== config.workSessionsParentUrl) {
        await api.config.set({ workSessionsParentUrl: parentUrl });
      }
      const result = await api.notion.discover();
      setPairings(result.pairings);
      setDiscoverWarnings(result.warnings);
    } catch (err) {
      setDiscoverError((err as Error).message ?? "Failed to discover databases");
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const next = await api.config.set({
        notionToken: tokenInput,
        teamMemberId: teamMemberId || null,
        workSessionsParentUrl: parentUrl,
        typeFilter,
        pairings,
      });
      onSaved(next);
    } finally {
      setSaving(false);
    }
  }

  function toggleType(t: TaskType) {
    setTypeFilter((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t],
    );
  }

  // Preload users if token already set
  useEffect(() => {
    if (config.notionToken && users.length === 0) {
      handleLoadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canSave =
    tokenInput.trim().length > 0 && pairings.length > 0;

  const isMac = api.platform === "darwin";

  return (
    <div className="flex h-full flex-col bg-bg text-white">
      <header
        className="drag-region sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-bg-border bg-bg/90 py-3 pr-6 backdrop-blur"
        style={{ paddingLeft: isMac ? MAC_TRAFFIC_LIGHT_PX : 24 }}
      >
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">Settings</h1>
          <p className="truncate text-[11px] text-white/50">
            Stored locally on this device — never in the repo.
          </p>
        </div>
        <div className="no-drag flex shrink-0 gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!canSave || saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          <Section
            title="1. Notion integration token"
            description="Create at https://www.notion.so/profile/integrations and paste the Internal Integration Secret."
          >
            <input
              type="password"
              className="input font-mono"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="ntn_..."
              spellCheck={false}
            />
          </Section>

          <Section
            title="2. Your Notion user"
            description="Every saved session is attributed to this person."
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={handleLoadUsers}
                  disabled={usersLoading || tokenInput.trim().length === 0}
                >
                  {usersLoading
                    ? "Loading…"
                    : users.length > 0
                      ? "Refresh people list"
                      : "Load people from workspace"}
                </button>
              </div>
              {usersError ? (
                <div className="text-xs text-red-300">{usersError}</div>
              ) : null}
              {users.length > 0 ? (
                <select
                  className="input"
                  value={teamMemberId}
                  onChange={(e) => setTeamMemberId(e.target.value)}
                >
                  <option value="">— Select a person —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.email ? ` (${u.email})` : ""}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </Section>

          <Section
            title="3. Work Sessions parent page"
            description="The app reads the sub-databases inside this page and auto-pairs each with its Tasks database."
          >
            <div className="flex flex-col gap-2">
              <input
                className="input"
                value={parentUrl}
                onChange={(e) => setParentUrl(e.target.value)}
                placeholder="https://www.notion.so/.../Work-Sessions-..."
                spellCheck={false}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={handleDiscover}
                  disabled={discoverLoading || tokenInput.trim().length === 0}
                >
                  {discoverLoading ? "Discovering…" : "Discover databases"}
                </button>
              </div>
              {discoverError ? (
                <div className="text-xs text-red-300">{discoverError}</div>
              ) : null}
              {discoverWarnings.length > 0 ? (
                <ul className="space-y-1 text-[11px] text-amber-300/80">
                  {discoverWarnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              ) : null}
              {pairings.length > 0 ? (
                <div className="mt-2 flex flex-col gap-1 rounded-md border border-bg-border bg-bg-elev p-3">
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-white/40">
                    {pairings.length} teamspace{pairings.length === 1 ? "" : "s"} connected
                  </div>
                  {pairings.map((p) => (
                    <div
                      key={p.workSessionDbId}
                      className="flex items-center justify-between text-xs text-white/70"
                    >
                      <span className="font-medium text-white/90">
                        {p.label}
                      </span>
                      <span className="text-white/40">
                        Tasks → Sessions paired
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>

          <Section
            title="4. Task type filter (optional)"
            description="Leave empty to show all task types. Pick one or more to narrow the list."
          >
            <div className="flex flex-wrap gap-2">
              {ALL_TYPES.map((t) => {
                const active = typeFilter.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleType(t)}
                    className={clsx(
                      "rounded-full border px-3 py-1 text-xs transition",
                      active
                        ? "border-white bg-white text-black"
                        : "border-bg-border bg-bg-elev text-white/70 hover:border-white/30 hover:text-white",
                    )}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </Section>

          <UpdatesSection />
        </div>
      </div>
    </div>
  );
}

function UpdatesSection(): JSX.Element {
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<
    import("../api").UpdateCheckResult | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{
    bytesDownloaded: number;
    totalBytes: number | null;
  } | null>(null);

  useEffect(() => {
    api.app.version().then(setVersion).catch(() => setVersion("—"));
  }, []);

  // Subscribe to download progress events. The cleanup fn is returned by
  // the preload bridge so we don't leak listeners when Settings closes.
  useEffect(() => {
    return api.updater.onProgress((p) => setProgress(p));
  }, []);

  async function handleCheck() {
    setChecking(true);
    setError(null);
    setResult(null);
    setDownloadedPath(null);
    try {
      const r = await api.updater.check();
      setResult(r);
    } catch (err) {
      setError((err as Error).message ?? String(err));
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    if (!result?.downloadUrl) return;
    setDownloading(true);
    setError(null);
    setDownloadedPath(null);
    setInstalling(false);
    setProgress({ bytesDownloaded: 0, totalBytes: null });
    try {
      const r = await api.updater.download(result.downloadUrl);
      if (r.ok) {
        setDownloadedPath(r.filepath);
        if (r.installing) setInstalling(true);
      } else {
        setError(r.error);
      }
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  return (
    <Section
      title="5. Updates"
      description="Check GitHub for a newer release. Your Notion token and settings are preserved across installs."
    >
      <div className="flex flex-col gap-2">
        <div className="text-xs text-white/60">
          Current version: <span className="font-mono text-white/90">{version || "…"}</span>
        </div>
        <button
          type="button"
          className="btn self-start"
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? "Checking…" : "Check for updates"}
        </button>

        {error ? (
          <div className="flex flex-col items-start gap-2">
            <div className="text-xs text-red-300">{error}</div>
            {result?.downloadUrl ? (
              <button
                type="button"
                className="btn"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? "Downloading…" : "Retry download"}
              </button>
            ) : null}
          </div>
        ) : null}

        {result && result.reason === "no_releases" ? (
          <div className="text-xs text-white/50">
            No releases published yet on GitHub. Push a version tag (e.g. <span className="font-mono">v0.3.0</span>) to trigger a build — see the repo's release workflow.
          </div>
        ) : null}

        {result && result.reason === "ok" && !result.hasUpdate ? (
          <div className="text-xs text-emerald-300">
            You're on the latest version.
          </div>
        ) : null}

        {result && result.reason === "ok" && result.hasUpdate ? (
          <div className="mt-1 flex flex-col gap-2 rounded-md border border-white/10 bg-bg-elev p-3">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-medium text-white">
                Version {result.latestVersion} available
              </div>
              <div className="text-[11px] text-white/40">
                you're on {result.currentVersion}
              </div>
            </div>
            {result.downloadUrl ? (
              installing ? (
                <div className="text-xs text-emerald-300">
                  Installing v{result.latestVersion}… the app will quit and
                  relaunch on the new version in a moment.
                </div>
              ) : downloadedPath ? (
                <div className="text-xs text-emerald-300">
                  Saved to <span className="font-mono">{downloadedPath}</span>.
                  The installer opened — drag the app into Applications to
                  finish the update.
                </div>
              ) : downloading ? (
                <DownloadProgressBar progress={progress} />
              ) : (
                <button
                  type="button"
                  className="btn btn-primary self-start"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  Download &amp; install
                </button>
              )
            ) : (
              <div className="text-xs text-amber-300">
                Release doesn't include an installer for your platform yet.
              </div>
            )}
            {result.releaseUrl ? (
              <button
                type="button"
                className="btn-ghost self-start text-xs"
                onClick={() => api.app.openExternal(result.releaseUrl!)}
              >
                View release notes
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function DownloadProgressBar({
  progress,
}: {
  progress: { bytesDownloaded: number; totalBytes: number | null } | null;
}): JSX.Element {
  const bytes = progress?.bytesDownloaded ?? 0;
  const total = progress?.totalBytes ?? null;
  const pct = total && total > 0 ? Math.min(100, (bytes / total) * 100) : null;
  const label =
    total !== null
      ? `${formatMB(bytes)} / ${formatMB(total)}`
      : `${formatMB(bytes)} downloaded…`;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-white transition-[width] duration-150"
          style={{ width: pct !== null ? `${pct}%` : "30%" }}
        />
      </div>
      <div className="text-[11px] text-white/60">
        Downloading… {label}
        {pct !== null ? ` (${pct.toFixed(0)}%)` : ""}
      </div>
    </div>
  );
}

function formatMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="mb-3 text-xs text-white/50">{description}</p>
      ) : null}
      {children}
    </section>
  );
}
