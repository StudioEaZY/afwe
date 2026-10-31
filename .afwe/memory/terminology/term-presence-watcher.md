# Presence Watcher

A lightweight, zero-GUI background daemon (`afwe presence run`) started at user login via OS autostart (Windows Scheduled Task, macOS LaunchAgent, Linux systemd user service). It monitors registered repositories listed in the user-level project registry, streams sequenced lifecycle events, applies user notification routing policies (`presence.toml`), and raises OS notifications or spawns compact always-on-top cards without stealing active typing focus.
