use std::path::Path;
use std::process::Command;
use serde_json::Value;
use anyhow::{bail, Result};

pub struct GitOutbox;

impl GitOutbox {
    /// Update or write the project's outbox ref with current queue structured facts
    pub fn update_outbox_ref(project_dir: &Path, project_id: &str, facts: &Value) -> Result<()> {
        let serialized = serde_json::to_string(facts)?;
        let ref_name = format!("refs/afwe/outbox/{}", project_id);

        // Create a blob directly via git hash-object
        let mut child = Command::new("git")
            .current_dir(project_dir)
            .args(["hash-object", "-w", "--stdin"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(serialized.as_bytes())?;
        }

        let output = child.wait_with_output()?;
        if !output.status.success() {
            bail!("Failed to create git blob for outbox ref");
        }

        let blob_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // Update ref without advancing commit history (lightweight ref)
        let update_status = Command::new("git")
            .current_dir(project_dir)
            .args(["update-ref", &ref_name, &blob_sha])
            .status()?;

        if !update_status.success() {
            bail!("Failed to update git outbox ref {}", ref_name);
        }

        Ok(())
    }

    /// Read steering replies from the project's inbox ref
    pub fn read_inbox_ref(project_dir: &Path, project_id: &str) -> Result<Option<Value>> {
        let ref_name = format!("refs/afwe/inbox/{}", project_id);
        let output = Command::new("git")
            .current_dir(project_dir)
            .args(["cat-file", "-p", &ref_name])
            .output()?;

        if !output.status.success() {
            return Ok(None);
        }

        let content = String::from_utf8_lossy(&output.stdout);
        if let Ok(val) = serde_json::from_str::<Value>(&content) {
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }
}
