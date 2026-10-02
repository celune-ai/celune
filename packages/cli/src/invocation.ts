/**
 * The command a user should type to run this CLI again: `npx @celuneai/cli` when it was
 * launched through npx or pnpm dlx, `celune` when it is installed. Bare `npx celune`
 * resolves to an unrelated npm package, so hints never suggest it.
 */
export function cliCommand(entry: string | undefined = process.argv[1]): string {
  return entry && /[\\/](_npx|dlx)[\\/]/.test(entry) ? 'npx @celuneai/cli' : 'celune';
}
