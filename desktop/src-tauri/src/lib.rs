mod atomic_write;
mod tab_registry;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window,
    WindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

fn do_open_tab(
    app: &AppHandle,
    path: Option<String>,
    kind_str: Option<String>,
) -> Result<TabInfo, String> {
    let window = app.get_window("main").ok_or("Main window not found")?;

    let resolved_path = path.as_ref().map(|p| resolve_launch_path(PathBuf::from(p)));

    if let Some(ref p) = resolved_path {
        let registry_state = app.state::<Mutex<TabRegistry>>();
        let reg = registry_state.lock().unwrap();
        if let Some(existing) = reg.get_tab_by_path(&p.to_string_lossy()) {
            let existing_id = existing.info.id.clone();
            let existing_info = existing.info.clone();
            drop(reg);
            do_focus_tab(app, &existing_id)?;
            return Ok(existing_info);
        }
    }

    let kind = if let Some(ref p) = resolved_path {
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

    let (content, has_been_saved) = if let Some(ref p) = resolved_path {
        if p.exists() {
            let text = fs::read_to_string(p)
                .map_err(|e| format!("Failed to read {}: {e}", p.display()))?;
            (Some(text), true)
        } else {
            (None, false)
        }
    } else {
        (None, false)
    };

    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    // Re-check for a concurrently opened tab under the same lock that adds
    // the new one: the first check above dropped its lock before this
    // function read the file, so two overlapping opens of the same path
    // (e.g. a double click on a linked-resource overlay) could both pass it.
    if let Some(ref p) = resolved_path {
        if let Some(existing) = reg.get_tab_by_path(&p.to_string_lossy()) {
            let existing_id = existing.info.id.clone();
            let existing_info = existing.info.clone();
            drop(reg);
            do_focus_tab(app, &existing_id)?;
            return Ok(existing_info);
        }
    }

    let (tab_id, webview_label) = reg.generate_id();

    let label = if let Some(ref p) = resolved_path {
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
        file_path: resolved_path.map(|p| p.to_string_lossy().into_owned()),
        label,
        dirty: false,
        has_been_saved,
    };

    reg.add_tab(TabState {
        info: tab_info.clone(),
        webview_label,
        initial_content: content,
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

fn dirty_tab_labels(app: &AppHandle) -> Vec<String> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let reg = registry_state.lock().unwrap();
    reg.dirty_tab_labels()
}

/// Show a blocking discard/cancel dialog. Only safe to call off the main
/// thread (e.g. from a `#[tauri::command]` handler, never from
/// `on_window_event`).
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
/// button instead of "Discard". Also only safe off the main thread.
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

fn do_close_tab_with_confirmation(app: &AppHandle, tab_id: &str, force: bool) -> Result<(), String> {
    if !force {
        let registry_state = app.state::<Mutex<TabRegistry>>();
        let reg = registry_state.lock().unwrap();
        let tab = reg
            .get_tab_by_id(tab_id)
            .ok_or_else(|| format!("Tab {tab_id} not found"))?;
        let dirty = tab.info.dirty;
        let label = tab.info.label.clone();
        drop(reg);

        if dirty && !confirm_discard_blocking(app, discard_tab_message(&label)) {
            return Ok(());
        }
    }

    do_close_tab(app, tab_id)
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
    do_open_tab(&app, path, kind)
}

#[tauri::command]
fn focus_tab(app: AppHandle, tab_id: String) -> Result<(), String> {
    do_focus_tab(&app, &tab_id)
}

#[tauri::command]
fn close_tab(app: AppHandle, tab_id: String, force: Option<bool>) -> Result<(), String> {
    do_close_tab_with_confirmation(&app, &tab_id, force.unwrap_or(false))
}

#[tauri::command]
fn update_tab_state(
    app: AppHandle,
    tab_id: String,
    dirty: Option<bool>,
    file_path: Option<String>,
    has_been_saved: Option<bool>,
) -> Result<(), String> {
    let registry_state = app.state::<Mutex<TabRegistry>>();
    let mut reg = registry_state.lock().unwrap();

    let tab = reg
        .get_tab_by_id_mut(&tab_id)
        .ok_or_else(|| format!("Tab not found: {tab_id}"))?;

    if let Some(d) = dirty {
        tab.info.dirty = d;
    }
    if let Some(s) = has_been_saved {
        tab.info.has_been_saved = s;
    }
    if let Some(p) = file_path {
        let pb = PathBuf::from(&p);
        if let Some(name) = pb.file_name() {
            tab.info.label = name.to_string_lossy().into_owned();
        }
        tab.info.file_path = Some(p);
    }

    emit_tabs_changed(&app, &reg);
    Ok(())
}

#[tauri::command]
fn write_document(path: String, content: String) -> Result<(), String> {
    atomic_write::atomic_write(Path::new(&path), content.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_sibling_bpmn_files(path: String) -> Result<Vec<SiblingBpmnFile>, String> {
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

#[tauri::command]
fn quit_app(app: AppHandle) {
    let dirty_labels = dirty_tab_labels(&app);
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
                    // dialog must be non-blocking here (unlike quit_app).
                    api.prevent_close();
                    let dirty_labels = dirty_tab_labels(&app_handle);
                    match quit_confirmation_message(&dirty_labels) {
                        None => app_handle.exit(0),
                        Some(message) => {
                            let app_for_dialog = app_handle.clone();
                            app_handle
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
                }
                _ => {}
            });

            let mut open_errors: Vec<String> = Vec::new();
            for path in initial_args {
                if let Err(error) = do_open_tab(
                    &app.handle(),
                    Some(path.to_string_lossy().into_owned()),
                    None,
                ) {
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
            focus_tab,
            close_tab,
            update_tab_state,
            write_document,
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
}
