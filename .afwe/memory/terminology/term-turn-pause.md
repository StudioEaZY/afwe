---
term: Turn Pause
domain: Lifecycle
canonical_status: approved
short_definition: A mid-flight suspension state of an active turn that halts agent execution at zero token cost until human instruction or approval is received.
---

# Turn Pause

## Definition
**Turn Pause** is a first-class state within the AFWE turn lifecycle where an in-flight turn (`open`) transitions to `paused`. During a Turn Pause, the agent's MCP or runner tool suspends reactively without consuming LLM tokens, broadcasting a `mid_turn.pause` presence notification to the desktop and Studio HUD.

## Mechanics
- **Zero-Token Wait**: The engine or MCP runner holds the connection in a reactive loop with exponential backoff rather than polling prompts or invoking LLMs.
- **Interactive Options**: Provides structured option pills (e.g. choice alternatives), free-form reply steering, or Studio inspection.
- **Resumption**: Resumed via `afwe turn resume <turn> --reply "..."` or `/api/action?act=resume`, immediately waking the agent and injecting the human's choice or steering directive into the turn context.
