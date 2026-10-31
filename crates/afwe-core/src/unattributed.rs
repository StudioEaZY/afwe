//! Skipping Resistance & Attribution (Section 6A).
//!
//! Provides:
//! - Working-tree and commit attribution scanner.
//! - Verification of `AFWE-Turn-Hash` trailers on Git commits in PR ranges.
//! - Retroactive turn attribution for legitimate manual human commits (`afwe attribute <commit>`).

use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitAttribution {
    pub commit_hash: String,
    pub has_turn_trailer: bool,
    pub turn_hash: Option<String>,
    pub matching_turn_record: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttributionScanReport {
    pub total_commits_scanned: usize,
    pub unattributed_commits: Vec<String>,
    pub all_commits_attributed: bool,
}

/// Verifies that all commits in `rev_range` (e.g. `origin/main..HEAD`) carry valid AFWE turn trailers.
pub fn verify_commit_range_attribution(
    repo_root: &Path,
    rev_range: &str,
    stored_turn_hashes: &[String],
) -> anyhow::Result<AttributionScanReport> {
    let out = std::process::Command::new("git")
        .args(["log", rev_range, "--format=%H%x00%B%x00"])
        .current_dir(repo_root)
        .output();

    let mut unattributed = Vec::new();
    let mut total = 0;

    if let Ok(output) = out {
        if output.status.success() {
            let s = String::from_utf8_lossy(&output.stdout);
            let chunks: Vec<&str> = s.split("\0\0").filter(|c| !c.trim().is_empty()).collect();
            for chunk in chunks {
                let parts: Vec<&str> = chunk.split('\0').collect();
                if parts.is_empty() {
                    continue;
                }
                total += 1;
                let commit_sha = parts[0].trim();
                let message = if parts.len() > 1 { parts[1] } else { "" };

                // Extract AFWE-Turn or AFWE-Turn-Hash trailer
                let mut found_turn = false;
                let mut turn_ref = None;
                for line in message.lines() {
                    let trimmed = line.trim();
                    if let Some(rest) = trimmed.strip_prefix("AFWE-Turn:") {
                        found_turn = true;
                        turn_ref = Some(rest.trim().to_string());
                        break;
                    }
                    if let Some(rest) = trimmed.strip_prefix("AFWE-Turn-Hash:") {
                        found_turn = true;
                        turn_ref = Some(rest.trim().to_string());
                        break;
                    }
                }

                // Verify the matching turn record is committed in .afwe/turns/
                let has_record = if let Some(tr) = &turn_ref {
                    let turns_dir = repo_root.join(".afwe").join("turns");
                    turns_dir.join(format!("{tr}.yaml")).exists()
                        || turns_dir.join(format!("turn-{tr}.yaml")).exists()
                        || turns_dir.join(format!("{tr}")).exists()
                        || stored_turn_hashes.iter().any(|h| h == tr || tr.contains(h))
                } else {
                    false
                };

                if (!found_turn || !has_record) && !stored_turn_hashes.iter().any(|h| commit_sha.starts_with(h)) {
                    unattributed.push(commit_sha.to_string());
                }
            }
        }
    }

    Ok(AttributionScanReport {
        total_commits_scanned: total,
        all_commits_attributed: unattributed.is_empty(),
        unattributed_commits: unattributed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attribution_empty_range() {
        let report = verify_commit_range_attribution(Path::new("."), "HEAD..HEAD", &[]).unwrap();
        assert_eq!(report.total_commits_scanned, 0);
        assert!(report.all_commits_attributed);
    }
}
