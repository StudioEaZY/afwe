use std::path::PathBuf;
use std::process::Command;
use anyhow::{bail, Result};

pub struct AutostartManager;

impl AutostartManager {
    /// Return the executable path of the running afwe binary
    pub fn current_exe() -> Result<PathBuf> {
        let p = std::env::current_exe()?;
        Ok(p)
    }

    /// Check if autostart is currently installed on the host
    pub fn is_installed() -> Result<bool> {
        #[cfg(target_os = "windows")]
        {
            let output = Command::new("reg")
                .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "AFWEPresenceWatcher"])
                .output()?;
            Ok(output.status.success())
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                let p = PathBuf::from(home).join("Library/LaunchAgents/dev.afwe.presence.plist");
                Ok(p.exists())
            } else {
                Ok(false)
            }
        }
        #[cfg(target_os = "linux")]
        {
            if let Ok(home) = std::env::var("HOME") {
                let p = PathBuf::from(home).join(".config/systemd/user/afwe-presence.service");
                Ok(p.exists())
            } else {
                Ok(false)
            }
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok(false)
        }
    }

    /// Install autostart so `afwe presence run` starts automatically at user login
    pub fn install() -> Result<()> {
        let exe = Self::current_exe()?;
        let exe_str = exe.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        {
            let cmd_str = format!("\"{}\" presence run", exe_str);
            let status = Command::new("reg")
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", "AFWEPresenceWatcher",
                    "/t", "REG_SZ",
                    "/d", &cmd_str,
                    "/f",
                ])
                .status()?;
            if !status.success() {
                bail!("Failed to register Windows Run key AFWEPresenceWatcher");
            }
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            let home = std::env::var("HOME")?;
            let plist_dir = PathBuf::from(home).join("Library/LaunchAgents");
            std::fs::create_dir_all(&plist_dir)?;
            let plist_path = plist_dir.join("dev.afwe.presence.plist");
            let plist_content = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>dev.afwe.presence</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
        <string>presence</string>
        <string>run</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>"#,
                exe_str
            );
            std::fs::write(&plist_path, plist_content)?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let home = std::env::var("HOME")?;
            let service_dir = PathBuf::from(home).join(".config/systemd/user");
            std::fs::create_dir_all(&service_dir)?;
            let service_path = service_dir.join("afwe-presence.service");
            let service_content = format!(
                r#"[Unit]
Description=AFWE Headless Presence Watcher
After=default.target

[Service]
ExecStart={} presence run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
"#,
                exe_str
            );
            std::fs::write(&service_path, service_content)?;
            let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
            let _ = Command::new("systemctl").args(["--user", "enable", "--now", "afwe-presence"]).status();
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            bail!("Autostart not supported on this platform");
        }
    }

    /// Remove the autostart registration
    pub fn uninstall() -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new("reg")
                .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "AFWEPresenceWatcher", "/f"])
                .status();
            Ok(())
        }
        #[cfg(target_os = "macos")]
        {
            if let Ok(home) = std::env::var("HOME") {
                let plist_path = PathBuf::from(home).join("Library/LaunchAgents/dev.afwe.presence.plist");
                if plist_path.exists() {
                    let _ = std::fs::remove_file(plist_path);
                }
            }
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let _ = Command::new("systemctl").args(["--user", "disable", "--now", "afwe-presence"]).status();
            if let Ok(home) = std::env::var("HOME") {
                let service_path = PathBuf::from(home).join(".config/systemd/user/afwe-presence.service");
                if service_path.exists() {
                    let _ = std::fs::remove_file(service_path);
                }
            }
            let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
            Ok(())
        }
        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        {
            Ok(())
        }
    }
}
