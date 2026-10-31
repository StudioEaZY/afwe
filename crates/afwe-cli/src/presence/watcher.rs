use std::path::Path;
use std::thread;
use std::time::Duration;
use anyhow::Result;
use afwe_core::events::EventFeed;
use afwe_core::project_registry::ProjectRegistry;

pub struct PresenceWatcher;

impl PresenceWatcher {
    /// Run the headless presence loop, monitoring all registered projects
    pub fn run() -> Result<()> {
        println!("⛨ AFWE Presence Watcher started (headless mode)");
        println!("Monitoring registered projects across this host...");

        let mut reg = ProjectRegistry::load()?;
        if reg.projects.is_empty() {
            println!("  (No projects registered in user registry yet. Use `afwe registry add <path>` or `afwe install-project`)");
        }

        loop {
            // Reload registry periodically in case new projects are added
            if let Ok(updated) = ProjectRegistry::load() {
                reg = updated;
            }

            let mut seq_updates: Vec<(String, u64)> = Vec::new();
            for p in &reg.projects {
                let project_path = Path::new(&p.path);
                if !project_path.exists() {
                    continue;
                }

                let feed = EventFeed::for_project(project_path);
                if let Ok(events) = feed.read_since(p.last_seen_seq) {
                    for event in events {
                        Self::dispatch_event(&p.name, &event);
                        seq_updates.push((p.id.clone(), event.seq));
                    }
                }
            }

            for (id, seq) in seq_updates {
                let _ = reg.update_last_seen_seq(&id, seq);
            }

            thread::sleep(Duration::from_millis(1000));
        }
    }

    /// Dispatch a presence event to notification/card sinks
    fn dispatch_event(project_name: &str, event: &afwe_core::events::PresenceEvent) {
        let policy = super::policy::PresencePolicy::load();
        let is_human_floor = event.requires_human;
        let route = policy.resolve_route(&event.kind, is_human_floor);

        // If routed to prompter_delegated or silent, check authority
        if route == super::policy::RouteTarget::Silent {
            return;
        }

        let style = policy.resolve_style(&event.kind, is_human_floor);
        let badge = match style {
            super::policy::NotificationStyle::StickyCard => "STICKY CARD",
            super::policy::NotificationStyle::LongToast => "LONG TOAST",
            super::policy::NotificationStyle::Toast => "TOAST (30s)",
            super::policy::NotificationStyle::BadgeOnly => "BADGE ONLY",
            super::policy::NotificationStyle::Digest => "DIGEST",
        };

        println!(
            "\x1b[38;2;147;197;253;1m⛨ [Presence Notification - {}]\x1b[0m project={} kind={} seq=#{}",
            badge, project_name, event.kind, event.seq
        );
        println!("  Title:  {}", event.title);
        println!("  Detail: {}", event.detail);
        if let Some(quote) = &event.agent_quote {
            println!("  Agent Said: \"{}\"", quote);
        }
        if !event.touched_files.is_empty() {
            println!("  Touched: {}", event.touched_files.join(", "));
        }

        #[cfg(target_os = "windows")]
        {
            // Windows PowerShell notification toast fallback when GUI card is not active
            let escaped_title = event.title.replace('"', "`\"");
            let escaped_detail = event.detail.replace('"', "`\"");
            let ps_script = format!(
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; \
                 $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
                 $xml = [Windows.Data.Xml.Dom.XmlDocument]::new(); \
                 $xml.LoadXml($template.GetXml()); \
                 $textNodes = $xml.GetElementsByTagName('text'); \
                 $textNodes.Item(0).AppendChild($xml.CreateTextNode('AFWE: {}')) > $null; \
                 $textNodes.Item(1).AppendChild($xml.CreateTextNode('{}')) > $null; \
                 $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); \
                 [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AFWE').Show($toast);",
                escaped_title, escaped_detail
            );
            let _ = std::process::Command::new("powershell")
                .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_script])
                .spawn();
        }
    }
}
