# Git Channel

A zero-relay remote communication protocol connecting inbound-restricted sandboxes, cloud agents, and containers to the human prompter. The engine writes structured queue facts to `refs/afwe/outbox/<project>` via lightweight git blobs (without growing commit history), while the presence watcher reads outbox updates via `git ls-remote` and transmits human steering replies through `refs/afwe/inbox/<project>`.
