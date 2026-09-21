export function basenameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface StatusOptions {
  filePath: string | null;
  dirty: boolean;
  hasBeenSaved: boolean;
  defaultFilename: string;
}

export function updateDesktopStatus({
  filePath,
  dirty,
  hasBeenSaved,
  defaultFilename,
}: StatusOptions): void {
  const status = document.getElementById("desktop-status");
  const dot = status?.querySelector(".desktop-status-dot");
  const label = status?.querySelector(".desktop-status-label");
  const filename = status?.querySelector(".desktop-status-filename");
  if (!status || !dot || !label || !filename) return;

  const state = !hasBeenSaved ? "never-saved" : dirty ? "unsaved" : "saved";
  dot.className = `desktop-status-dot ${state}`;
  label.textContent = !hasBeenSaved
    ? "Never saved"
    : dirty
      ? "Unsaved changes"
      : "Saved";
  filename.textContent = filePath ? basenameOf(filePath) : defaultFilename;
}

export function showDesktopStatus(message: string): void {
  const status = document.getElementById("desktop-status");
  const label = status?.querySelector(".desktop-status-label");
  const filename = status?.querySelector(".desktop-status-filename");
  const dot = status?.querySelector(".desktop-status-dot");
  if (!status || !label || !filename || !dot) return;

  label.textContent = message;
  filename.textContent = "";
  dot.className = "desktop-status-dot";
  console.error(message);
}
