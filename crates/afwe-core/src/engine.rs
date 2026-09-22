//! Engine entry point: opens a project, loads sources, (re)analyses code and exposes a
//! consistent in‑memory snapshot to every operation.

use crate::analyze::Analyzer;
use crate::index::build_index;
use crate::mapping::{compute_mapping, MappingResult, NodeTable};
use crate::model::*;
use crate::store::{Sources, Store};
use crate::util::now;
use anyhow::Result;
use std::path::Path;

pub struct Engine {
    pub store: Store,
}

/// Everything an operation may need, loaded once.
pub struct Snapshot {
    pub manifest: Manifest,
    pub sources: Sources,
    pub table: NodeTable,
    pub code: CodeModel,
    pub mapping: MappingResult,
    pub index: Index,
    /// true when the code model was freshly analysed (not read from cache)
    pub fresh: bool,
}

impl Engine {
    pub fn open(path: impl AsRef<Path>) -> Result<Engine> {
        Ok(Engine { store: Store::discover(path)? })
    }

    pub fn at(project_root: impl AsRef<Path>) -> Engine {
        Engine { store: Store::new(project_root) }
    }

    pub fn analyzer(&self, m: &Manifest) -> Analyzer {
        Analyzer::new(self.store.code_root(m), m.analyzer.clone())
    }

    /// Load sources + code model. `refresh` forces re‑analysis; otherwise the cached
    /// `index/code.json` is used when present.
    pub fn snapshot(&self, refresh: bool) -> Result<Snapshot> {
        let sources = self.store.sources()?;
        let manifest = sources.manifest.clone().expect("manifest");
        let (code, fresh) = match (refresh, self.store.code_model()?) {
            (false, Some(c)) => (c, false),
            _ => (self.analyzer(&manifest).analyze()?, true),
        };
        self.build(manifest, sources, code, fresh)
    }

    pub fn snapshot_with_code(&self, code: CodeModel) -> Result<Snapshot> {
        let sources = self.store.sources()?;
        let manifest = sources.manifest.clone().expect("manifest");
        self.build(manifest, sources, code, true)
    }

    fn build(&self, manifest: Manifest, sources: Sources, code: CodeModel, fresh: bool) -> Result<Snapshot> {
        let table = NodeTable::from_blueprint(&sources.blueprint);
        let mapping = compute_mapping(&table, &code)?;
        let index = build_index(&sources, &table, &code, &mapping);
        Ok(Snapshot { manifest, sources, table, code, mapping, index, fresh })
    }

    /// Persist derived state of a snapshot (index + code model).
    pub fn persist_derived(&self, s: &Snapshot) -> Result<()> {
        self.store.save_code_model(&s.code)?;
        self.store.save_index(&s.index)?;
        Ok(())
    }

    pub fn log(&self, origin: &str, kind: &str, summary: impl Into<String>, details: Option<serde_json::Value>) -> Result<()> {
        self.store.append_log(&LogEntry {
            ts: now(),
            origin: origin.to_string(),
            kind: kind.to_string(),
            summary: summary.into(),
            confidence: None,
            uncertain: false,
            task: None,
            details,
        })
    }

    pub fn log_entry(&self, e: LogEntry) -> Result<()> {
        self.store.append_log(&e)
    }

    /// Is the persisted graph in sync with the files on disk?
    pub fn sync_status(&self) -> Result<SyncStatus> {
        let st = self.store.sync_state()?;
        if st.last_sync.is_none() {
            return Ok(SyncStatus { status: "never_synced".into(), last_sync: None, code_changed: true, afwe_changed: true });
        }
        let m = self.store.manifest()?;
        let code_fp = self.analyzer(&m).analyze().map(|c| c.fingerprint).unwrap_or_default();
        let afwe_fp = self.store.afwe_fingerprint();
        let code_changed = code_fp != st.code_fingerprint;
        let afwe_changed = afwe_fp != st.afwe_fingerprint;
        Ok(SyncStatus {
            status: if code_changed || afwe_changed { "stale".into() } else { "in_sync".into() },
            last_sync: st.last_sync,
            code_changed,
            afwe_changed,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SyncStatus {
    /// in_sync | stale | never_synced
    pub status: String,
    pub last_sync: Option<String>,
    pub code_changed: bool,
    pub afwe_changed: bool,
}
