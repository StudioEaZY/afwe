//! DOTS-Inspired Hierarchical Scene Graph & Component System.
//!
//! Replaces pointer-heavy graph models with cache-friendly contiguous arrays
//! indexed by compact `EntityId(u32)` handles and addressed via canonical
//! dot-notation paths (`afwe.crates.afwe_core`).

use crate::engine::{Engine, Snapshot};
use crate::model::*;
use crate::registry::*;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// Dense 32-bit entity handle for architectural nodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct EntityId(pub u32);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IdentityComponent {
    pub name: String,
    pub dot_path: String,
    pub kind: String,
    pub status: String,
    pub purpose: Option<String>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ImplComponent {
    pub files: Vec<AssetId<FileAsset>>,
    pub file_paths: Vec<String>,
    pub symbols_count: usize,
    pub unmapped: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GovernanceComponent {
    pub pins: Vec<AssetId<PinAsset>>,
    pub pin_ids: Vec<String>,
    pub constraints_count: usize,
    pub guardrails_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VerificationComponent {
    pub checks: Vec<AssetId<CheckAsset>>,
    pub check_ids: Vec<String>,
    pub confidence: f32,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LeaseComponent {
    pub agent: Option<String>,
    pub mission: Option<String>,
    pub is_locked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DeltaStatus {
    #[default]
    Unchanged,
    Added,
    Modified,
    CollateralLoss,
    Restored,
    PlannedFuture,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TemporalDeltaComponent {
    pub status: DeltaStatus,
    pub delta_files: i32,
    pub notes: Option<String>,
}

/// The hot 4D runtime Scene World.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SceneWorld {
    pub registry: GlobalAssetRegistry,
    pub entities: Vec<EntityId>,
    pub parents: Vec<Option<EntityId>>,
    pub children: Vec<Vec<EntityId>>,
    pub depths: Vec<usize>,

    // Component Tables (parallel dense arrays indexed by EntityId.0)
    pub identities: Vec<IdentityComponent>,
    pub implementations: Vec<ImplComponent>,
    pub governances: Vec<GovernanceComponent>,
    pub verifications: Vec<VerificationComponent>,
    pub leases: Vec<LeaseComponent>,
    pub deltas: Vec<TemporalDeltaComponent>,

    #[serde(skip)]
    dot_index: HashMap<String, EntityId>,
    #[serde(skip)]
    slug_index: HashMap<String, EntityId>,
}

impl SceneWorld {
    pub fn new(registry: GlobalAssetRegistry) -> Self {
        Self {
            registry,
            ..Default::default()
        }
    }

    pub fn alloc_entity(&mut self, parent: Option<EntityId>, depth: usize) -> EntityId {
        let id = EntityId(self.entities.len() as u32);
        self.entities.push(id);
        self.parents.push(parent);
        self.children.push(Vec::new());
        self.depths.push(depth);

        if let Some(p) = parent {
            if let Some(ch) = self.children.get_mut(p.0 as usize) {
                ch.push(id);
            }
        }

        self.identities.push(IdentityComponent::default());
        self.implementations.push(ImplComponent::default());
        self.governances.push(GovernanceComponent::default());
        self.verifications.push(VerificationComponent::default());
        self.leases.push(LeaseComponent::default());
        self.deltas.push(TemporalDeltaComponent::default());

        id
    }

    pub fn find_by_dot(&self, dot: &str) -> Option<EntityId> {
        self.dot_index.get(dot).copied().or_else(|| self.slug_index.get(dot).copied())
    }

    /// Evaluates queries like "afwe.crates.*", ".has(pin)", or exact dot-paths.
    pub fn query(&self, filter: &str) -> Vec<EntityId> {
        let f = filter.trim();
        if f.is_empty() || f == "*" {
            return self.entities.clone();
        }

        if f == ".has(pin)" {
            return self.entities.iter().filter(|&&e| !self.governances[e.0 as usize].pins.is_empty()).copied().collect();
        }

        if f == ".has(lease)" {
            return self.entities.iter().filter(|&&e| self.leases[e.0 as usize].is_locked).copied().collect();
        }

        if f == ".status(planned)" {
            return self.entities.iter().filter(|&&e| self.identities[e.0 as usize].status == "planned").copied().collect();
        }

        if f.ends_with(".*") {
            let prefix = f.trim_end_matches(".*");
            return self.entities.iter().filter(|&&e| {
                let dot = &self.identities[e.0 as usize].dot_path;
                dot == prefix || dot.starts_with(&format!("{prefix}."))
            }).copied().collect();
        }

        if let Some(e) = self.find_by_dot(f) {
            return vec![e];
        }

        self.entities.iter().filter(|&&e| {
            let ident = &self.identities[e.0 as usize];
            ident.name.to_lowercase().contains(&f.to_lowercase()) || ident.dot_path.contains(f)
        }).copied().collect()
    }

    /// Builds a hot Scene World from the project's current snapshot and engine.
    pub fn build(engine: &Engine) -> Result<Self> {
        let registry = GlobalAssetRegistry::build(engine)?;
        let mut world = Self::new(registry);
        let snap = engine.snapshot(false)?;
        let all_pins = engine.store.pins().unwrap_or_default();
        let all_checks = engine.store.checks().unwrap_or_default();

        // Recursive hierarchy builder with canonical dot-paths
        fn add_tree(
            world: &mut SceneWorld,
            node: &BlueprintNode,
            parent: Option<EntityId>,
            parent_dot: &str,
            depth: usize,
            snap: &Snapshot,
            all_pins: &[Pin],
            all_checks: &[CheckSpec],
        ) {
            let dot = if parent_dot.is_empty() {
                node.id.replace('-', "_")
            } else {
                format!("{}.{}", parent_dot, node.id.replace('-', "_"))
            };

            let entity = world.alloc_entity(parent, depth);

            // 1. Identity
            world.identities[entity.0 as usize] = IdentityComponent {
                name: node.name.clone(),
                dot_path: dot.clone(),
                kind: node.kind.clone(),
                status: node.status.clone().unwrap_or_else(|| "active".into()),
                purpose: node.purpose.clone(),
                origin: node.origin.clone().unwrap_or_else(|| "human".into()),
            };
            world.dot_index.insert(dot.clone(), entity);
            world.slug_index.insert(node.id.clone(), entity);

            // 2. Implementation
            let mut file_ids = Vec::new();
            let mut file_paths = Vec::new();
            if let Some(idx) = snap.index.nodes.get(&node.id) {
                for f in &idx.files {
                    file_paths.push(f.clone());
                    if let Some(aid) = world.registry.find_file(f) {
                        file_ids.push(aid);
                    }
                }
            }
            world.implementations[entity.0 as usize] = ImplComponent {
                files: file_ids,
                file_paths,
                symbols_count: snap.index.nodes.get(&node.id).map(|i| i.files.iter().filter_map(|p| snap.index.files.get(p)).map(|fi| fi.symbols.len()).sum()).unwrap_or(0),
                unmapped: false,
            };

            // 3. Governance (Pins, Constraints, Guardrails)
            let mut pins = Vec::new();
            let mut pin_ids = Vec::new();
            for p in all_pins.iter().filter(|p| p.status == "active" && (p.attaches.nodes.contains(&node.id) || p.attaches.global)) {
                pin_ids.push(p.id.clone());
                if let Some(aid) = world.registry.find_pin(&p.id) {
                    pins.push(aid);
                }
            }
            let constraints_count = snap.sources.constraints.constraints.iter().filter(|c| c.from == node.id || c.to.contains(&node.id)).count();
            let guardrails_count = snap.sources.guardrails.iter().filter(|g| g.scope.nodes.contains(&node.id) || g.scope.global).count();

            world.governances[entity.0 as usize] = GovernanceComponent {
                pins,
                pin_ids,
                constraints_count,
                guardrails_count,
            };

            // 4. Verification
            let mut checks = Vec::new();
            let mut check_ids = Vec::new();
            for c in all_checks.iter().filter(|c| c.attaches.nodes.contains(&node.id) || c.attaches.global) {
                check_ids.push(c.id.clone());
                if let Some(aid) = world.registry.find_check(&c.id) {
                    checks.push(aid);
                }
            }
            world.verifications[entity.0 as usize] = VerificationComponent {
                checks,
                check_ids,
                confidence: 1.0,
                passed: true,
            };

            // 5. Temporal Status
            if node.status.as_deref() == Some("planned") {
                world.deltas[entity.0 as usize].status = DeltaStatus::PlannedFuture;
            }

            for child in &node.children {
                add_tree(world, child, Some(entity), &dot, depth + 1, snap, all_pins, all_checks);
            }
        }

        let store_bp = engine.store.blueprint()?;
        for root in &store_bp.nodes {
            add_tree(&mut world, root, None, "", 0, &snap, &all_pins, &all_checks);
        }

        // 6. Active Leases
        if let Ok(active_leases) = crate::lease::list_active(engine) {
            for l in active_leases {
                if let Some(e) = world.find_by_dot(&l.node_id) {
                    world.leases[e.0 as usize] = LeaseComponent {
                        agent: Some(l.agent_id),
                        mission: Some(l.mission_id),
                        is_locked: true,
                    };
                }
            }
        }

        Ok(world)
    }

    /// Renders clean, high-performance JSON format for the Studio UI.
    pub fn to_studio_json(&self) -> Value {
        let nodes: Vec<Value> = self.entities.iter().map(|&e| {
            let idx = e.0 as usize;
            let ident = &self.identities[idx];
            let imp = &self.implementations[idx];
            let gov = &self.governances[idx];
            let ver = &self.verifications[idx];
            let lease = &self.leases[idx];
            let delta = &self.deltas[idx];

            json!({
                "id": ident.name,
                "dot_path": ident.dot_path,
                "kind": ident.kind,
                "status": ident.status,
                "purpose": ident.purpose,
                "origin": ident.origin,
                "depth": self.depths[idx],
                "parent": self.parents[idx].map(|p| self.identities[p.0 as usize].dot_path.clone()),
                "children": self.children[idx].iter().map(|&c| self.identities[c.0 as usize].dot_path.clone()).collect::<Vec<_>>(),
                "components": {
                    "impl": {
                        "files_count": imp.files.len(),
                        "files": imp.file_paths.iter().take(12).collect::<Vec<_>>(),
                        "symbols_count": imp.symbols_count,
                    },
                    "governance": {
                        "pins_count": gov.pins.len(),
                        "pin_ids": gov.pin_ids,
                        "constraints_count": gov.constraints_count,
                        "guardrails_count": gov.guardrails_count,
                    },
                    "verification": {
                        "checks_count": ver.checks.len(),
                        "check_ids": ver.check_ids,
                        "confidence": ver.confidence,
                        "passed": ver.passed,
                    },
                    "lease": {
                        "is_locked": lease.is_locked,
                        "agent": lease.agent,
                        "mission": lease.mission,
                    },
                    "delta": {
                        "status": format!("{:?}", delta.status).to_lowercase(),
                        "delta_files": delta.delta_files,
                        "notes": delta.notes,
                    }
                }
            })
        }).collect();

        json!({
            "entities_count": self.entities.len(),
            "nodes": nodes,
            "assets": {
                "files_count": self.registry.files.len(),
                "symbols_count": self.registry.symbols.len(),
                "memory_count": self.registry.memory.len(),
                "pins_count": self.registry.pins.len(),
                "checks_count": self.registry.checks.len(),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scene_world_allocation_and_dot_query() {
        let mut world = SceneWorld::new(GlobalAssetRegistry::new());
        let root = world.alloc_entity(None, 0);
        world.identities[root.0 as usize] = IdentityComponent {
            name: "afwe".into(),
            dot_path: "afwe".into(),
            kind: "product".into(),
            status: "active".into(),
            ..Default::default()
        };
        world.dot_index.insert("afwe".into(), root);

        let child = world.alloc_entity(Some(root), 1);
        world.identities[child.0 as usize] = IdentityComponent {
            name: "crates".into(),
            dot_path: "afwe.crates".into(),
            kind: "subsystem".into(),
            status: "active".into(),
            ..Default::default()
        };
        world.dot_index.insert("afwe.crates".into(), child);

        assert_eq!(world.find_by_dot("afwe.crates"), Some(child));
        assert_eq!(world.query("afwe.*").len(), 2);
    }
}
