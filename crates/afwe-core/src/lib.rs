//! AFWE core engine — the machine that reads and writes the `.afwe/` folder.
//! The engine is replaceable; the folder is the product.
//!
//! ```text
//!                 LLM HARNESS
//!                     │  (MCP / CLI)
//!                     ▼
//! ┌────────────────────────────────────────┐
//! │ AFWE                                   │
//! │  blueprint · memory · guardrails ·     │
//! │  workflows · lenses · contracts        │
//! │  drift detection · context retrieval   │
//! └───────────────────┬────────────────────┘
//!                     ▼
//!                    IDE / code
//! ```

pub mod analyze;
pub mod api;
pub mod authority;
pub mod authority_store;
pub mod baseline;
pub mod calibration;
pub mod claims;
pub mod conflict;
pub mod context;
pub mod contract;
pub mod drift;
pub mod engine;
pub mod escalation;
pub mod events;
pub mod gate;
pub mod header;
pub mod heal_executor;
pub mod heal_policy;
pub mod index;
pub mod init;
pub mod install;
pub mod intent;
pub mod judgment;
pub mod lease;
pub mod ledger;
pub mod lens;
pub mod mapping;
pub mod materialize;
pub mod mission;
pub mod model;
pub mod onboard;
pub mod ops;
pub mod outbox;
pub mod project_registry;
pub mod queue;
pub mod registry;
pub mod rollback;
pub mod scene;
pub mod store;
pub mod sync;
pub mod terminology;
pub mod timeline;
pub mod timeline_4d;
pub mod turn;
pub mod unattributed;
pub mod util;
pub mod vcs;
pub mod verify;

pub use engine::{Engine, Snapshot};
pub use store::Store;

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
