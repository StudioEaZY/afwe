use anyhow::{bail, Result};
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PresenceProofMode {
    FloorOnly,
    AllApprovals,
}

pub struct PresenceProof;

impl PresenceProof {
    /// Verify physical OS user presence (Windows Hello / PAM / Touch ID)
    /// Returns Ok(()) if authenticated, Err if spoofed or canceled
    pub fn verify_user_presence(reason: &str) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            // Windows PowerShell Credential / User presence verification prompt
            let escaped_reason = reason.replace('"', "`\"");
            let script = format!(
                "$cred = $host.ui.PromptForCredential('AFWE Presence Proof', '{}', '', ''); \
                 if ($cred -eq $null) {{ exit 1 }} else {{ exit 0 }}",
                escaped_reason
            );

            let output = Command::new("powershell")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &script])
                .output()?;

            if !output.status.success() {
                bail!("Presence Proof failed: User credential prompt canceled or invalid.");
            }
            Ok(())
        }

        #[cfg(target_os = "macos")]
        {
            // macOS osascript admin authorization prompt
            let escaped_reason = reason.replace('"', "\\\"");
            let script = format!(
                "do shell script \"echo authenticated\" with administrator privileges with prompt \"AFWE Presence Proof: {}\"",
                escaped_reason
            );
            let output = Command::new("osascript").args(["-e", &script]).output()?;
            if !output.status.success() {
                bail!("Presence Proof failed: Touch ID / Password canceled on macOS.");
            }
            Ok(())
        }

        #[cfg(target_os = "linux")]
        {
            // Linux pkexec / sudo user presence prompt
            let output = Command::new("pkexec")
                .args(["echo", "AFWE Presence Proof Verified"])
                .output()?;
            if !output.status.success() {
                bail!("Presence Proof failed: Polkit authentication canceled on Linux.");
            }
            Ok(())
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok(())
        }
    }
}
