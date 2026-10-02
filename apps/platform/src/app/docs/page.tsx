'use client';

import { useEffect, useRef } from 'react';

/**
 * Public API documentation page.
 * Uses Scalar (CDN) to render an interactive OpenAPI reference.
 */
export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    // Inject the Scalar script
    const script = document.createElement('script');
    script.id = 'api-reference';
    script.setAttribute('data-url', '/openapi.json');
    script.setAttribute(
      'data-configuration',
      JSON.stringify({
        theme: 'kepler',
        hideModels: false,
        hideDownloadButton: false,
        authentication: {
          preferredSecurityScheme: 'BearerAuth',
        },
      }),
    );
    containerRef.current?.appendChild(script);

    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
    document.body.appendChild(loader);

    return () => {
      loader.remove();
    };
  }, []);

  return (
    <div className="min-h-screen" ref={containerRef}>
      <noscript>
        <p>JavaScript is required to view the API documentation.</p>
      </noscript>
    </div>
  );
}
