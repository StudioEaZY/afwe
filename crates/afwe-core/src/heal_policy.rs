//! Scope Boundary & Remediation Policy (Section 0 Allowlist & Derivability Check).
//!
//! AFWE detects, organizes, routes and safely executes. It never authors new code
//! without a recorded baseline or makes architectural decisions on behalf of the developer.
//!
//! Allowlisted Remediation Action Kinds:
//! - `restore_dropped_file`: Restores a file deleted collaterally if its baseline blob is unchanged.
//! - `revert_turn`: Inverse commit of a specific turn parent.
//! - `apply_conflict_free_merge`: 3-way merge where no conflict markers exist (requires prompter approval unless auto_merge opt-in is enabled).
//! - `attribute_commit`: Human-only retroactive turn attribution for manual git commits.
//!
//! Derivability Rule:
//! Every byte written during remediation must derive directly from a recorded git blob
//! or deterministic merge of recorded blobs. Zero model calls in `afwe-core`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemediationKind {
    RestoreDroppedFile,
    RevertTurn,
    ApplyConflictFreeMerge,
    AttributeCommit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemediationProposal {
    pub kind: RemediationKind,
    pub target_file: String,
    pub baseline_blob_hash: String,
    pub parent_turn: String,
}

/// Validates whether an action kind is strictly allowlisted.
pub fn is_allowlisted(kind: RemediationKind) -> bool {
    matches!(
        kind,
        RemediationKind::RestoreDroppedFile
            | RemediationKind::RevertTurn
            | RemediationKind::ApplyConflictFreeMerge
            | RemediationKind::AttributeCommit
    )
}

/// Derivability check: verifies that the target bytes match the exact recorded baseline blob hash.
pub fn verify_derivability(content: &[u8], expected_hash: &str) -> bool {
    let actual_hash = blake3::hash(content).to_hex().to_string();
    actual_hash == expected_hash
}

/// Checks whether a proposed remediation can be executed automatically under the current authority delegation.
pub fn can_auto_execute(
    kind: RemediationKind,
    auto_merge: bool,
    budget_used: u32,
    budget_max: u32,
) -> bool {
    if budget_used >= budget_max {
        return false;
    }

    match kind {
        RemediationKind::RestoreDroppedFile => true,
        RemediationKind::ApplyConflictFreeMerge => auto_merge,
        RemediationKind::RevertTurn => true,
        RemediationKind::AttributeCommit => false, // Human only
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derivability_check() {
        let bytes = b"exact recorded baseline content\n";
        let hash = blake3::hash(bytes).to_hex().to_string();
        assert!(verify_derivability(bytes, &hash));
        assert!(!verify_derivability(b"different content", &hash));
    }

    #[test]
    fn test_auto_execute_limits() {
        assert!(can_auto_execute(RemediationKind::RestoreDroppedFile, false, 0, 5));
        assert!(!can_auto_execute(RemediationKind::RestoreDroppedFile, false, 5, 5));
        assert!(!can_auto_execute(RemediationKind::ApplyConflictFreeMerge, false, 0, 5));
        assert!(can_auto_execute(RemediationKind::ApplyConflictFreeMerge, true, 0, 5));
        assert!(!can_auto_execute(RemediationKind::AttributeCommit, true, 0, 5));
    }
}
