---
name: multi-agent-llm
description: Design and implement multi-agent LLM systems using Claude. Use when the user wants to build orchestration pipelines, coordinate multiple AI agents, implement agent-to-agent communication, or structure complex tasks across parallel/sequential agent workflows.
---

# Multi-Agent LLM Skill

Build multi-agent systems that coordinate multiple Claude instances to solve complex tasks through orchestration, parallelism, and specialization.

## Agent Patterns

### Orchestrator → Subagent
One agent breaks down a task and delegates to specialized workers:
```python
import anthropic

client = anthropic.Anthropic()

def orchestrator(task: str) -> str:
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        system="You are an orchestrator. Break the task into subtasks and delegate each to a specialist.",
        messages=[{"role": "user", "content": task}],
        tools=[{
            "name": "delegate_task",
            "description": "Delegate a subtask to a specialist agent",
            "input_schema": {
                "type": "object",
                "properties": {
                    "specialist": {"type": "string", "enum": ["researcher", "writer", "critic"]},
                    "subtask": {"type": "string"}
                },
                "required": ["specialist", "subtask"]
            }
        }]
    )
    # Handle tool calls → spawn subagents
    return response

def subagent(role: str, task: str) -> str:
    system_prompts = {
        "researcher": "You research and gather information accurately.",
        "writer": "You synthesize information into clear prose.",
        "critic": "You identify flaws, gaps, and improvements.",
    }
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=system_prompts[role],
        messages=[{"role": "user", "content": task}]
    )
    return response.content[0].text
```

### Parallel Fan-Out
Run independent subagents concurrently and merge results:
```python
import asyncio
import anthropic

client = anthropic.AsyncAnthropic()

async def parallel_agents(tasks: list[dict]) -> list[str]:
    async def run_agent(task: dict) -> str:
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=task["system"],
            messages=[{"role": "user", "content": task["prompt"]}]
        )
        return response.content[0].text

    return await asyncio.gather(*[run_agent(t) for t in tasks])

# Example: analyze a document from multiple angles simultaneously
results = asyncio.run(parallel_agents([
    {"system": "You are a technical reviewer.", "prompt": doc},
    {"system": "You are a security auditor.", "prompt": doc},
    {"system": "You are a UX critic.", "prompt": doc},
]))
```

### Pipeline (Sequential Chain)
Output of one agent feeds into the next:
```python
def pipeline(input_data: str, stages: list[dict]) -> str:
    current = input_data
    for stage in stages:
        response = client.messages.create(
            model=stage.get("model", "claude-sonnet-4-6"),
            max_tokens=stage.get("max_tokens", 2048),
            system=stage["system"],
            messages=[{"role": "user", "content": current}]
        )
        current = response.content[0].text
    return current

result = pipeline(raw_data, [
    {"system": "Extract and structure the key facts as JSON.", "model": "claude-haiku-4-5-20251001"},
    {"system": "Verify and enrich the structured data."},
    {"system": "Generate a polished report from the verified data.", "model": "claude-opus-4-7"},
])
```

## Claude Agent SDK (claude-code-sdk)

For programmatic multi-agent workflows using the Claude Code execution environment:

```python
import asyncio
from claude_code_sdk import query, ClaudeCodeOptions

async def run_agent(prompt: str, system: str = None) -> str:
    options = ClaudeCodeOptions(
        system_prompt=system,
        max_turns=10,
        allowed_tools=["Read", "Bash", "Edit"],
    )
    result = ""
    async for message in query(prompt=prompt, options=options):
        if hasattr(message, "content"):
            for block in message.content:
                if hasattr(block, "text"):
                    result += block.text
    return result

async def multi_agent_workflow(task: str) -> str:
    # Stage 1: plan
    plan = await run_agent(
        f"Create a step-by-step implementation plan for: {task}",
        system="You are a software architect. Output only the numbered plan."
    )
    # Stage 2: implement
    code = await run_agent(
        f"Implement this plan:\n{plan}",
        system="You are a senior engineer. Write clean, production-ready code."
    )
    # Stage 3: review
    review = await run_agent(
        f"Review this implementation:\n{code}",
        system="You are a code reviewer. Be direct about issues and improvements."
    )
    return review
```

## Prompt Caching for Multi-Agent Systems

Use cache breakpoints to avoid re-sending large shared context:
```python
shared_context = open("large_codebase_summary.txt").read()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=2048,
    system=[
        {
            "type": "text",
            "text": shared_context,
            "cache_control": {"type": "ephemeral"}  # cache the shared context
        },
        {
            "type": "text",
            "text": "You are a specialized code reviewer."
        }
    ],
    messages=[{"role": "user", "content": agent_specific_task}]
)
```

## State Management Between Agents

Pass structured state through the pipeline:
```python
from dataclasses import dataclass, field
from typing import Any

@dataclass
class AgentState:
    task: str
    outputs: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

def run_stage(state: AgentState, stage_name: str, system: str, prompt_fn) -> AgentState:
    try:
        prompt = prompt_fn(state)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": prompt}]
        )
        state.outputs[stage_name] = response.content[0].text
    except Exception as e:
        state.errors.append(f"{stage_name}: {e}")
    return state
```

## Workflow

Make a todo list for all the tasks in this workflow and work on them one after another.

### 1. Clarify the Task Structure

Ask or determine:
- Is the task naturally parallel (independent subtasks) or sequential (dependent stages)?
- Does it need specialization (different system prompts per agent)?
- What's the coordination mechanism (tool calls, structured output, plain text)?

### 2. Choose the Right Pattern

| Pattern | Use When |
|---|---|
| Orchestrator → Workers | Task requires dynamic decomposition |
| Parallel Fan-Out | Independent subtasks that can run concurrently |
| Sequential Pipeline | Each stage transforms/enriches the previous output |
| Hierarchical | Complex tasks needing nested orchestration |

### 3. Design Agent Interfaces

Define clear input/output contracts:
- Use structured output (`json`, Pydantic models) for agent-to-agent data
- Prefer tool use for orchestrators to make delegation explicit
- Keep system prompts focused — one role per agent

### 4. Implement with Prompt Caching

- Cache large shared context (codebases, docs, datasets) with `cache_control`
- Use `claude-opus-4-7` for orchestration/reasoning, `claude-sonnet-4-6` or `claude-haiku-4-5-20251001` for high-volume workers

### 5. Add Error Handling and Retries

```python
import time

def resilient_agent_call(prompt: str, system: str, retries: int = 3) -> str:
    for attempt in range(retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": prompt}]
            )
            return response.content[0].text
        except anthropic.RateLimitError:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
```

### 6. Test Each Agent in Isolation

Validate individual agents before wiring them together:
```bash
python -c "from agents import researcher; print(researcher('What is RAG?'))"
```

### 7. Monitor Token Usage

```python
response = client.messages.create(...)
print(f"Input: {response.usage.input_tokens}, Output: {response.usage.output_tokens}")
if hasattr(response.usage, 'cache_read_input_tokens'):
    print(f"Cache hits: {response.usage.cache_read_input_tokens}")
```

### 8. Commit and push

Commit the implementation and push to the remote branch.

## Wrap Up

Provide a summary with:
- Agent architecture diagram (as ASCII or mermaid)
- Pattern used and why it fits the task
- Token efficiency notes (caching, model selection)
- Next steps if the user wants to scale or extend the system
