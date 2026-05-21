# multi-agent-LLM

A Claude Code skill for designing and implementing multi-agent LLM systems.

## Installation

```bash
claude skill install multi-agent-llm.skill
```

Or copy the skill directly:

```bash
mkdir -p ~/.claude/skills/multi-agent-llm
cp multi-agent-llm.skill/SKILL.md ~/.claude/skills/multi-agent-llm/SKILL.md
```

## Usage

Once installed, trigger the skill in a Claude Code session:

```
/multi-agent-llm
```

## What it covers

- **Orchestrator → Subagent** — dynamic task decomposition with tool calls
- **Parallel fan-out** — concurrent independent agents with `asyncio.gather`
- **Sequential pipeline** — chained stages where each output feeds the next
- **Prompt caching** — sharing large context across many agent calls efficiently
- **State management** — structured data passing between agents
- **Error handling** — retries, rate limit backoff, graceful degradation
- **Model selection** — when to use Opus vs Sonnet vs Haiku in a multi-agent system
