use serde::{Deserialize, Serialize};
use std::path::Path;

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
