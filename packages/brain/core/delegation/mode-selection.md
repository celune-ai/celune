# Mode Selection

How the lead agent decides which orchestration mode to use for a given project or set of tasks.

## Modes

| Signal           | Solo (Lead) | Sub-agents | Agent Team  |
| ---------------- | ----------- | ---------- | ----------- |
| Impl tasks       | 1-5         | 6-8        | 9+          |
| Sprints          | Any         | <=3        | 3+          |
| Domain spread    | Any         | <=3 agents | 3+ agents   |
| Dependency depth | Any         | <=3        | Deep chains |

## Decision Tree

```
Is there an explicit override? -> Use that mode
Else:
  impl_tasks <= 5 AND all effort <= L -> Solo
  impl_tasks <= 8 AND sprints <= 3 -> Sub-agents
  Otherwise -> Agent Team
```

## Override Keywords

| User says                                       | Mode             |
| ----------------------------------------------- | ---------------- |
| `agent team`, `spin up a team`, `full team`     | Force Agent Team |
| `yourself`, `solo`, `just do it`, `handle this` | Force Solo       |
| `with sub-agents`, `delegate this`              | Force Sub-agents |

## When the Lead Agent Codes Directly

- Everything with <=5 tasks
- Anything requiring the user's intent, architectural judgment, or iterative refinement
- Security-sensitive implementations
- Tasks that build on context the lead already has

## When to Delegate

- Multiple independent files or features that can be built in parallel
- Mechanical transformations (bulk renames, format migrations) where context doesn't matter
- Prototype exploration — try 2-3 approaches simultaneously and compare
- Research and investigation (Researcher agent)
- Code review (Code Reviewer reviews the lead agent's code)
- Large project closing tasks (QA, retrospectives)

## RFC Requirement

- **S/M effort tasks:** Skip RFC. Just implement directly.
- **L/XL effort tasks:** Write a brief RFC as a task comment before implementing. Cover: Problem, Proposed Solution, Technical Approach, Testing Strategy.
