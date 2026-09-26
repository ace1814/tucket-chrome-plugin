// The one promotional line on extension pages (capture result, welcome). Tucket is detected over
// the bridge, so there's nothing to ask: connected users see their status, everyone else one
// quiet link. Never a modal, never a new tab. Classic script; defines globalThis.TGFooter.
(() => {
  if (globalThis.TGFooter) return;

  const SITE = 'https://trytucket.com/';
  // The Grab-user discount, shown in the Tucket pop-up on the result page. The site reads
  // ?offer= and applies it at checkout; set this to null to stop showing it.
  const OFFER = { percent: 20, code: 'grab20' };
  const ctaUrl = (medium, { offer = false } = {}) => `${SITE}?utm_source=chrome-extension&utm_medium=${encodeURIComponent(medium)}&utm_campaign=grab${offer && OFFER ? `&offer=${OFFER.code}` : ''}`;
  const isMac = () => /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

  function h(tag, props = {}, ...children) {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  }

  // status: pass one in when the page has already asked Tucket, so both agree.
  async function mount(el, medium, status = null) {
    if (!status) {
      status = { state: 'missing' };
      try { status = (await chrome.runtime.sendMessage({ type: 'tucket:status' })) || status; } catch { /* keep */ }
    }
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

  globalThis.TGFooter = { mount, ctaUrl, isMac, OFFER };
})();
