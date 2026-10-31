use std::process::Command;
use anyhow::{bail, Result};

pub struct RemoteSshFollower;

impl RemoteSshFollower {
    /// Test connection and pair host key fingerprint
    pub fn pair_host(ssh_host: &str) -> Result<String> {
        let output = Command::new("ssh")
            .args(["-o", "BatchMode=yes", ssh_host, "afwe header"])
            .output()?;

        if !output.status.success() {
            bail!("Failed to reach AFWE on remote host {}", ssh_host);
        }

        let header = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(header)
    }

    /// Spawn an SSH streaming process tailing `afwe events --follow --json` on a paired host
    pub fn spawn_event_stream(ssh_host: &str, project_path: &str, after_seq: u64) -> Result<std::process::Child> {
        let cmd = format!("afwe -C \"{}\" events --follow --json --after {}", project_path, after_seq);
        let child = Command::new("ssh")
            .args(["-o", "BatchMode=yes", ssh_host, &cmd])
            .stdout(std::process::Stdio::piped())
            .spawn()?;

        Ok(child)
    }
}
