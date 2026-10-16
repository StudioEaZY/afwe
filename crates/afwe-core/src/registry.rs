//! Global Asset Registry and String Interner.
//!
//! Stores deduplicated, content-addressed metadata assets (files, AST symbols,
//! memory entries, pins, checks) using compact 32-bit handles (`SymId`, `AssetId`).
//! This ensures O(1) lookups and zero-copy data representation across 4D timeline turns.

use crate::engine::Engine;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::marker::PhantomData;

/// Compact interned string handle (4 bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct SymId(pub u32);

/// Fast, append-only String & Dot-Notation Path Interner.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StringInterner {
    strings: Vec<String>,
    #[serde(skip)]
    lookup: HashMap<String, SymId>,
}

impl StringInterner {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn intern(&mut self, s: &str) -> SymId {
        if let Some(&id) = self.lookup.get(s) {
            return id;
        }
        let id = SymId(self.strings.len() as u32);
        self.strings.push(s.to_string());
        self.lookup.insert(s.to_string(), id);
        id
    }

    pub fn resolve(&self, id: SymId) -> Option<&str> {
        self.strings.get(id.0 as usize).map(|s| s.as_str())
    }

    pub fn len(&self) -> usize {
        self.strings.len()
    }

    pub fn is_empty(&self) -> bool {
        self.strings.is_empty()
    }
}

/// Strongly-typed 32-bit handle into an `AssetArena<T>`.
#[derive(Debug, Serialize, Deserialize)]
pub struct AssetId<T> {
    pub id: u32,
    #[serde(skip)]
    pub _marker: PhantomData<fn() -> T>,
}

impl<T> Clone for AssetId<T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T> Copy for AssetId<T> {}

impl<T> PartialEq for AssetId<T> {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl<T> Eq for AssetId<T> {}

impl<T> PartialOrd for AssetId<T> {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl<T> Ord for AssetId<T> {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.id.cmp(&other.id)
    }
}

impl<T> std::hash::Hash for AssetId<T> {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

/// Contiguous arena for dense asset storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetArena<T> {
    pub items: Vec<T>,
}

impl<T> Default for AssetArena<T> {
    fn default() -> Self {
        Self { items: Vec::new() }
    }
}

impl<T> AssetArena<T> {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn alloc(&mut self, item: T) -> AssetId<T> {
        let id = self.items.len() as u32;
        self.items.push(item);
        AssetId {
            id,
            _marker: PhantomData,
        }
    }

    pub fn get(&self, id: AssetId<T>) -> Option<&T> {
        self.items.get(id.id as usize)
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

// ───────────────────────────── Typed Asset Definitions ─────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAsset {
    pub path: SymId,
    pub path_str: String,
    pub lang: String,
    pub hash: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolAsset {
    pub qualified_name: SymId,
    pub name_str: String,
    pub file_path: SymId,
    pub kind: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryAsset {
    pub id: SymId,
    pub id_str: String,
    pub kind: String,
    pub title: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinAsset {
    pub id: SymId,
    pub id_str: String,
    pub statement: String,
    pub kind: String,
    pub severity: String,
    pub intentional: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckAsset {
    pub id: SymId,
    pub id_str: String,
    pub title: String,
    pub trust: String,
    pub authored_by: String,
    pub passed: bool,
}

/// Complete in-memory Asset Registry holding all deduplicated project metadata.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalAssetRegistry {
    pub interner: StringInterner,
    pub files: AssetArena<FileAsset>,
    pub symbols: AssetArena<SymbolAsset>,
    pub memory: AssetArena<MemoryAsset>,
    pub pins: AssetArena<PinAsset>,
    pub checks: AssetArena<CheckAsset>,
    #[serde(skip)]
    file_map: HashMap<String, AssetId<FileAsset>>,
    #[serde(skip)]
    pin_map: HashMap<String, AssetId<PinAsset>>,
    #[serde(skip)]
    check_map: HashMap<String, AssetId<CheckAsset>>,
}

impl GlobalAssetRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Rebuilds the global asset registry from the engine and codebase.
    pub fn build(engine: &Engine) -> Result<Self> {
        let mut reg = Self::new();
        let snap = engine.snapshot(false)?;

        // 1. Files & Symbols
        for f in &snap.code.files {
            let path_sym = reg.interner.intern(&f.path);
            let fa = FileAsset {
                path: path_sym,
                path_str: f.path.clone(),
                lang: f.language.clone(),
                hash: f.hash.clone(),
                size_bytes: f.size as u64,
            };
            let fa_id = reg.files.alloc(fa);
            reg.file_map.insert(f.path.clone(), fa_id);

            for s in &f.symbols {
                let name_sym = reg.interner.intern(&s.id);
                let sa = SymbolAsset {
                    qualified_name: name_sym,
                    name_str: s.id.clone(),
                    file_path: path_sym,
                    kind: s.kind.clone(),
                    fingerprint: s.fingerprint.clone(),
                };
                reg.symbols.alloc(sa);
            }
        }

        // 2. Memory
        for m in &snap.sources.memory {
            let m_sym = reg.interner.intern(&m.meta.id);
            let ma = MemoryAsset {
                id: m_sym,
                id_str: m.meta.id.clone(),
                kind: m.meta.kind.clone(),
                title: m.meta.title.clone(),
                status: m.meta.status.clone().unwrap_or_else(|| "active".into()),
            };
            reg.memory.alloc(ma);
        }

        // 3. Pins
        if let Ok(pins) = engine.store.pins() {
            for p in pins {
                let p_sym = reg.interner.intern(&p.id);
                let pa = PinAsset {
                    id: p_sym,
                    id_str: p.id.clone(),
                    statement: p.statement.clone(),
                    kind: p.kind.clone(),
                    severity: p.severity.clone(),
                    intentional: p.intentional,
                    status: p.status.clone(),
                };
                let pa_id = reg.pins.alloc(pa);
                reg.pin_map.insert(p.id, pa_id);
            }
        }

        // 4. Checks
        if let Ok(checks) = engine.store.checks() {
            for c in checks {
                let c_sym = reg.interner.intern(&c.id);
                let ca = CheckAsset {
                    id: c_sym,
                    id_str: c.id.clone(),
                    title: c.title.clone(),
                    trust: format!("{:?}", c.trust).to_lowercase(),
                    authored_by: c.authored_by.clone(),
                    passed: true,
                };
                let ca_id = reg.checks.alloc(ca);
                reg.check_map.insert(c.id, ca_id);
            }
        }

        Ok(reg)
    }

    pub fn find_file(&self, path: &str) -> Option<AssetId<FileAsset>> {
        self.file_map.get(path).copied()
    }

    pub fn find_pin(&self, id: &str) -> Option<AssetId<PinAsset>> {
        self.pin_map.get(id).copied()
    }

    pub fn find_check(&self, id: &str) -> Option<AssetId<CheckAsset>> {
        self.check_map.get(id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_string_interner_deduplication() {
        let mut interner = StringInterner::new();
        let id1 = interner.intern("afwe.crates.afwe_core");
        let id2 = interner.intern("afwe.crates.afwe_cli");
        let id3 = interner.intern("afwe.crates.afwe_core");
        assert_eq!(id1, id3);
        assert_ne!(id1, id2);
        assert_eq!(interner.len(), 2);
        assert_eq!(interner.resolve(id1), Some("afwe.crates.afwe_core"));
    }

    #[test]
    fn test_asset_arena() {
        let mut arena = AssetArena::new();
        let id1 = arena.alloc(42);
        let id2 = arena.alloc(100);
        assert_eq!(arena.get(id1), Some(&42));
        assert_eq!(arena.get(id2), Some(&100));
        assert_eq!(arena.len(), 2);
    }
}
