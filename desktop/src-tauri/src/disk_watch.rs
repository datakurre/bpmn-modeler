use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;

/// A file's modification time and length: cheap to compare, so most polls
/// never need to read the file at all.
type Stamp = (SystemTime, u64);

fn stamp_of(path: &Path) -> io::Result<Stamp> {
    let meta = fs::metadata(path)?;
    Ok((meta.modified()?, meta.len()))
}

/// What the app last saw on disk for a tab's file: either what it loaded, or
/// what it wrote itself on the last save. A later difference from this is an
/// external change.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DiskSnapshot {
    stamp: Option<Stamp>,
    content: Option<String>,
}

impl DiskSnapshot {
    /// Snapshot of a file that doesn't exist (yet).
    pub fn missing() -> Self {
        Self::default()
    }

    /// Reads `path`. The stamp is taken before the content, so a write that
    /// lands in between leaves an older stamp next to newer content, which
    /// the next `check` re-reads and finds equal instead of missing.
    pub fn read(path: &Path) -> io::Result<Self> {
        let stamp = stamp_of(path)?;
        let content = fs::read_to_string(path)?;
        Ok(Self {
            stamp: Some(stamp),
            content: Some(content),
        })
    }

    /// Snapshot for a file this app just wrote `content` to, so its own
    /// save isn't mistaken for an external change.
    pub fn after_write(path: &Path, content: &str) -> Self {
        Self {
            stamp: stamp_of(path).ok(),
            content: Some(content.to_owned()),
        }
    }

    pub fn content(&self) -> Option<&str> {
        self.content.as_deref()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum DiskCheck {
    /// Nothing changed, or the file can't be read right now (deleted, or
    /// mid-replacement): keep the tab as it is.
    Unchanged,
    /// The file was rewritten with identical content; only the stamp moved.
    Touched(DiskSnapshot),
    /// The file's content now differs from what the tab last saw.
    Modified(DiskSnapshot),
}

pub fn check(path: &Path, known: &DiskSnapshot) -> DiskCheck {
    let Ok(stamp) = stamp_of(path) else {
        return DiskCheck::Unchanged;
    };
    if known.stamp == Some(stamp) {
        return DiskCheck::Unchanged;
    }
    let Ok(current) = DiskSnapshot::read(path) else {
        return DiskCheck::Unchanged;
    };
    if current.content == known.content {
        DiskCheck::Touched(current)
    } else {
        DiskCheck::Modified(current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::Duration;

    fn bump_mtime(path: &Path) {
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(SystemTime::now() + Duration::from_secs(60))
            .unwrap();
    }

    #[test]
    fn unchanged_file_is_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        fs::write(&path, "one").unwrap();
        let known = DiskSnapshot::read(&path).unwrap();
        assert_eq!(check(&path, &known), DiskCheck::Unchanged);
    }

    #[test]
    fn different_content_is_modified() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        fs::write(&path, "one").unwrap();
        let known = DiskSnapshot::read(&path).unwrap();

        fs::write(&path, "two").unwrap();
        bump_mtime(&path);

        match check(&path, &known) {
            DiskCheck::Modified(snapshot) => assert_eq!(snapshot.content(), Some("two")),
            other => panic!("expected Modified, got {other:?}"),
        }
    }

    #[test]
    fn same_content_with_new_mtime_is_only_touched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        fs::write(&path, "one").unwrap();
        let known = DiskSnapshot::read(&path).unwrap();

        bump_mtime(&path);

        assert!(matches!(check(&path, &known), DiskCheck::Touched(_)));
    }

    #[test]
    fn own_write_is_not_an_external_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        fs::write(&path, "one").unwrap();
        fs::write(&path, "two").unwrap();
        let known = DiskSnapshot::after_write(&path, "two");
        assert_eq!(check(&path, &known), DiskCheck::Unchanged);
    }

    #[test]
    fn missing_file_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        fs::write(&path, "one").unwrap();
        let known = DiskSnapshot::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(check(&path, &known), DiskCheck::Unchanged);
    }

    #[test]
    fn file_created_after_the_tab_opened_is_modified() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.bpmn");
        let known = DiskSnapshot::missing();
        fs::write(&path, "one").unwrap();
        assert!(matches!(check(&path, &known), DiskCheck::Modified(_)));
    }
}
