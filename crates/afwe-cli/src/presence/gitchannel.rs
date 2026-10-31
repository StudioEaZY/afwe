use std::path::Path;
use std::process::Command;
use serde_json::Value;
use anyhow::{bail, Result};

pub struct GitChannelClient;

impl GitChannelClient {
    /// Poll a remote repository ref to check if outbox facts have changed
    pub fn poll_remote_outbox(remote_url: &str, project_id: &str) -> Result<Option<String>> {
        let ref_name = format!("refs/afwe/outbox/{}", project_id);
        let output = Command::new("git")
            .args(["ls-remote", remote_url, &ref_name])
            .output()?;

        if !output.status.success() {
            bail!("Failed to execute git ls-remote on {}", remote_url);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let sha = stdout.split_whitespace().next().map(|s| s.to_string());
        Ok(sha)
    }

    /// Push a human reply message into the remote inbox ref
    pub fn send_inbox_reply(project_dir: &Path, project_id: &str, reply: &Value) -> Result<()> {
        let serialized = serde_json::to_string(reply)?;
        let ref_name = format!("refs/afwe/inbox/{}", project_id);

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
        let blob_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();

        let _ = Command::new("git")
            .current_dir(project_dir)
            .args(["update-ref", &ref_name, &blob_sha])
            .status()?;

        // Push ref to origin if remote is configured
        let _ = Command::new("git")
            .current_dir(project_dir)
            .args(["push", "origin", &format!("{}:{}", ref_name, ref_name)])
            .status();

        Ok(())
    }
}
