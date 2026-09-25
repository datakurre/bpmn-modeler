use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const TAB_BAR_HEIGHT: f64 = 36.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditorKind {
    Bpmn,
    Dmn,
    Form,
}

impl EditorKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        match path.extension().and_then(|e| e.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case("bpmn") => Some(EditorKind::Bpmn),
            Some(ext) if ext.eq_ignore_ascii_case("dmn") => Some(EditorKind::Dmn),
            Some(ext) if ext.eq_ignore_ascii_case("form") => Some(EditorKind::Form),
            _ => None,
        }
    }

    pub fn default_extension(&self) -> &'static str {
        match self {
            EditorKind::Bpmn => "bpmn",
            EditorKind::Dmn => "dmn",
            EditorKind::Form => "form",
        }
    }

    pub fn default_name(&self) -> &'static str {
        match self {
            EditorKind::Bpmn => "diagram.bpmn",
            EditorKind::Dmn => "decision.dmn",
            EditorKind::Form => "form.form",
        }
    }

    pub fn webview_url(&self, tab_id: &str) -> String {
        match self {
            EditorKind::Bpmn => format!("bpmn/index.html?tabId={}", tab_id),
            EditorKind::Dmn => format!("dmn/index.html?tabId={}", tab_id),
            EditorKind::Form => format!("form/index.html?tabId={}", tab_id),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub id: String,
    pub kind: EditorKind,
    pub file_path: Option<String>,
    pub label: String,
    pub dirty: bool,
    pub has_been_saved: bool,
}

pub struct TabState {
    pub info: TabInfo,
    pub webview_label: String,
    pub initial_content: Option<String>,
}

#[derive(Default)]
pub struct TabRegistry {
    pub tabs: Vec<TabState>,
    pub active_tab_id: Option<String>,
    next_counter: usize,
}

impl TabRegistry {
    pub fn new() -> Self {
        Self {
            tabs: Vec::new(),
            active_tab_id: None,
            next_counter: 1,
        }
    }

    pub fn generate_id(&mut self) -> (String, String) {
        let counter = self.next_counter;
        self.next_counter += 1;
        let id = format!("tab-{}", counter);
        let webview_label = format!("editor-{}", counter);
        (id, webview_label)
    }

    pub fn get_tab_info_list(&self) -> Vec<TabInfo> {
        self.tabs.iter().map(|t| t.info.clone()).collect()
    }

    pub fn get_tab_by_id(&self, id: &str) -> Option<&TabState> {
        self.tabs.iter().find(|t| t.info.id == id)
    }

    pub fn get_tab_by_id_mut(&mut self, id: &str) -> Option<&mut TabState> {
        self.tabs.iter_mut().find(|t| t.info.id == id)
    }

    /// Returns the canonicalized form of `path` if a file IPC command
    /// triggered from a webview may read it: it resolves (after following
    /// symlinks and `..`) either to an already-registered tab's own file,
    /// or to a file directly inside that tab's directory (the case for
    /// linked BPMN resources opened by clicking an overlay). A symlink
    /// whose real target lives outside that directory is rejected even if
    /// the link itself lives inside it.
    ///
    /// Callers must open/read the returned canonical path, not the
    /// webview-supplied one this was called with: resolving and checking
    /// it here, then having the caller separately re-resolve the original
    /// string to actually open it, would leave a window for the checked
    /// and the opened path to no longer be the same file (e.g. a sibling
    /// swapped for a symlink between the two resolutions).
    pub fn resolve_allowed_path(&self, path: &Path) -> Option<PathBuf> {
        let canonical = path.canonicalize().ok()?;

        let is_allowed = self.tabs.iter().any(|tab| {
            let Some(tab_path) = tab.info.file_path.as_deref().map(Path::new) else {
                return false;
            };

            if let Ok(canonical_tab_path) = tab_path.canonicalize() {
                if canonical_tab_path == canonical {
                    return true;
                }
            }

            let allowed_dir = tab_path.parent().and_then(|p| p.canonicalize().ok());
            match (allowed_dir, canonical.parent()) {
                (Some(allowed_dir), Some(candidate_dir)) => allowed_dir == candidate_dir,
                _ => false,
            }
        });

        is_allowed.then_some(canonical)
    }

    /// Labels of every tab with unsaved changes, in tab order.
    pub fn dirty_tab_labels(&self) -> Vec<String> {
        self.tabs
            .iter()
            .filter(|t| t.info.dirty)
            .map(|t| t.info.label.clone())
            .collect()
    }

    pub fn get_tab_by_path(&self, path: &str) -> Option<&TabState> {
        let canonical_target = Path::new(path).canonicalize().ok();
        self.tabs.iter().find(|t| {
            if let Some(ref p) = t.info.file_path {
                if p == path {
                    return true;
                }
                if let (Some(c1), Ok(c2)) = (canonical_target.as_ref(), Path::new(p).canonicalize()) {
                    if *c1 == c2 {
                        return true;
                    }
                }
            }
            false
        })
    }

    pub fn add_tab(&mut self, state: TabState) {
        self.tabs.push(state);
    }

    pub fn remove_tab(&mut self, id: &str) -> Option<(TabState, Option<String>)> {
        let index = self.tabs.iter().position(|t| t.info.id == id)?;
        let removed = self.tabs.remove(index);

        let next_active = if self.active_tab_id.as_deref() == Some(id) {
            if self.tabs.is_empty() {
                None
            } else if index < self.tabs.len() {
                Some(self.tabs[index].info.id.clone())
            } else {
                Some(self.tabs[self.tabs.len() - 1].info.id.clone())
            }
        } else {
            self.active_tab_id.clone()
        };

        self.active_tab_id = next_active.clone();
        Some((removed, next_active))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_tab(registry: &mut TabRegistry, label: &str, file_path: Option<String>) -> TabState {
        let (id, webview_label) = registry.generate_id();
        let has_been_saved = file_path.is_some();
        TabState {
            info: TabInfo {
                id,
                kind: EditorKind::Bpmn,
                file_path,
                label: label.to_string(),
                dirty: false,
                has_been_saved,
            },
            webview_label,
            initial_content: None,
        }
    }

    #[test]
    fn editor_kind_from_path_matches_extension_case_insensitively() {
        assert_eq!(
            EditorKind::from_path(Path::new("diagram.BPMN")),
            Some(EditorKind::Bpmn)
        );
        assert_eq!(
            EditorKind::from_path(Path::new("decision.dmn")),
            Some(EditorKind::Dmn)
        );
        assert_eq!(
            EditorKind::from_path(Path::new("form.Form")),
            Some(EditorKind::Form)
        );
    }

    #[test]
    fn editor_kind_from_path_rejects_unknown_extension() {
        assert_eq!(EditorKind::from_path(Path::new("notes.txt")), None);
        assert_eq!(EditorKind::from_path(Path::new("no-extension")), None);
    }

    #[test]
    fn generate_id_returns_increasing_unique_ids() {
        let mut registry = TabRegistry::new();
        let (id1, label1) = registry.generate_id();
        let (id2, label2) = registry.generate_id();
        let (id3, label3) = registry.generate_id();

        assert_ne!(id1, id2);
        assert_ne!(id2, id3);
        assert_ne!(label1, label2);
        assert_ne!(label2, label3);
        assert_eq!(id1, "tab-1");
        assert_eq!(id2, "tab-2");
        assert_eq!(id3, "tab-3");
    }

    #[test]
    fn remove_tab_activates_next_when_removing_active_first() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", None);
        let b = make_tab(&mut registry, "b", None);
        let c = make_tab(&mut registry, "c", None);
        let a_id = a.info.id.clone();
        let b_id = b.info.id.clone();
        registry.add_tab(a);
        registry.add_tab(b);
        registry.add_tab(c);
        registry.active_tab_id = Some(a_id.clone());

        let (removed, next_active) = registry.remove_tab(&a_id).unwrap();
        assert_eq!(removed.info.id, a_id);
        assert_eq!(next_active, Some(b_id.clone()));
        assert_eq!(registry.active_tab_id, Some(b_id));
    }

    #[test]
    fn remove_tab_activates_previous_when_removing_active_last() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", None);
        let b = make_tab(&mut registry, "b", None);
        let c = make_tab(&mut registry, "c", None);
        let a_id = a.info.id.clone();
        let b_id = b.info.id.clone();
        let c_id = c.info.id.clone();
        registry.add_tab(a);
        registry.add_tab(b);
        registry.add_tab(c);
        registry.active_tab_id = Some(c_id.clone());

        let (removed, next_active) = registry.remove_tab(&c_id).unwrap();
        assert_eq!(removed.info.id, c_id);
        assert_eq!(next_active, Some(b_id.clone()));
        assert_eq!(registry.active_tab_id, Some(b_id));
        assert_eq!(registry.tabs[0].info.id, a_id);
    }

    #[test]
    fn remove_tab_activates_next_when_removing_active_middle() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", None);
        let b = make_tab(&mut registry, "b", None);
        let c = make_tab(&mut registry, "c", None);
        let b_id = b.info.id.clone();
        let c_id = c.info.id.clone();
        registry.add_tab(a);
        registry.add_tab(b);
        registry.add_tab(c);
        registry.active_tab_id = Some(b_id.clone());

        let (removed, next_active) = registry.remove_tab(&b_id).unwrap();
        assert_eq!(removed.info.id, b_id);
        assert_eq!(next_active, Some(c_id.clone()));
        assert_eq!(registry.active_tab_id, Some(c_id));
    }

    #[test]
    fn remove_tab_keeps_active_when_removing_a_non_active_tab() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", None);
        let b = make_tab(&mut registry, "b", None);
        let a_id = a.info.id.clone();
        let b_id = b.info.id.clone();
        registry.add_tab(a);
        registry.add_tab(b);
        registry.active_tab_id = Some(b_id.clone());

        let (removed, next_active) = registry.remove_tab(&a_id).unwrap();
        assert_eq!(removed.info.id, a_id);
        assert_eq!(next_active, Some(b_id.clone()));
        assert_eq!(registry.active_tab_id, Some(b_id));
    }

    #[test]
    fn remove_tab_returns_none_active_when_last_tab_removed() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", None);
        let a_id = a.info.id.clone();
        registry.add_tab(a);
        registry.active_tab_id = Some(a_id.clone());

        let (_, next_active) = registry.remove_tab(&a_id).unwrap();
        assert_eq!(next_active, None);
        assert_eq!(registry.active_tab_id, None);
    }

    #[test]
    fn get_tab_by_path_matches_exact_string() {
        let mut registry = TabRegistry::new();
        let a = make_tab(&mut registry, "a", Some("/some/nonexistent/path.bpmn".into()));
        registry.add_tab(a);

        let found = registry.get_tab_by_path("/some/nonexistent/path.bpmn");
        assert!(found.is_some());
    }

    #[test]
    fn get_tab_by_path_matches_canonicalized_path() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("diagram.bpmn");
        std::fs::write(&file_path, "content").unwrap();

        let mut registry = TabRegistry::new();
        let canonical = file_path.canonicalize().unwrap();
        let a = make_tab(
            &mut registry,
            "a",
            Some(canonical.to_string_lossy().into_owned()),
        );
        registry.add_tab(a);

        // Look up via a non-canonical (but equivalent) path, e.g. through "..".
        let indirect = dir.path().join("./diagram.bpmn");
        let found = registry.get_tab_by_path(&indirect.to_string_lossy());
        assert!(found.is_some());
    }

    #[test]
    fn get_tab_by_path_returns_none_for_unknown_path() {
        let registry = TabRegistry::new();
        assert!(registry.get_tab_by_path("/no/such/path.bpmn").is_none());
    }

    #[test]
    fn resolve_allowed_path_permits_a_tabs_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("diagram.bpmn");
        std::fs::write(&file_path, "content").unwrap();

        let mut registry = TabRegistry::new();
        let tab = make_tab(
            &mut registry,
            "diagram.bpmn",
            Some(file_path.to_string_lossy().into_owned()),
        );
        registry.add_tab(tab);

        assert_eq!(
            registry.resolve_allowed_path(&file_path),
            Some(file_path.canonicalize().unwrap())
        );
    }

    #[test]
    fn resolve_allowed_path_permits_a_sibling_in_the_same_directory() {
        let dir = tempfile::tempdir().unwrap();
        let open_path = dir.path().join("diagram.bpmn");
        let sibling_path = dir.path().join("called.bpmn");
        std::fs::write(&open_path, "content").unwrap();
        std::fs::write(&sibling_path, "content").unwrap();

        let mut registry = TabRegistry::new();
        let tab = make_tab(
            &mut registry,
            "diagram.bpmn",
            Some(open_path.to_string_lossy().into_owned()),
        );
        registry.add_tab(tab);

        assert_eq!(
            registry.resolve_allowed_path(&sibling_path),
            Some(sibling_path.canonicalize().unwrap())
        );
    }

    #[test]
    fn resolve_allowed_path_rejects_a_dot_dot_traversal_out_of_the_directory() {
        let dir = tempfile::tempdir().unwrap();
        let open_path = dir.path().join("diagram.bpmn");
        std::fs::write(&open_path, "content").unwrap();

        // A file that exists, but only by walking out of the tab's
        // directory via `..` — must not be treated as a sibling.
        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.bpmn");
        std::fs::write(&outside_file, "content").unwrap();
        let traversal_path = dir
            .path()
            .join("..")
            .join(outside_dir.path().file_name().unwrap())
            .join("secret.bpmn");

        let mut registry = TabRegistry::new();
        let tab = make_tab(
            &mut registry,
            "diagram.bpmn",
            Some(open_path.to_string_lossy().into_owned()),
        );
        registry.add_tab(tab);

        assert_eq!(registry.resolve_allowed_path(&traversal_path), None);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_allowed_path_rejects_a_symlink_pointing_outside_the_directory() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let open_path = dir.path().join("diagram.bpmn");
        std::fs::write(&open_path, "content").unwrap();

        let outside_dir = tempfile::tempdir().unwrap();
        let outside_file = outside_dir.path().join("secret.bpmn");
        std::fs::write(&outside_file, "content").unwrap();

        // The symlink itself lives inside the tab's directory, but its
        // real target does not.
        let link_path = dir.path().join("escape.bpmn");
        symlink(&outside_file, &link_path).unwrap();

        let mut registry = TabRegistry::new();
        let tab = make_tab(
            &mut registry,
            "diagram.bpmn",
            Some(open_path.to_string_lossy().into_owned()),
        );
        registry.add_tab(tab);

        assert_eq!(registry.resolve_allowed_path(&link_path), None);
    }

    #[test]
    fn resolve_allowed_path_rejects_an_unrelated_path() {
        let dir = tempfile::tempdir().unwrap();
        let open_path = dir.path().join("diagram.bpmn");
        std::fs::write(&open_path, "content").unwrap();

        let unrelated_dir = tempfile::tempdir().unwrap();
        let unrelated_file = unrelated_dir.path().join("other.bpmn");
        std::fs::write(&unrelated_file, "content").unwrap();

        let mut registry = TabRegistry::new();
        let tab = make_tab(
            &mut registry,
            "diagram.bpmn",
            Some(open_path.to_string_lossy().into_owned()),
        );
        registry.add_tab(tab);

        assert_eq!(registry.resolve_allowed_path(&unrelated_file), None);
    }

    #[test]
    fn resolve_allowed_path_rejects_when_no_tabs_are_open() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("diagram.bpmn");
        std::fs::write(&path, "content").unwrap();

        let registry = TabRegistry::new();
        assert_eq!(registry.resolve_allowed_path(&path), None);
    }

    #[test]
    fn dirty_tab_labels_lists_only_dirty_tabs_in_order() {
        let mut registry = TabRegistry::new();
        let mut a = make_tab(&mut registry, "a.bpmn", None);
        let b = make_tab(&mut registry, "b.dmn", None);
        let mut c = make_tab(&mut registry, "c.form", None);
        a.info.dirty = true;
        c.info.dirty = true;
        registry.add_tab(a);
        registry.add_tab(b);
        registry.add_tab(c);

        assert_eq!(registry.dirty_tab_labels(), vec!["a.bpmn", "c.form"]);
    }

    #[test]
    fn dirty_tab_labels_is_empty_when_nothing_is_dirty() {
        let mut registry = TabRegistry::new();
        let tab = make_tab(&mut registry, "a.bpmn", None);
        registry.add_tab(tab);

        assert!(registry.dirty_tab_labels().is_empty());
    }
}
