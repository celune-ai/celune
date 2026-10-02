/**
 * Celune Support Chat — Embeddable Widget Loader
 *
 * Usage:
 *   <script src="https://<your-app-domain>/embed/chat.js"
 *     data-context="web"
 *     data-position="bottom-right">
 *   </script>
 */
(function () {
  'use strict';

  var script = document.currentScript;
  if (!script) return;

  var context = script.getAttribute('data-context') || 'web';
  var position = script.getAttribute('data-position') || 'bottom-right';
  // Defaults to the host that served this script
  var appUrl = script.getAttribute('data-app-url') || new URL(script.src).origin;

  // Create toggle button
  var btn = document.createElement('button');
  btn.setAttribute('aria-label', 'Open support chat');
  btn.style.cssText =
    'position:fixed;bottom:16px;' +
    (position === 'bottom-left' ? 'left' : 'right') +
    ':16px;z-index:9999;width:56px;height:56px;border-radius:50%;border:none;' +
    'background:#5BC586;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:transform 0.15s;';
  btn.innerHTML =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>';
  btn.onmouseenter = function () {
    btn.style.transform = 'scale(1.05)';
  };
  btn.onmouseleave = function () {
    btn.style.transform = 'scale(1)';
  };

  var iframe = null;
  var open = false;

  btn.onclick = function () {
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.src =
        appUrl +
        '/chat/embed?context=' +
        encodeURIComponent(context) +
        '&position=' +
        encodeURIComponent(position);
      iframe.style.cssText =
        'position:fixed;bottom:80px;' +
        (position === 'bottom-left' ? 'left' : 'right') +
        ':16px;z-index:9998;width:380px;height:500px;border:none;border-radius:16px;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.4);display:none;background:transparent;';
      iframe.setAttribute('allow', 'clipboard-write');
      document.body.appendChild(iframe);
    }

    open = !open;
    iframe.style.display = open ? 'block' : 'none';
    btn.innerHTML = open
      ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
      : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>';
  };

  document.body.appendChild(btn);

  // Listen for navigation messages from the iframe (origin-validated)
  window.addEventListener('message', function (e) {
    // Only accept messages from the known app origin
    if (e.origin !== appUrl) return;
    if (!e.data || e.data.type !== 'celune:navigate') return;
    var path = e.data.path;
    // Only allow relative paths starting with / (prevent open redirect / javascript: XSS)
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.indexOf('//') === 0) return;
    window.location.href = path;
  });
})();
