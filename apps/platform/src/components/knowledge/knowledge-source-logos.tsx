/**
 * Brand icons for knowledge source connectors.
 * Uses PNG images from /connectors/ for brand logos,
 * inline SVGs for generic icons (file upload, URL crawl).
 */

import Image from 'next/image';

interface IconProps {
  className?: string;
}

function ConnectorImage({
  src,
  alt,
  className = 'h-5 w-5',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  // Extract numeric size from className (e.g. "h-8 w-8" → 32)
  const sizeMatch = className.match(/h-(\d+)/);
  const size = sizeMatch ? parseInt(sizeMatch[1]) * 4 : 20;

  return <Image src={src} alt={alt} width={size} height={size} className={className} unoptimized />;
}

export function NotionLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/notion.png" alt="Notion" className={className} />;
}

export function GoogleDriveLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/gdrive.png" alt="Google Drive" className={className} />;
}

export function GmailLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/gmail.png" alt="Gmail" className={className} />;
}

export function LinearLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/linear.png" alt="Linear" className={className} />;
}

export function AsanaLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/asana.png" alt="Asana" className={className} />;
}

export function ConfluenceLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/confluence.png" alt="Confluence" className={className} />;
}

export function DropboxLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/dropbox.png" alt="Dropbox" className={className} />;
}

export function FigmaLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/figma.png" alt="Figma" className={className} />;
}

export function JiraLogo({ className = 'h-5 w-5' }: IconProps) {
  return <ConnectorImage src="/connectors/jira.png" alt="Jira" className={className} />;
}

export function FileUploadLogo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export function UrlCrawlLogo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

/** Lookup map for dynamic rendering by provider key */
export const KNOWLEDGE_SOURCE_LOGOS: Record<string, React.FC<IconProps>> = {
  notion: NotionLogo,
  'google-drive': GoogleDriveLogo,
  gmail: GmailLogo,
  linear: LinearLogo,
  asana: AsanaLogo,
  confluence: ConfluenceLogo,
  dropbox: DropboxLogo,
  figma: FigmaLogo,
  jira: JiraLogo,
  'file-upload': FileUploadLogo,
  'url-crawl': UrlCrawlLogo,
};
