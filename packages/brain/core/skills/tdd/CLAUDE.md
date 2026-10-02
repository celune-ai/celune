---
name: tdd
description: "Test-driven development protocol for writing tests before implementation.\n  TRIGGER when: building new features that need test coverage, or when the user requests TDD.\n  This is a protocol skill — it guides HOW to write tests, not WHEN to start."
user_invocable: false
---

# TDD Protocol

Test-driven development workflow for the platform. Write tests first, then implement to make them pass.

## When to Use

- Building new API routes
- Adding new utility functions or shared logic
- Implementing complex business logic
- When the user explicitly requests TDD
- When a bug fix needs a regression test

## Workflow

### Step 1: Understand the Requirement

Before writing any test:

1. Read the task description (especially `## What` and `## Approach`)
2. Identify the inputs, outputs, and edge cases
3. Determine the test type needed:
   - **Unit test**: Pure functions, utilities, transformers
   - **Integration test**: API routes, database queries, component rendering
   - **E2E test**: Full user flows (Playwright, if configured)

### Step 2: Write the Test First

Create the test file following project conventions:

- Colocate tests: `src/__tests__/` or `src/app/api/__tests__/`
- Use Vitest + Testing Library
- Name: `{feature}.test.ts` or `{feature}.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';

describe('Feature Name', () => {
  it('should handle the happy path', () => {
    // Arrange
    const input = {/* ... */};

    // Act
    const result = featureFunction(input);

    // Assert
    expect(result).toEqual(expectedOutput);
  });

  it('should handle edge case: empty input', () => {
    expect(featureFunction({})).toEqual(defaultOutput);
  });

  it('should handle error case: invalid input', () => {
    expect(() => featureFunction(invalidInput)).toThrow();
  });
});
```

### Step 3: Verify Tests Fail

Run the tests to confirm they fail for the right reason:

```bash
pnpm test -- --run <test-file>
```

The tests should fail because the implementation doesn't exist yet, not because the tests are wrong.

### Step 4: Implement

Write the minimum code to make the tests pass:

1. Start with the simplest implementation
2. Run tests after each change
3. Refactor only after all tests pass

```bash
# Run tests in watch mode during implementation
pnpm test:watch -- <test-file>
```

### Step 5: Refactor

Once all tests pass:

1. Clean up the implementation (remove duplication, improve naming)
2. Ensure tests still pass after refactoring
3. Add any missing edge case tests discovered during implementation

### Step 6: Final Verification

```bash
# Run all tests to check for regressions
pnpm test

# Type check
pnpm type-check
```

## Test Patterns

### API Route Tests

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock Supabase client
vi.mock('@repo/db', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ data: mockData, error: null })),
    })),
  })),
}));

describe('GET /api/resource', () => {
  it('returns 200 with data', async () => {
    const request = new Request('http://localhost/api/resource');
    const response = await GET(request);
    expect(response.status).toBe(200);
  });

  it('returns 500 on database error', async () => {
    // Mock error scenario
  });
});
```

### Component Tests

```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

describe('Component', () => {
  it('renders correctly', () => {
    render(<Component prop="value" />);
    expect(screen.getByText('Expected text')).toBeInTheDocument();
  });
});
```

## Conventions

- **Test what matters.** Don't test implementation details — test behavior.
- **One assertion per test** when possible. Makes failures clear.
- **Use descriptive test names.** `should return 404 when task not found` > `test error`
- **Mock at boundaries.** Mock the database, not internal functions.
- **Don't test the framework.** Trust that Next.js routing works.
- **Keep tests fast.** No network calls, no file I/O in unit tests.
