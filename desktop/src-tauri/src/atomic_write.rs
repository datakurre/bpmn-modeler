use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `content` to `path`, replacing any existing file atomically.
///
/// The destination's symlink (if any) is followed rather than replaced, and
/// an existing destination's permissions are copied onto the new content so
/// a save doesn't quietly reset them to the process umask default.
pub fn atomic_write(path: &Path, content: &[u8]) -> io::Result<()> {
    // Follow a symlinked destination so the link itself is kept and its
    // target's content is updated, not the link replaced with a plain file.
    let destination: PathBuf = match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }
        _ => path.to_path_buf(),
    };

    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let filename = destination
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?
        .to_string_lossy();

    let existing_permissions = fs::metadata(&destination).ok().map(|m| m.permissions());

    let pid = std::process::id();
    let mut attempt = 0u32;
    let (temporary, mut file) = loop {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".{filename}.{pid}.{counter}.tmp"));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => break (candidate, file),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && attempt < 10 => {
                attempt += 1;
                continue;
            }
            Err(e) => return Err(e),
        }
    };

    let result = (|| -> io::Result<()> {
        file.write_all(content)?;
        file.sync_all()?;
        if let Some(ref permissions) = existing_permissions {
            fs::set_permissions(&temporary, permissions.clone())?;
        }
        fs::rename(&temporary, &destination)?;
        sync_parent_dir(parent);
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }

    result
}

#[cfg(unix)]
fn sync_parent_dir(parent: &Path) {
    if let Ok(dir) = File::open(parent) {
        let _ = dir.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_parent_dir(_parent: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn preserves_existing_file_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.bpmn");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        atomic_write(&path, b"new content").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");
    }

    #[cfg(unix)]
    #[test]
    fn writes_through_symlink_and_keeps_the_link() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let real_path = dir.path().join("real.bpmn");
        let link_path = dir.path().join("link.bpmn");
        fs::write(&real_path, "old").unwrap();
        symlink(&real_path, &link_path).unwrap();

        atomic_write(&link_path, b"new content").unwrap();

        let meta = fs::symlink_metadata(&link_path).unwrap();
        assert!(meta.file_type().is_symlink(), "link should still be a symlink");
        assert_eq!(fs::read_to_string(&real_path).unwrap(), "new content");
    }

    #[test]
    fn writes_a_new_not_yet_existing_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("new.bpmn");

        atomic_write(&path, b"hello").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn two_consecutive_writes_succeed_and_leave_no_tmp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.bpmn");

        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "second");

        let leftover_tmp = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!leftover_tmp, "no .tmp files should remain");
    }
}
