# An Interesting Turns Architecture... It Almost Fell Apart 😅

**Subtitle**: What happens when two autonomous agents try to commit to the same repo at the same time? A single global counter, a dirty working tree, and baseline drift almost broke AFWE’s determinism. Here is the unvarnished engineering post-mortem of how we fixed it.

*By the AFWE Core Architecture Team · October 28, 2026 · 9 min read*

---

Last night, a developer running AFWE hit an uncomfortable reality. 

To maximize token throughput, they opened two parallel chat sessions against the same repository. Two different agents, two completely different prompts. 

Within minutes, both agents referenced the exact same turn number: `t0040`. 

They weren't collaborating. They were trampling each other. 

One agent’s `turn.begin` had scanned the `.afwe/turns/` directory, seen `t0039.yaml`, and computed `t0040`. Milliseconds later, before the first agent wrote its baseline snapshot to disk, the second agent ran `turn.begin`, saw the same `t0039.yaml`, and also claimed `t0040`. Whichever agent wrote last overwrote the other’s prompt, session, and baseline snapshot. 

When the first agent went to commit, the turn data was gone. 

If your engine claims to be "Rust for project intent"—promising that codebases cannot degrade quietly—having two concurrent agents quietly overwrite each other’s intent ledger is an existential failure. 

We stopped feature work and went back to the drawing board. Here is how our turn architecture almost fell apart, the clean abstractions that failed under real pressure, and the pragmatic architecture that actually holds up.

---

## 1. The Easy Answer That Destroys Developer Experience

When people hear "two agents modifying one git repository," the textbook answer is immediate: **Git Worktrees**.

Spin up `.afwe/worktrees/agent-alpha` and `.afwe/worktrees/agent-beta`. Put each agent in its own directory on its own branch. Merge them later.

On paper, worktrees solve everything:
- Clean filesystem isolation.
- Separate Git indices.
- No cross-talk while typing.

In reality, for developer-in-the-loop pair programming, **worktrees are a disaster**.

1. **You can't watch the code stream**: Developers want to watch agents type code in their open IDE window in real time. They don't want to navigate to hidden folders in `.afwe/worktrees/` to see what a sub-agent is doing.
2. **Build cache explosion**: A single Rust project with `target/` or a Node project with `node_modules/` duplicated across five worktrees consumes 15–30 GB of disk space in minutes. Cargo serializes builds with its own lock anyway, and shared target directories suffer from path-dependent fingerprint invalidation.
3. **Language server confusion**: Your editor's LSP (rust-analyzer, tsserver) binds to the root workspace. Files in worktrees don't get live diagnostics or editor autocomplete.

We made an absolute design commitment: **Zero user-visible Git worktrees**. Agents must work directly in the developer's normal working directory. 

That single constraint meant we had to face the real physics of a shared filesystem.

---

## 2. The Three Traps That Almost Broke Determinism

Once you commit to a single working directory, naive solutions fall apart in subtle, dangerous ways.

### Trap 1: The "Dirty Workspace" Static Analysis Trap
In AFWE, our commit gate doesn't just check `git diff`; it runs static analysis ratchets. Our `SEVERED_CAPABILITY` ratchet inspects cross-module callers to ensure an agent hasn't accidentally dropped the last inbound reference to a function.

Here is the trap:
- Agent A is editing `src/service.ts`.
- Agent B (in a parallel conversation) is halfway through refactoring `src/controller.ts`. Agent B just deleted a line and hasn't finished typing the replacement.
- Agent A finishes and calls `afwe turn commit`.

AFWE’s AST scanner reads the project tree from disk. It encounters Agent B's half-finished syntax error in `controller.ts`, or sees that a caller was deleted. 

**Result**: Agent A's commit gate fails with `SEVERED_CAPABILITY` or a compile error on code Agent A never touched and knew nothing about. 

Scoping `git add` to Agent A's files is trivial. Isolating *static analysis* while two agents share a disk is not.

### Trap 2: Baseline Drift Blaming the Wrong Turn
AFWE originally compared reference counts at `turn.begin` against reference counts at `turn.commit`.

Suppose Agent B begins a turn. Five seconds later, Agent A commits a change that intentionally retires a legacy caller. When Agent B later commits an unrelated change, AFWE checks B's reference count against the baseline from when B *began*. 

Because the baseline had 1 caller and current HEAD has 0, Agent B is accused of severing the capability. Agent B gets blocked for Agent A's commit.

### Trap 3: Git Isn’t Concurrency-Safe
Git has a single shared `.git/index`. 
- If Agent A and Agent B run `git add` simultaneously, one crashes with `fatal: Unable to create '.git/index.lock': File exists`.
- If Agent A stages files with `git add src/a.ts`, and Agent B stages `src/b.ts`, a subsequent `git commit` sweeps up *both* agents' changes into a single commit.
- Worse: if both agents edit `src/shared.ts`, staging the file stages both agents' hunks, silently baking half-finished code into the commit history.

---

## 3. What Actually Survived the Fire: The v4 Architecture

To solve this without worktrees, we had to throw away several early assumptions. Here is the architecture that survived peer review.

### 1. Hash is Identity, Number is Just a Label
Global monotonic counters (`t0040`) are an invitation to race conditions. 

In our v4 architecture:
- In-flight turns are identified solely by a 128-bit random hash: `turn-7a8f3c...`. 
- Reservation is just writing a new file named by that hash. There are no directory scans, no TOCTOU loops, and no empty stub files.
- Two clones or branches will never collide on hashes.
- The human-friendly sequential label (`t0040`, or `t0040.1` for sub-agents) is minted **strictly at commit time**, inside the short commit lock.

### 2. Virtual Index Overlay (Dirty Workspace Immunity)
To stop Agent B's in-progress typing from poisoning Agent A's static analysis, we built the **Virtual Index Overlay**:
- Agent A declares or accumulates claimed files as it works.
- During static analysis, AFWE reads claimed files directly from disk.
- For every file *outside* Agent A's claim, AFWE reads the bytes from **Git HEAD in memory**, completely ignoring dirty or uncommitted changes on disk.
- Untracked files created by peer agents are filtered out.

Instead of spawning hundreds of `git cat-file` processes (which on Windows burns 20ms per fork and blows the sub-second budget), we stream the entire HEAD tree in a single pass via `git cat-file --batch` into an in-memory map in under 40ms.

### 3. Single-HEAD Delta Ratchets
To kill baseline drift, we changed how capability ratchets are calculated. Instead of comparing across time (`begin` vs `commit`), we compare two states built from the **exact same HEAD commit**:

$$\Delta = \text{Refs}(\text{HEAD} + \text{Agent B's files}) - \text{Refs}(\text{HEAD})$$

If Agent A deleted a caller before Agent B committed, that deletion is already inside `Refs(HEAD)`. Agent B is judged strictly on the delta its own files introduce.

### 4. Private Git Index Plumbing
We stopped calling `git add` and `git commit` directly. 

At commit time, AFWE uses Git's low-level plumbing:
1. It hashes the verified bytes directly into the Git object store: `blob=$(git hash-object -w --path <file>)`.
2. It constructs a **private temporary index** (`GIT_INDEX_FILE=<temp> git update-index --add --cacheinfo ...`).
3. It creates the commit with `git write-tree` and `git commit-tree`.
4. It advances the branch using an atomic compare-and-swap: `git update-ref refs/heads/main <new_sha> <HEAD>`.

Because the commit is built from a private index, peer agents can have dirty or staged files in the main index without a single byte leaking into the commit.

### 5. Optimistic Two-Phase Commit with OS Advisory Locks
To prevent Git index races and catch cross-turn semantic breaks (e.g. Agent A deleted `foo()`, Agent B called `foo()`), we use a two-phase commit:
- **Phase A (Outside Lock)**: Static analysis, overlay diffing, and test checks run in parallel without blocking anyone.
- **Phase B (Inside OS Lock)**: AFWE acquires a lightweight OS advisory lock (`flock` on Unix, `LockFileEx` on Windows) on `.afwe/state/commit.lock`. 
  - If a process crashes, the OS kernel automatically releases the lock immediately—no zombie lock files.
  - AFWE checks if any claimed file was modified at HEAD (lost update check).
  - If HEAD moved, it re-runs a cheap in-memory delta check.
  - It writes the private-index commit and releases the lock.
  
The lock hold time is targeted at **under 100ms**.

### 6. The Honest Invariant: Hard-Stop Same-File Contention
Can two agents safely edit `src/payments.ts` simultaneously in the same working directory?

**No.** Anyone who tells you two LLMs can edit the same physical file on disk concurrently without worktrees is lying to you. Their bytes will literally interleave and clobber each other.

AFWE makes this a hard stop:
- Disjoint files run in parallel with zero friction.
- If Turn B attempts to claim a file already held by an open turn, AFWE returns `CONTENTION` and stops:
  ```
  CONTENTION: 'src/payments/charge.ts' is being edited by open turn 7a8f3c.
  Two agents writing one file in a shared folder will overwrite each other.
  ```

---

## 4. The Engineering Lesson

When building developer tools for autonomous agents, it is easy to retreat into academic purity: "Just put everything in a container or a Git worktree." 

Academic purity solves the algorithms but loses the human developer. If the developer can't see the code streaming in their editor, the tool gets uninstalled.

Making concurrency work in a single shared directory required respecting the bedrock physics of Git and static analysis:
- Hashes instead of counters.
- Memory overlays instead of disk reads.
- Atomic compare-and-swaps instead of blanket staging.
- Hard stops instead of silent clobbering.

AFWE’s turn architecture almost fell apart last night. By forcing ourselves to fix it without cheating with worktrees, the engine became ten times more resilient than when we started.
