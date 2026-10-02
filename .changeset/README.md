# Changesets

Every pull request that changes a published package (`@celuneai/core`, `@celuneai/api`, `@celuneai/react`, `@celuneai/cli`) needs a changeset:

```bash
pnpm changeset
```

Pick the packages, the bump type, and write one line for the changelog. Commit the generated file with your change.

On `main`, the release workflow opens a "Version Packages" pull request that applies the pending changesets. Merging it publishes the new versions to npm.
