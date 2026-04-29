import { api, type UpdateCheckResult } from "../api";

interface Props {
  result: UpdateCheckResult;
  /** Open Settings → Updates so the user can review notes + install. */
  onOpenSettings: () => void;
  /** Dismiss this version locally so we don't nag again until v+1. */
  onDismiss: () => void;
}

/**
 * Slim banner rendered above the active timer bar when the periodic
 * background check finds a new version the user hasn't already
 * dismissed. No download path here on purpose — clicking "Update" sends
 * the user to Settings → Updates, which already handles the
 * stop-timer-before-quit safeguard from v0.4.14. The banner's only job
 * is to *notify*.
 */
export function UpdateBanner({
  result,
  onOpenSettings,
  onDismiss,
}: Props): JSX.Element | null {
  if (!result.hasUpdate || !result.latestVersion) return null;

  return (
    <div className="flex items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-100">
      <span className="text-base">✨</span>
      <div className="min-w-0 flex-1">
        <span className="font-medium">
          Version {result.latestVersion} is available
        </span>
        <span className="text-emerald-100/60">
          {" "}
          · you're on {result.currentVersion}
        </span>
      </div>
      {result.releaseUrl ? (
        <button
          type="button"
          className="shrink-0 text-[11px] text-emerald-100/70 hover:text-emerald-100"
          onClick={() => api.app.openExternal(result.releaseUrl!)}
          title="Open release notes on GitHub"
        >
          Notes
        </button>
      ) : null}
      <button
        type="button"
        className="shrink-0 rounded-md border border-emerald-400/50 bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-emerald-50 hover:bg-emerald-500/30"
        onClick={onOpenSettings}
      >
        Update
      </button>
      <button
        type="button"
        className="shrink-0 text-[11px] text-emerald-100/60 hover:text-emerald-100"
        onClick={onDismiss}
        title="Don't notify me about this version again"
      >
        Later
      </button>
    </div>
  );
}
