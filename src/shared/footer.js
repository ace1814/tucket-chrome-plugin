// The one promotional line on extension pages (capture result, welcome). Tucket is detected over
// the bridge, so there's nothing to ask: connected users see their status, everyone else one
// quiet link. Never a modal, never a new tab. Classic script; defines globalThis.TGFooter.
(() => {
  if (globalThis.TGFooter) return;

  const SITE = 'https://trytucket.com/';
  const ctaUrl = (medium) => `${SITE}?utm_source=chrome-extension&utm_medium=${encodeURIComponent(medium)}&utm_campaign=grab`;
  const isMac = () => /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

  function h(tag, props = {}, ...children) {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  }

  async function mount(el, medium) {
    let status = { state: 'missing' };
    try { status = (await chrome.runtime.sendMessage({ type: 'tucket:status' })) || status; } catch { /* keep */ }
    el.replaceChildren();
    if (status.state === 'connected') {
      el.append(h('span', { className: 'tg-on' }), h('span', { className: 'tg-muted', textContent: `Connected to Tucket ${status.version || ''}`.trim() }));
    } else if (!isMac()) {
      el.append(h('span', { className: 'tg-muted', textContent: 'Tucket is Mac-only — everything here still copies and downloads.' }));
    } else {
      el.append(
        h('span', { className: 'tg-muted', textContent: 'Everything you grab can land in Tucket.' }),
        h('a', { className: 'tg-cta', href: ctaUrl(medium), target: '_blank', rel: 'noopener', textContent: 'Get Tucket for Mac →' }),
      );
    }
    return status;
  }

  globalThis.TGFooter = { mount, ctaUrl };
})();
