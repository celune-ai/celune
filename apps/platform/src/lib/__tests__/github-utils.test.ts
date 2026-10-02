import { describe, it, expect } from 'vitest';
import { parseGitHubUrl } from '../github-utils';

describe('parseGitHubUrl', () => {
  it('parses a valid HTTPS GitHub URL', () => {
    const result = parseGitHubUrl('https://github.com/acme/my-repo');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'my-repo',
      fullName: 'acme/my-repo',
    });
  });

  it('handles URL with .git suffix', () => {
    const result = parseGitHubUrl('https://github.com/acme/my-repo.git');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'my-repo',
      fullName: 'acme/my-repo',
    });
  });

  it('handles URL with trailing slash', () => {
    const result = parseGitHubUrl('https://github.com/acme/my-repo/');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'my-repo',
      fullName: 'acme/my-repo',
    });
  });

  it('handles URL with extra path segments', () => {
    const result = parseGitHubUrl('https://github.com/acme/my-repo/tree/main');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'my-repo',
      fullName: 'acme/my-repo',
    });
  });

  it('returns null for invalid URL', () => {
    expect(parseGitHubUrl('not-a-url')).toBeNull();
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseGitHubUrl('https://gitlab.com/acme/repo')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseGitHubUrl('')).toBeNull();
  });

  it('returns null for GitHub URL with no repo path', () => {
    expect(parseGitHubUrl('https://github.com/')).toBeNull();
    expect(parseGitHubUrl('https://github.com/acme')).toBeNull();
  });

  it('handles www.github.com', () => {
    const result = parseGitHubUrl('https://www.github.com/acme/repo');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'repo',
      fullName: 'acme/repo',
    });
  });

  it('handles whitespace around URL', () => {
    const result = parseGitHubUrl('  https://github.com/acme/repo  ');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'repo',
      fullName: 'acme/repo',
    });
  });
});
