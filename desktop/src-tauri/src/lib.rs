mod atomic_write;
mod disk_watch;
mod tab_registry;

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, EventTarget, LogicalPosition, LogicalSize, Manager, WebviewBuilder,
    WebviewUrl, Window, WindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tokio::sync::oneshot;

use disk_watch::{DiskCheck, DiskSnapshot};

pub use tab_registry::{EditorKind, TabInfo, TabRegistry, TabState, TAB_BAR_HEIGHT};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabsPayload {
    pub tabs: Vec<TabInfo>,
    pub active_tab_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabDocument {
    pub tab_id: String,
    pub kind: EditorKind,
    pub path: Option<String>,
    pub content: Option<String>,
    pub has_been_saved: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingBpmnFile {
    pub relative_path: String,
    pub content: String,
}

fn resolve_launch_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }

    let base = std::env::var_os("OPERATON_MODELER_CWD")
        .or_else(|| std::env::var_os("OPERATON_BPMN_CWD"))
        .or_else(|| std::env::var_os("INIT_CWD"))
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok());

    base.map_or(path.clone(), |directory| directory.join(path))
}

fn get_window_logical_size(window: &Window) -> Result<(f64, f64), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let logical = size.to_logical::<f64>(scale);
    Ok((logical.width, logical.height))
}

fn emit_tabs_changed(app: &AppHandle, registry: &TabRegistry) {
    let payload = TabsPayload {
        tabs: registry.get_tab_info_list(),
        active_tab_id: registry.active_tab_id.clone(),
    };
    let _ = app.emit("tabs-changed", payload);
}

/// Height reserved at the top of the window for the tab strip. With a single
/// tab open there is nothing to switch between, so the whole shell bar
/// (tab strip, window controls, Open/New) collapses to give the editor the
/// full window — window controls and Open/New are then only reachable via
/// keyboard shortcuts until a second tab is opened.
fn shell_bar_height(tab_count: usize) -> f64 {
    if tab_count <= 1 {
        0.0
    } else {
        TAB_BAR_HEIGHT
    }
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn pin_shell_gtk_height(app: &AppHandle, bar_height: f64, is_empty: bool) {
    if let Some(shell_wv) = app.get_webview("shell") {
        let _ = shell_wv.with_webview(move |w| {
            use gtk::prelude::*;
            let shell_widget = w.inner();
            if let Some(parent) = shell_widget.parent() {
                if let Ok(vbox) = parent.downcast::<gtk::Box>() {
                    vbox.set_child_packing(
                        &shell_widget,
                        is_empty,
                        true,
                        0,
                        gtk::PackType::Start,
                    );
                }
            }
            let should_be_visible = is_empty || bar_height > 0.0;
            shell_widget.set_visible(should_be_visible);
            let requested_height = if is_empty { -1 } else { bar_height as i32 };
            shell_widget.set_size_request(-1, requested_height);
        });
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
fn pin_shell_gtk_height(_app: &AppHandle, _bar_height: f64, _is_empty: bool) {}

fn do_resize_webviews(app: &AppHandle, window: &Window, registry: &TabRegistry) -> Result<(), String> {
    let (width, height) = get_window_logical_size(window)?;

    if let Some(ref active_id) = registry.active_tab_id {
        let bar_height = shell_bar_height(registry.tabs.len());

        if let Some(shell_wv) = app.get_webview("shell") {
            let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = shell_wv.set_size(LogicalSize::new(width, bar_height));
        }
        pin_shell_gtk_height(app, bar_height, false);

        if let Some(tab) = registry.get_tab_by_id(active_id) {
            if let Some(wv) = app.get_webview(&tab.webview_label) {
                let _ = wv.set_position(LogicalPosition::new(0.0, bar_height));
                let _ = wv.set_size(LogicalSize::new(width, (height - bar_height).max(0.0)));
            }
        }
    } else {
        if let Some(shell_wv) = app.get_webview("shell") {
            let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = shell_wv.set_size(LogicalSize::new(width, height));
        }
        pin_shell_gtk_height(app, height, true);
    }

    Ok(())
}

/// `path`, when given, must already be fully resolved: an absolute,
/// caller-trusted path (a command-line argument, or one picked from a native
/// dialog), or the exact canonical `PathBuf` `TabRegistry::resolve_allowed_path`
/// approved. This function does no further resolution or path-allow
/// checking of its own, so it must never receive a webview-supplied string
/// straight from IPC — the `open_tab` command resolves and checks first.
fn do_open_tab(
    app: &AppHandle,
    path: Option<PathBuf>,
    kind_str: Option<String>,
) -> Result<TabInfo, String> {
    let window = app.get_window("main").ok_or("Main window not found")?;

    let kind = if let Some(ref p) = path {
        EditorKind::from_path(p)
            .ok_or_else(|| format!("Unsupported file extension: {}", p.display()))?
    } else if let Some(k) = kind_str {
        match k.to_lowercase().as_str() {
            "bpmn" => EditorKind::Bpmn,
            "dmn" => EditorKind::Dmn,
            "form" => EditorKind::Form,
            other => return Err(format!("Unknown editor kind: {other}")),
        }
    } else {
        EditorKind::Bpmn
    };

    let (content, disk, has_been_saved) = if let Some(ref p) = path {
        if p.exists() {
            let disk = DiskSnapshot::read(p)
                .map_err(|e| format!("Failed to read {}: {e}", p.display()))?;
            (disk.content().map(str::to_owned), disk, true)
        } else {
            (None, DiskSnapshot::missing(), false)
        }
    } else {
        (None, DiskSnapshot::missing(), false)
    };

    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    // Check for an already-open tab under the same lock that adds the new
    // one, so two overlapping opens of the same path (e.g. a double click
    // on a linked-resource overlay) can't both add a tab.
    if let Some(ref p) = path {
        if let Some(existing) = reg.get_tab_by_path(&p.to_string_lossy()) {
            let existing_id = existing.info.id.clone();
            let existing_info = existing.info.clone();
            drop(reg);
            do_focus_tab(app, &existing_id)?;
            return Ok(existing_info);
        }
    }

    let (tab_id, webview_label) = reg.generate_id();

    let label = if let Some(ref p) = path {
        p.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "diagram".into())
    } else {
        format!("Untitled.{}", kind.default_extension())
    };

    let (width, height) = get_window_logical_size(&window)?;
    let bar_height = shell_bar_height(reg.tabs.len() + 1);

    if let Some(shell_wv) = app.get_webview("shell") {
        let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
        let _ = shell_wv.set_size(LogicalSize::new(width, bar_height));
    }
    pin_shell_gtk_height(app, bar_height, false);

    if let Some(ref prev_id) = reg.active_tab_id {
        if let Some(prev_tab) = reg.get_tab_by_id(prev_id) {
            if let Some(wv) = app.get_webview(&prev_tab.webview_label) {
                let _ = wv.hide();
            }
        }
    }

    let webview_url = WebviewUrl::App(kind.webview_url(&tab_id).into());
    let webview_builder = WebviewBuilder::new(&webview_label, webview_url);
    let child_wv = window
        .add_child(
            webview_builder,
            LogicalPosition::new(0.0, bar_height),
            LogicalSize::new(width, (height - bar_height).max(0.0)),
        )
        .map_err(|e| e.to_string())?;

    let _ = child_wv.show();
    let _ = child_wv.set_focus();

    reg.active_tab_id = Some(tab_id.clone());

    let tab_info = TabInfo {
        id: tab_id.clone(),
        kind,
        file_path: path.map(|p| p.to_string_lossy().into_owned()),
        label,
        dirty: false,
        has_been_saved,
    };

    reg.add_tab(TabState {
        info: tab_info.clone(),
        webview_label,
        initial_content: content,
        disk,
    });

    emit_tabs_changed(app, &reg);

    Ok(tab_info)
}

fn do_focus_tab(app: &AppHandle, target_id: &str) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Main window not found")?;
    let (width, height) = get_window_logical_size(&window)?;

    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let target_tab = reg
        .get_tab_by_id(target_id)
        .ok_or_else(|| format!("Tab {target_id} not found"))?;
    let target_wv_label = target_tab.webview_label.clone();
    let bar_height = shell_bar_height(reg.tabs.len());

    for tab in &reg.tabs {
        if tab.info.id == target_id {
            if let Some(wv) = app.get_webview(&tab.webview_label) {
                let _ = wv.set_position(LogicalPosition::new(0.0, bar_height));
                let _ = wv.set_size(LogicalSize::new(width, (height - bar_height).max(0.0)));
                let _ = wv.show();
                let _ = wv.set_focus();
            }
        } else if let Some(wv) = app.get_webview(&tab.webview_label) {
            let _ = wv.hide();
        }
    }

    if let Some(shell_wv) = app.get_webview("shell") {
        let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
        let _ = shell_wv.set_size(LogicalSize::new(width, bar_height));
    }
    pin_shell_gtk_height(app, bar_height, false);

    reg.active_tab_id = Some(target_id.to_string());
    emit_tabs_changed(app, &reg);

    if let Some(wv) = app.get_webview(&target_wv_label) {
        let _ = wv.set_focus();
    }

    Ok(())
}

fn do_close_tab(app: &AppHandle, tab_id: &str) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Main window not found")?;
    let (width, height) = get_window_logical_size(&window)?;

    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let (removed_tab, next_active) = reg
        .remove_tab(tab_id)
        .ok_or_else(|| format!("Tab {tab_id} not found"))?;

    if let Some(wv) = app.get_webview(&removed_tab.webview_label) {
        let _ = wv.close();
    }

    if let Some(ref next_id) = next_active {
        let bar_height = shell_bar_height(reg.tabs.len());

        if let Some(tab) = reg.get_tab_by_id(next_id) {
            if let Some(wv) = app.get_webview(&tab.webview_label) {
                let _ = wv.set_position(LogicalPosition::new(0.0, bar_height));
                let _ = wv.set_size(LogicalSize::new(width, (height - bar_height).max(0.0)));
                let _ = wv.show();
                let _ = wv.set_focus();
            }
        }
        if let Some(shell_wv) = app.get_webview("shell") {
            let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = shell_wv.set_size(LogicalSize::new(width, bar_height));
        }
        pin_shell_gtk_height(app, bar_height, false);
    } else {
        if let Some(shell_wv) = app.get_webview("shell") {
            let _ = shell_wv.set_position(LogicalPosition::new(0.0, 0.0));
            let _ = shell_wv.set_size(LogicalSize::new(width, height));
            let _ = shell_wv.set_focus();
        }
        pin_shell_gtk_height(app, height, true);
    }

    emit_tabs_changed(app, &reg);

    Ok(())
}

/// The confirmation message for discarding a single tab's unsaved changes.
fn discard_tab_message(label: &str) -> String {
    format!("\"{label}\" has unsaved changes. Discard them?")
}

/// The confirmation message for quitting with one or more dirty tabs, or
/// `None` if nothing is dirty and quitting needs no confirmation.
fn quit_confirmation_message(dirty_labels: &[String]) -> Option<String> {
    if dirty_labels.is_empty() {
        return None;
    }
    let (noun, verb) = if dirty_labels.len() == 1 {
        ("document", "has")
    } else {
        ("documents", "have")
    };
    Some(format!(
        "{} {noun} {verb} unsaved changes: {}. Quit anyway?",
        dirty_labels.len(),
        dirty_labels.join(", ")
    ))
}

/// How long to wait for an editor webview to report its live dirty state
/// before assuming the worst. The backend's own cached `TabInfo.dirty` can
/// trail the editor's real state by one `update_tab_state` IPC round trip
/// (see `report_dirty`'s callers below for why that's not good enough to
/// gate a close/quit confirmation on), so close/quit ask the tab itself
/// instead. Missing a confirmation (closing unsaved work silently) is worse
/// than one extra dialog on a hung or crashed webview, so a missing reply
/// defaults to "dirty".
const DIRTY_QUERY_TIMEOUT: Duration = Duration::from_millis(500);

/// Senders waiting for a `report_dirty` reply, keyed by request id.
type DirtyReplySenders = Mutex<HashMap<String, oneshot::Sender<bool>>>;

static DIRTY_QUERY_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Payload for the `query-dirty` event. Every editor webview shares the same
/// global event bus (`listen()` on the JS side registers an `Any` target
/// that receives every emit regardless of which webview it's addressed to,
/// and `Webview::emit`/`AppHandle::emit` broadcast to all of them too), so
/// `tab_id` lets each editor recognize and ignore a query meant for a
/// different tab even though it still receives the event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DirtyQueryPayload {
    request_id: String,
    tab_id: String,
}

/// Whether to treat a tab as dirty given the live reply from its webview, or
/// `None` if it didn't answer in time (or there was nothing to ask).
fn resolve_dirty_decision(live_reply: Option<bool>) -> bool {
    live_reply.unwrap_or(true)
}

/// Emits `query-dirty` to the given tab's webview and waits for its
/// `report_dirty` reply, falling back to `resolve_dirty_decision`'s default
/// if it doesn't answer within `DIRTY_QUERY_TIMEOUT` (or there's no such
/// webview to ask). Also returns that default for a tab whose webview is
/// still loading (its `installDirtyQueryResponder` hasn't run yet), so a
/// freshly-opened tab shows up as dirty in a quit confirmation until it's
/// ready to answer for itself.
async fn query_tab_dirty(app: &AppHandle, tab_id: &str, webview_label: &str) -> bool {
    let request_id = format!(
        "dirty-query-{}",
        DIRTY_QUERY_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let (tx, rx) = oneshot::channel();

    {
        let senders = app.state::<DirtyReplySenders>();
        senders.lock().unwrap().insert(request_id.clone(), tx);
    }

    let payload = DirtyQueryPayload {
        request_id: request_id.clone(),
        tab_id: tab_id.to_string(),
    };
    let emitted = app
        .emit_to(EventTarget::webview(webview_label), "query-dirty", &payload)
        .is_ok();

    let live_reply = if emitted {
        tokio::time::timeout(DIRTY_QUERY_TIMEOUT, rx)
            .await
            .ok()
            .and_then(Result::ok)
    } else {
        None
    };

    // Drop any leftover sender; a no-op if report_dirty already removed it.
    {
        let senders = app.state::<DirtyReplySenders>();
        senders.lock().unwrap().remove(&request_id);
    }

    resolve_dirty_decision(live_reply)
}

/// Live dirty state (see `query_tab_dirty`) for every open tab's label.
/// Queries run concurrently — each is spawned as its own task before any is
/// awaited — so quitting with several tabs open waits at most one
/// `DIRTY_QUERY_TIMEOUT`, not one per tab.
async fn live_dirty_tab_labels(app: &AppHandle) -> Vec<String> {
    let tabs: Vec<(String, String, String)> = {
        let registry_state = app.state::<Mutex<TabRegistry>>();
        let reg = registry_state.lock().unwrap();
        reg.tabs
            .iter()
            .map(|t| (t.info.id.clone(), t.webview_label.clone(), t.info.label.clone()))
            .collect()
    };

    let queries: Vec<_> = tabs
        .into_iter()
        .map(|(tab_id, webview_label, label)| {
            let app = app.clone();
            let handle = tauri::async_runtime::spawn(async move {
                query_tab_dirty(&app, &tab_id, &webview_label).await
            });
            (label, handle)
        })
        .collect();

    let mut dirty_labels = Vec::new();
    for (label, handle) in queries {
        if handle.await.unwrap_or(true) {
            dirty_labels.push(label);
        }
    }
    dirty_labels
}

/// Show a blocking discard/cancel dialog. Only safe to call off the platform
/// event-loop thread: from an `async fn` `#[tauri::command]` handler (Tauri
/// runs those on the async runtime), never from a sync command handler or
/// from `on_window_event`, both of which run on that thread.
fn confirm_discard_blocking(app: &AppHandle, message: String) -> bool {
    app.dialog()
        .message(message)
        .title("Unsaved changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Discard".into(),
            "Cancel".into(),
        ))
        .blocking_show()
}

/// Same as `confirm_discard_blocking`, with a "Quit Anyway" affirmative
/// button instead of "Discard". Same off-event-loop-thread requirement.
fn confirm_quit_blocking(app: &AppHandle, message: String) -> bool {
    app.dialog()
        .message(message)
        .title("Unsaved changes")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit Anyway".into(),
            "Cancel".into(),
        ))
        .blocking_show()
}

async fn do_close_tab_with_confirmation(
    app: &AppHandle,
    tab_id: &str,
    force: bool,
) -> Result<(), String> {
    if !force {
        let (webview_label, label) = {
            let registry_state = app.state::<Mutex<TabRegistry>>();
            let reg = registry_state.lock().unwrap();
            let tab = reg
                .get_tab_by_id(tab_id)
                .ok_or_else(|| format!("Tab {tab_id} not found"))?;
            (tab.webview_label.clone(), tab.info.label.clone())
        };

        let dirty = query_tab_dirty(app, tab_id, &webview_label).await;

        if dirty && !confirm_discard_blocking(app, discard_tab_message(&label)) {
            return Ok(());
        }
    }

    do_close_tab(app, tab_id)
}

// ── External changes ────────────────────────────────────────────────────────

/// How often open files are checked for changes made outside the app. Each
/// check is one `stat` per tab; a file is only read when its stamp moved.
const EXTERNAL_CHANGE_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Payload for the `reload-document` event, addressed to one tab's webview.
/// `discard_changes` is set only after the user agreed to throw away unsaved
/// edits; without it the editor refuses to reload while it is dirty, which
/// covers an edit made after the backend last saw the tab as clean.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReloadDocumentPayload {
    tab_id: String,
    content: String,
    discard_changes: bool,
}

/// A tab whose file changed on disk, waiting to be reloaded or kept.
struct ExternalChange {
    tab_id: String,
    webview_label: String,
    label: String,
    /// The tab's disk snapshot when the change was found. If the tab has a
    /// different one by the time the change is applied, it was saved (or
    /// already handled) in between and this change is stale.
    known: DiskSnapshot,
    current: DiskSnapshot,
}

/// The prompt for an outside change to a file that also has unsaved edits.
fn external_change_message(label: &str) -> String {
    format!(
        "\"{label}\" was changed on disk, but it also has unsaved changes here. \
         Reload it and discard your changes?"
    )
}

/// Compares every saved tab's file with what the tab last saw, quietly
/// absorbing touch-only changes and returning the ones whose content differs.
fn collect_external_changes(app: &AppHandle) -> Vec<ExternalChange> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let mut changes = Vec::new();
    for tab in reg.tabs.iter_mut() {
        let Some(path) = tab.info.file_path.clone() else {
            continue;
        };
        match disk_watch::check(Path::new(&path), &tab.disk) {
            DiskCheck::Unchanged => {}
            DiskCheck::Touched(snapshot) => tab.disk = snapshot,
            DiskCheck::Modified(current) => changes.push(ExternalChange {
                tab_id: tab.info.id.clone(),
                webview_label: tab.webview_label.clone(),
                label: tab.info.label.clone(),
                known: tab.disk.clone(),
                current,
            }),
        }
    }
    changes
}

/// Records `change` as what the tab now knows about the file on disk and,
/// when `reload` is set, hands the new content to the tab's webview. Returns
/// false (doing nothing) if the tab was closed or saved since the change was
/// found.
fn apply_external_change(
    app: &AppHandle,
    change: &ExternalChange,
    reload: Option<bool>,
) -> bool {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let Some(tab) = reg.get_tab_by_id_mut(&change.tab_id) else {
        return false;
    };
    if tab.disk != change.known {
        return false;
    }
    tab.disk = change.current.clone();

    if let Some(discard_changes) = reload {
        let content = change.current.content().unwrap_or_default().to_owned();
        tab.initial_content = Some(content.clone());
        tab.info.has_been_saved = true;
        emit_tabs_changed(app, &reg);
        drop(reg);

        let _ = app.emit_to(
            EventTarget::webview(&change.webview_label),
            "reload-document",
            ReloadDocumentPayload {
                tab_id: change.tab_id.clone(),
                content,
                discard_changes,
            },
        );
    }
    true
}

/// A clean tab is reloaded silently. A dirty one asks first, and "Keep My
/// Changes" (also what closing the dialog means) leaves the editor alone
/// while remembering the disk version, so the same change isn't asked about
/// again — only a further one is.
async fn handle_external_change(app: &AppHandle, change: ExternalChange) {
    let dirty = query_tab_dirty(app, &change.tab_id, &change.webview_label).await;

    if !dirty {
        apply_external_change(app, &change, Some(false));
        return;
    }

    let reload = app
        .dialog()
        .message(external_change_message(&change.label))
        .title("File changed on disk")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Reload".into(),
            "Keep My Changes".into(),
        ))
        .blocking_show();

    apply_external_change(app, &change, reload.then_some(true));
}

async fn watch_open_files(app: AppHandle) {
    let mut interval = tokio::time::interval(EXTERNAL_CHANGE_POLL_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        for change in collect_external_changes(&app) {
            handle_external_change(&app, change).await;
        }
    }
}

// ── IPC Commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_tabs(registry: tauri::State<Mutex<TabRegistry>>) -> TabsPayload {
    let reg = registry.lock().unwrap();
    TabsPayload {
        tabs: reg.get_tab_info_list(),
        active_tab_id: reg.active_tab_id.clone(),
    }
}

#[tauri::command]
fn get_tab_document(
    registry: tauri::State<Mutex<TabRegistry>>,
    tab_id: String,
) -> Result<TabDocument, String> {
    let reg = registry.lock().unwrap();
    let tab = reg
        .get_tab_by_id(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;

    Ok(TabDocument {
        tab_id: tab.info.id.clone(),
        kind: tab.info.kind,
        path: tab.info.file_path.clone(),
        content: tab.initial_content.clone(),
        has_been_saved: tab.info.has_been_saved,
    })
}

#[tauri::command]
fn open_tab(
    app: AppHandle,
    path: Option<String>,
    kind: Option<String>,
) -> Result<TabInfo, String> {
    let resolved_path = match path {
        Some(ref p) => {
            let resolved = resolve_launch_path(PathBuf::from(p));
            let registry_state = app.state::<Mutex<TabRegistry>>();
            let reg = registry_state.lock().unwrap();
            // Use the exact canonical path this approves — never
            // re-resolve the webview-supplied string separately, which
            // would leave a window for the checked and the opened path to
            // no longer be the same file.
            let Some(canonical) = reg.resolve_allowed_path(&resolved) else {
                return Err(format!(
                    "\"{}\" is neither an already-open file nor a sibling of one",
                    resolved.display()
                ));
            };
            Some(canonical)
        }
        None => None,
    };

    do_open_tab(&app, resolved_path, kind)
}

/// Shows a native "Open" dialog and opens whatever file is picked, entirely
/// in Rust — a webview never gets to name an arbitrary path here, unlike
/// `open_tab`'s `path` argument, which is guarded but still webview-supplied.
///
/// `async` so Tauri runs it on the async runtime instead of the platform
/// event loop: `blocking_pick_file()` below must not run on the same thread
/// that pumps that loop, or the dialog (which needs the loop) deadlocks it.
#[tauri::command]
async fn pick_and_open_file(app: AppHandle) -> Result<Option<TabInfo>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Operaton files", &["bpmn", "dmn", "form"])
        .add_filter("BPMN diagrams", &["bpmn"])
        .add_filter("DMN diagrams", &["dmn"])
        .add_filter("Form definitions", &["form"])
        .blocking_pick_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;

    do_open_tab(&app, Some(path), None).map(Some)
}

#[tauri::command]
fn focus_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    do_focus_tab(&app, &tab_id)
}

/// `async` for the same reason as `pick_and_open_file`:
/// `do_close_tab_with_confirmation` can call a `blocking_show()` dialog, which
/// must not run on the platform event-loop thread.
#[tauri::command]
async fn close_tab(app: AppHandle, tab_id: String, force: Option<bool>) -> Result<(), String> {
    do_close_tab_with_confirmation(&app, &tab_id, force.unwrap_or(false)).await
}

/// The webview side of `query_tab_dirty`'s request/reply protocol: an editor
/// answers a `query-dirty` event with its current `SaveController` state.
#[tauri::command]
fn report_dirty(app: AppHandle, request_id: String, dirty: bool) {
    let sender = app.state::<DirtyReplySenders>().lock().unwrap().remove(&request_id);
    if let Some(tx) = sender {
        let _ = tx.send(dirty);
    }
}

/// A tab's dirty flag is the only state a webview can freely report about
/// itself: its file path is set only by `open_tab`/`pick_and_open_file` (at
/// open time) or `save_document_as` (at first save), both backend-driven,
/// so a compromised webview can't use this to add an arbitrary path to its
/// own tab's allow-listed file.
#[tauri::command]
fn update_tab_state(app: AppHandle, tab_id: String, dirty: bool) -> Result<(), String> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let tab = reg
        .get_tab_by_id_mut(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;
    tab.info.dirty = dirty;

    emit_tabs_changed(&app, &reg);
    Ok(())
}

#[tauri::command]
fn write_document(app: AppHandle, tab_id: String, content: String) -> Result<(), String> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    // Held across the write so the external-change poll can't observe the
    // new file before the tab's disk snapshot is updated to match it, and
    // report our own save as an outside edit.
    let mut reg = registry_state.lock().unwrap();
    let tab = reg
        .get_tab_by_id_mut(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;
    let path = tab
        .info
        .file_path
        .clone()
        .ok_or_else(|| "Tab has no file path yet; use save_document_as".to_string())?;

    atomic_write::atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())?;
    tab.disk = DiskSnapshot::after_write(Path::new(&path), &content);
    Ok(())
}

/// Shows a native "Save As" dialog and, if a path was chosen, writes
/// `content` to it and records it on the tab. The path never passes through
/// the webview: it comes straight from the dialog into this same command.
///
/// `async` for the same reason as `pick_and_open_file`: `blocking_save_file()`
/// must not run on the platform event-loop thread.
#[tauri::command]
async fn save_document_as(
    app: AppHandle,
    tab_id: String,
    content: String,
    default_name: String,
    filter_name: String,
    extension: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &[extension.as_str()])
        .blocking_save_file();

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;

    atomic_write::atomic_write(&path, content.as_bytes()).map_err(|e| e.to_string())?;

    let path_string = path.to_string_lossy().into_owned();

    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();
    let tab = reg
        .get_tab_by_id_mut(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;
    if let Some(name) = path.file_name() {
        tab.info.label = name.to_string_lossy().into_owned();
    }
    tab.info.file_path = Some(path_string.clone());
    tab.info.has_been_saved = true;
    tab.disk = DiskSnapshot::after_write(&path, &content);
    emit_tabs_changed(&app, &reg);

    Ok(Some(path_string))
}

#[tauri::command]
fn list_sibling_bpmn_files(
    app: AppHandle,
    tab_id: String,
) -> Result<Vec<SiblingBpmnFile>, String> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let reg = registry_state.lock().unwrap();
    let tab = reg
        .get_tab_by_id(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;
    let path = match tab.info.file_path.clone() {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };
    drop(reg);

    let directory = Path::new(&path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.extension().and_then(|ext| ext.to_str()) != Some("bpmn") {
            continue;
        }
        let Some(file_name) = entry_path.file_name() else {
            continue;
        };
        if let Ok(content) = fs::read_to_string(&entry_path) {
            files.push(SiblingBpmnFile {
                relative_path: file_name.to_string_lossy().into_owned(),
                content,
            });
        }
    }

    Ok(files)
}

#[tauri::command]
fn minimize_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_window("main") {
        window.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn maximize_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_window("main") {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())?;
        } else {
            window.maximize().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// `async` for the same reason as `pick_and_open_file`: `confirm_quit_blocking`
/// calls `blocking_show()`, which must not run on the platform event-loop
/// thread — unlike the `CloseRequested` handler in `run()` below, which
/// already runs on that thread and uses the dialog's non-blocking `show()`.
#[tauri::command]
async fn quit_app(app: AppHandle) {
    let dirty_labels = live_dirty_tab_labels(&app).await;
    match quit_confirmation_message(&dirty_labels) {
        None => app.exit(0),
        Some(message) => {
            if confirm_quit_blocking(&app, message) {
                app.exit(0);
            }
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(TabRegistry::new()))
        .manage(DirtyReplySenders::default())
        .setup(|app| {
            let window = WindowBuilder::new(app, "main")
                .title("Operaton Modeler")
                .inner_size(1280.0, 840.0)
                .min_inner_size(640.0, 400.0)
                .resizable(true)
                .decorations(false)
                .build()?;

            let initial_args: Vec<PathBuf> = std::env::args_os()
                .skip(1)
                .filter(|arg| arg != "--" && !arg.to_string_lossy().starts_with('-'))
                .map(PathBuf::from)
                .map(resolve_launch_path)
                .collect();

            let (width, height) = get_window_logical_size(&window)?;

            let has_initial_file = !initial_args.is_empty();

            // Initial files open as tabs below, which collapses the shell
            // bar when there's exactly one of them (see `shell_bar_height`);
            // `do_open_tab` re-applies this authoritatively once it knows
            // the real tab count, this is just the geometry the shell
            // webview starts with for the brief moment before that.
            let shell_height = if has_initial_file { 0.0 } else { height };

            let shell_builder =
                WebviewBuilder::new("shell", WebviewUrl::App("shell/index.html".into()));
            let _shell_wv = window.add_child(
                shell_builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(width, shell_height),
            )?;

            pin_shell_gtk_height(&app.handle(), shell_height, !has_initial_file);

            tauri::async_runtime::spawn(watch_open_files(app.handle().clone()));

            let app_handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Resized(_) => {
                    let registry = app_handle.state::<Mutex<TabRegistry>>();
                    let reg = registry.lock().unwrap();
                    if let Some(win) = app_handle.get_window("main") {
                        let _ = do_resize_webviews(&app_handle, &win, &reg);
                    }
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Runs on the platform event loop, so the confirmation
                    // dialog must be non-blocking here (unlike quit_app), and
                    // querying each tab's live dirty state (an async round
                    // trip) has to happen in a spawned task rather than
                    // inline.
                    api.prevent_close();
                    let app_for_query = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let dirty_labels = live_dirty_tab_labels(&app_for_query).await;
                        match quit_confirmation_message(&dirty_labels) {
                            None => app_for_query.exit(0),
                            Some(message) => {
                                let app_for_dialog = app_for_query.clone();
                                app_for_query
                                    .dialog()
                                    .message(message)
                                    .title("Unsaved changes")
                                    .kind(MessageDialogKind::Warning)
                                    .buttons(MessageDialogButtons::OkCancelCustom(
                                        "Quit Anyway".into(),
                                        "Cancel".into(),
                                    ))
                                    .show(move |confirmed| {
                                        if confirmed {
                                            app_for_dialog.exit(0);
                                        }
                                    });
                            }
                        }
                    });
                }
                _ => {}
            });

            let mut open_errors: Vec<String> = Vec::new();
            for path in initial_args {
                if let Err(error) = do_open_tab(&app.handle(), Some(path.clone()), None) {
                    eprintln!("Failed to open {}: {error}", path.display());
                    open_errors.push(format!("{}: {error}", path.display()));
                }
            }

            if !open_errors.is_empty() {
                app.dialog()
                    .message(open_errors.join("\n"))
                    .title("Could not open file")
                    .kind(MessageDialogKind::Error)
                    .show(|_| {});
            }

            // If nothing ended up open (no initial files, or every one of
            // them failed), lay the shell out for the empty state rather
            // than leaving it at the pre-open guess from `shell_height`.
            let registry_state = app.state::<Mutex<TabRegistry>>();
            let reg = registry_state.lock().unwrap();
            if reg.active_tab_id.is_none() {
                if let Some(win) = app.get_window("main") {
                    let _ = do_resize_webviews(&app.handle(), &win, &reg);
                }
            }
            drop(reg);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tabs,
            get_tab_document,
            open_tab,
            pick_and_open_file,
            focus_tab,
            close_tab,
            report_dirty,
            update_tab_state,
            write_document,
            save_document_as,
            list_sibling_bpmn_files,
            minimize_window,
            maximize_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Operaton Modeler");
}

#[cfg(test)]
mod quit_confirmation_tests {
    use super::*;

    #[test]
    fn discard_tab_message_names_the_file() {
        assert_eq!(
            discard_tab_message("diagram.bpmn"),
            "\"diagram.bpmn\" has unsaved changes. Discard them?"
        );
    }

    #[test]
    fn quit_confirmation_message_is_none_when_nothing_dirty() {
        assert_eq!(quit_confirmation_message(&[]), None);
    }

    #[test]
    fn quit_confirmation_message_uses_singular_grammar_for_one_tab() {
        let message = quit_confirmation_message(&["a.bpmn".to_string()]).unwrap();
        assert_eq!(
            message,
            "1 document has unsaved changes: a.bpmn. Quit anyway?"
        );
    }

    #[test]
    fn quit_confirmation_message_lists_every_dirty_tab() {
        let message =
            quit_confirmation_message(&["a.bpmn".to_string(), "b.dmn".to_string()]).unwrap();
        assert_eq!(
            message,
            "2 documents have unsaved changes: a.bpmn, b.dmn. Quit anyway?"
        );
    }

    #[test]
    fn external_change_message_names_the_file_and_the_risk() {
        assert_eq!(
            external_change_message("diagram.bpmn"),
            "\"diagram.bpmn\" was changed on disk, but it also has unsaved changes here. \
             Reload it and discard your changes?"
        );
    }

    #[test]
    fn resolve_dirty_decision_trusts_a_clean_live_reply() {
        assert_eq!(resolve_dirty_decision(Some(false)), false);
    }

    #[test]
    fn resolve_dirty_decision_trusts_a_dirty_live_reply() {
        assert_eq!(resolve_dirty_decision(Some(true)), true);
    }

    #[test]
    fn resolve_dirty_decision_assumes_dirty_when_no_reply_arrives_in_time() {
        assert_eq!(resolve_dirty_decision(None), true);
    }
}
