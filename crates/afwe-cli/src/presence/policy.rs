use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteTarget {
    Human,
    PrompterDelegated,
    Both,
    Silent,
}

impl Default for RouteTarget {
    fn default() -> Self {
        Self::Human
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationStyle {
    StickyCard,
    LongToast,
    Toast,
    BadgeOnly,
    Digest,
}

impl Default for NotificationStyle {
    fn default() -> Self {
        Self::Toast
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresencePolicy {
    #[serde(default)]
    pub sticky_all: bool,
    #[serde(default)]
    pub native_alongside_card: bool,
    #[serde(default)]
    pub quiet_hours: Option<QuietHours>,
    #[serde(default)]
    pub routes: HashMap<String, RouteTarget>,
    #[serde(default)]
    pub styles: HashMap<String, NotificationStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuietHours {
    pub start_hour: u32,
    pub end_hour: u32,
}

impl Default for PresencePolicy {
    fn default() -> Self {
        let mut routes = HashMap::new();
        // Defaults: mid_turn proposals routed to delegation holder if present, turn_end to human
        routes.insert("mid_turn.*".to_string(), RouteTarget::PrompterDelegated);
        routes.insert("turn_end.*".to_string(), RouteTarget::Human);

        let mut styles = HashMap::new();
        styles.insert("turn.committed".to_string(), NotificationStyle::Toast);
        styles.insert("turn.staged".to_string(), NotificationStyle::StickyCard);
        styles.insert("turn.redo".to_string(), NotificationStyle::Toast);
        styles.insert("turn.ready".to_string(), NotificationStyle::Toast);
        styles.insert("human_floor.*".to_string(), NotificationStyle::StickyCard);
        styles.insert("unattributed.*".to_string(), NotificationStyle::StickyCard);

        Self {
            sticky_all: false,
            native_alongside_card: true,
            quiet_hours: None,
            routes,
            styles,
        }
    }
}

impl PresencePolicy {
    pub fn config_path() -> PathBuf {
        if let Ok(app_data) = std::env::var("APPDATA") {
            PathBuf::from(app_data).join("afwe").join("presence.toml")
        } else if let Ok(home) = std::env::var("HOME") {
            PathBuf::from(home).join(".config").join("afwe").join("presence.toml")
        } else {
            PathBuf::from("presence.toml")
        }
    }

    pub fn load() -> Self {
        let p = Self::config_path();
        if !p.exists() {
            return Self::default();
        }
        if let Ok(data) = fs::read_to_string(&p) {
            if let Ok(cfg) = toml::from_str::<PresencePolicy>(&data) {
                return cfg;
            }
        }
        Self::default()
    }

    pub fn save(&self) -> Result<()> {
        let p = Self::config_path();
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        let data = toml::to_string_pretty(self)?;
        fs::write(&p, data)?;
        Ok(())
    }

    /// Resolve routing for a given event kind (considering human floor rules)
    pub fn resolve_route(&self, kind: &str, is_human_floor: bool) -> RouteTarget {
        // Human floor actions ignore route settings and ALWAYS go to the human
        if is_human_floor {
            return RouteTarget::Human;
        }

        // Direct match
        if let Some(target) = self.routes.get(kind) {
            return target.clone();
        }

        // Wildcard match
        if kind.starts_with("turn.begin") || kind.starts_with("turn.staged") {
            if let Some(target) = self.routes.get("mid_turn.*") {
                return target.clone();
            }
        }
        if kind.starts_with("turn.committed") || kind.starts_with("turn.ready") || kind.starts_with("turn.redo") {
            if let Some(target) = self.routes.get("turn_end.*") {
                return target.clone();
            }
        }

        RouteTarget::Human
    }

    /// Resolve display style for an event kind
    pub fn resolve_style(&self, kind: &str, requires_human: bool) -> NotificationStyle {
        if self.sticky_all || requires_human {
            return NotificationStyle::StickyCard;
        }
        if let Some(style) = self.styles.get(kind) {
            return style.clone();
        }
        NotificationStyle::Toast
    }
}
