import { describe, it, expect } from 'vitest';
import { isBlockedUrl } from '../connectors/url-crawl';

describe('isBlockedUrl — SSRF blocklist', () => {
  // ---------------------------------------------------------------------------
  // IPv4 private ranges
  // ---------------------------------------------------------------------------

  describe('IPv4 private ranges', () => {
    it('blocks 10.x.x.x (Class A private)', () => {
      expect(isBlockedUrl('http://10.0.0.1')).toBe(true);
      expect(isBlockedUrl('http://10.255.255.255')).toBe(true);
      expect(isBlockedUrl('http://10.0.0.1:8080/path')).toBe(true);
    });

    it('blocks 172.16-31.x.x (Class B private)', () => {
      expect(isBlockedUrl('http://172.16.0.1')).toBe(true);
      expect(isBlockedUrl('http://172.20.10.5')).toBe(true);
      expect(isBlockedUrl('http://172.31.255.255')).toBe(true);
    });

    it('blocks 192.168.x.x (Class C private)', () => {
      expect(isBlockedUrl('http://192.168.0.1')).toBe(true);
      expect(isBlockedUrl('http://192.168.1.100')).toBe(true);
      expect(isBlockedUrl('http://192.168.255.255:3000')).toBe(true);
    });

    it('blocks 127.0.0.1 (loopback)', () => {
      expect(isBlockedUrl('http://127.0.0.1')).toBe(true);
      expect(isBlockedUrl('http://127.0.0.1:8080/admin')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // IPv6
  // ---------------------------------------------------------------------------

  describe('IPv6 addresses', () => {
    it('blocks ::1 loopback', () => {
      // Node URL parser normalizes [::1] to [::1]
      expect(isBlockedUrl('http://[::1]')).toBe(true);
      expect(isBlockedUrl('http://[::1]:8080')).toBe(true);
    });

    it('blocks fe80:: link-local', () => {
      expect(isBlockedUrl('http://[fe80::1]')).toBe(true);
      expect(isBlockedUrl('http://[fe80::abcd:1234]')).toBe(true);
    });

    it('blocks fd00:: unique local (private)', () => {
      expect(isBlockedUrl('http://[fd00::1]')).toBe(true);
      expect(isBlockedUrl('http://[fdab::1]:9090')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cloud metadata endpoints
  // ---------------------------------------------------------------------------

  describe('cloud metadata endpoints', () => {
    it('blocks AWS metadata (169.254.169.254)', () => {
      expect(isBlockedUrl('http://169.254.169.254')).toBe(true);
      expect(isBlockedUrl('http://169.254.169.254/latest/meta-data/')).toBe(true);
    });

    it('blocks GCP metadata (metadata.google.internal)', () => {
      expect(isBlockedUrl('http://metadata.google.internal')).toBe(true);
      expect(isBlockedUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(true);
    });

    it('blocks 169.254.x.x link-local range', () => {
      expect(isBlockedUrl('http://169.254.0.1')).toBe(true);
      expect(isBlockedUrl('http://169.254.100.100')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // localhost and 0.0.0.0
  // ---------------------------------------------------------------------------

  describe('localhost and 0.0.0.0', () => {
    it('blocks localhost', () => {
      expect(isBlockedUrl('http://localhost')).toBe(true);
      expect(isBlockedUrl('http://localhost:3000')).toBe(true);
      expect(isBlockedUrl('https://localhost/admin')).toBe(true);
    });

    it('blocks 0.0.0.0', () => {
      expect(isBlockedUrl('http://0.0.0.0')).toBe(true);
      expect(isBlockedUrl('http://0.0.0.0:8080')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Non-HTTP protocols
  // ---------------------------------------------------------------------------

  describe('non-http protocols', () => {
    it('blocks ftp://', () => {
      expect(isBlockedUrl('ftp://example.com/file.txt')).toBe(true);
    });

    it('blocks file://', () => {
      expect(isBlockedUrl('file:///etc/passwd')).toBe(true);
      expect(isBlockedUrl('file:///home/user/.ssh/id_rsa')).toBe(true);
    });

    it('blocks javascript:', () => {
      expect(isBlockedUrl('javascript:alert(1)')).toBe(true);
    });

    it('blocks data:', () => {
      expect(isBlockedUrl('data:text/html,<h1>hi</h1>')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Invalid URLs
  // ---------------------------------------------------------------------------

  describe('invalid URLs', () => {
    it('blocks empty string', () => {
      expect(isBlockedUrl('')).toBe(true);
    });

    it('blocks malformed URLs', () => {
      expect(isBlockedUrl('not-a-url')).toBe(true);
      expect(isBlockedUrl('://missing-protocol')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Valid external URLs — should NOT be blocked
  // ---------------------------------------------------------------------------

  describe('valid external URLs (should pass)', () => {
    it('allows standard HTTP URLs', () => {
      expect(isBlockedUrl('http://example.com')).toBe(false);
      expect(isBlockedUrl('https://docs.celune.ai')).toBe(false);
    });

    it('allows URLs with paths and query strings', () => {
      expect(isBlockedUrl('https://example.com/page?q=test')).toBe(false);
      expect(isBlockedUrl('https://docs.github.com/en/rest')).toBe(false);
    });

    it('allows URLs with ports on external hosts', () => {
      expect(isBlockedUrl('https://example.com:8443/api')).toBe(false);
    });

    it('does not block 172.x outside 16-31 range', () => {
      expect(isBlockedUrl('http://172.32.0.1')).toBe(false);
      expect(isBlockedUrl('http://172.15.0.1')).toBe(false);
    });
  });
});
