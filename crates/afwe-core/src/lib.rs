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
pub mod context;
pub mod contract;
pub mod drift;
pub mod engine;
pub mod index;
pub mod init;
pub mod lens;
pub mod mapping;
pub mod model;
pub mod ops;
pub mod store;
pub mod sync;
pub mod util;
pub mod verify;

pub use engine::{Engine, Snapshot};
pub use store::Store;

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
