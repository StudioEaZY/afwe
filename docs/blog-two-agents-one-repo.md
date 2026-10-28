# Two Agents, One Repo: How Our Turn Architecture Almost Fell Apart

**Subtitle**: What happens when two autonomous agents commit to the same repository at the same time? A single global counter, a dirty working tree and baseline drift nearly broke AFWE's determinism. This is the engineering post-mortem, including what we fixed and what we still can't.

*By the AFWE Core Architecture Team · October 28, 2026 · 9 min read*

---

## The collision

A developer running AFWE opened two parallel chat sessions against the same repository to get more done per hour. Two agents, two different prompts.

Within minutes, both agents were working under the same turn number, `t0040`.

They weren't collaborating. They were overwriting each other. The first agent's `turn.begin` scanned `.afwe/turns/`, saw `t0039.yaml`, and computed `t0040`. A few milliseconds later, before the first agent had written anything, the second agent scanned the same directory and made the same calculation. Whichever wrote last replaced the other's prompt, session and baseline snapshot.

AFWE exists so that a project can't lose intent quietly. Two agents silently overwriting each other's record of intent is exactly that failure, in our own tool. We stopped feature work.

---

## The obvious answer, and why it doesn't fit turns

The textbook answer to "two agents, one repository" is git worktrees: give each agent its own folder and merge later. Worktrees are a good tool, and for many setups they are the right choice. They are the wrong fit for AFWE's turn system, for these reasons:

• **You can't watch the work**. Developers want to see code appear in their main editor window, not hunt through a hidden folder to find out what a sub-agent is doing.  
• **Build caches multiply**. Every worktree of a Rust or Node project can carry its own `target/` or `node_modules/`, which costs disk and a cold build per folder. Sharing a Rust `target/` directory doesn't rescue this, because cargo's fingerprints depend on paths and it serializes builds with its own lock.  
• **Editors can get confused**. Language servers bind to a root workspace, and a worktree outside it can lose live diagnostics depending on your setup.  
• **Many AFWE users have never set one up**. Some have never used worktrees, and some expect the agent to handle that for them. A turn system that only works once the user manages worktrees fails exactly the people it is built for.  

So the turn system works in the developer's normal directory, and we never claimed worktrees are wrong in general. That meant facing what a shared filesystem actually does.

---

## Three traps

### Trap 1: the dirty workspace
The commit gate runs static analysis. One ratchet, `SEVERED_CAPABILITY`, checks that a change hasn't removed the last caller of a function.

Say Agent A edits `src/service.ts` while Agent B is halfway through `src/controller.ts`. When A commits, the scanner reads the tree from disk and meets B's half-written syntax. A's gate fails on code A never touched.

### Trap 2: baseline drift
AFWE compared reference counts at `turn.begin` against `turn.commit`. Suppose B begins a turn, and five seconds later A commits a change that deletes a caller. When B later commits something unrelated, the comparison sees a severed capability and blames B for A's work.

### Trap 3: git's shared index
Git keeps one shared `.git/index`. Simultaneous `git add` calls fight over `index.lock`, and a plain `git commit` commits everything staged, including another agent's half-staged files.

---

## What survived

1. **A hash is the identity, and the number is a label**. An in-flight turn is known by a random 128-bit hash, so there's no counter to race on. The readable number (`t0040`) is assigned at commit time, inside the commit lock, in git commit order. It exists for humans. Records are keyed by the hash, which is also written into a commit trailer, so a rebase or squash can't orphan them.
2. **A virtual overlay for analysis**. Static checks read files the turn has claimed from disk, and read everything else from git HEAD, held in memory. Untracked files outside the turn's claims are ignored. A peer's half-written file never reaches the scanner.
3. **Deltas against one HEAD**. Instead of comparing against a snapshot from `turn.begin`, the ratchets compute the change between HEAD alone and HEAD plus this turn's files. If A already committed a caller deletion, it's part of HEAD, and B isn't blamed for it.
4. **A private git index**. Commits never touch the shared index. AFWE builds a temporary index, writes the verified file contents as blobs, writes a tree, creates the commit, and advances the branch with a compare-and-swap (`git update-ref` with the expected old value). If a human or an IDE commits at that moment, the update fails cleanly instead of overwriting them. Unrelated dirty files can't enter the commit.
5. **A short lock, and a second check inside it**. Heavy checks run outside the lock. Inside it, AFWE re-reads HEAD and confirms that none of the turn's claimed files changed since the turn started, because a compare-and-swap on the branch alone can't detect that. It then re-runs the cheap static delta against the new HEAD. Two changes that don't share a file but break each other, such as one deleting a function while the other adds a call to it, are caught here.
6. **A hard stop when two turns write the same file**. Disjoint files run in parallel. Claiming a file that another open turn already holds stops immediately with `CONTENTION`, instead of failing twenty minutes later at commit.

---

## What we still can't do

The honest list matters more than the fixes.

• **One folder holds one writer per file**. This is by design. The turn system targets a shared working directory, where one set of bytes on disk can have only one writer. AFWE detects two agents writing the same file and stops it, but it can't make that safe. Worktrees remain a fine answer to that problem. They just belong outside the turn system.  
• **Executed checks are weaker under concurrency**. Tests and compilers run in the working tree, so a peer's broken file can fail your build. AFWE blocks only when the failure points at files your turn claimed, turns peer-only failures into recorded warnings, and labels passes that may have included peer files. Attributing failures from compiler output is a heuristic, and it says so.  
• **Without a write hook, attribution is ambiguous**. AFWE knows who owns a file when edits pass through its harness. Agents that bypass it can leave unclaimed dirty files, and with more than one open turn AFWE refuses to guess.  
• **Tokens are an accident guard, not security**. They stop one session from steering another by mistake. They don't protect against a hostile process.  
• **Edits outside AFWE can't be prevented**. A human committing by hand is detected at the next blob check or compare-and-swap, and handled as a stale baseline.  

A pass from AFWE under concurrency means the change is consistent with recorded intent against the current HEAD, within those limits. It doesn't mean the code is correct.

---

## Why this fits the idea

Rust doesn't stop you from writing unsafe. It makes the risk visible and local. AFWE's turn architecture follows the same rule. You can run many agents in one repository, and you can force past a contention stop or an abandoned turn, but each of those leaves a record. What you can't do is lose someone's work, or blame the wrong turn for it, without anyone noticing.

Worktrees are still a good way to isolate long-running branches or experiments, and nothing here argues against them. For the turn system, staying in the developer's normal directory was the right call, and it forced a stricter model of identity, ownership and commit order than we would have built otherwise. We haven't published latency figures yet, because we want to measure them on large repositories on Linux and Windows first.
