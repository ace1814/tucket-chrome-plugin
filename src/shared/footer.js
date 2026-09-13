// The one promotional surface: a single quiet line. Never a modal, never a new tab.
// v1 can't detect Tucket, so it asks once; the answer only changes wording and hides the CTA.
// Classic script; defines globalThis.TGFooter.
(() => {
  if (globalThis.TGFooter) return;

  const SITE = 'https://trytucket.com/';
  const mounted = new Map(); // element → utm_medium

  const ctaUrl = (medium) => `${SITE}?utm_source=chrome-extension&utm_medium=${encodeURIComponent(medium)}&utm_campaign=grab`;
  const isMac = () => /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');

  function h(tag, props = {}, ...children) {
    const el = Object.assign(document.createElement(tag), props);
    el.append(...children);
    return el;
  }

  async function setHasTucket(value) {
    if (value == null) await chrome.storage.local.remove('hasTucket');
    else await chrome.storage.local.set({ hasTucket: value });
  }

  async function render(el, medium) {
    const { hasTucket } = await chrome.storage.local.get('hasTucket');
    const cta = h('a', { className: 'tg-cta', href: ctaUrl(medium), target: '_blank', rel: 'noopener', textContent: 'Get Tucket for Mac →' });
    el.replaceChildren();

    if (!isMac()) {
      el.append(h('span', { className: 'tg-muted', textContent: 'Tucket is Mac-only — captures still copy and download.' }));
    } else if (hasTucket === true) {
      el.append(
        h('span', { className: 'tg-muted', textContent: 'Tucket saves what you send, via the clipboard.' }),
        h('button', { className: 'tg-link', type: 'button', textContent: 'Change', onclick: () => setHasTucket(null) }),
      );
    } else if (hasTucket === false) {
      el.append(cta);
    } else {
      el.append(
        h('span', { className: 'tg-ask' },
          h('span', { className: 'tg-muted', textContent: 'Already have Tucket?' }),
          h('button', { className: 'tg-link', type: 'button', textContent: 'Yes', onclick: () => setHasTucket(true) }),
          h('button', { className: 'tg-link', type: 'button', textContent: 'No', onclick: () => setHasTucket(false) }),
        ),
        cta,
      );
    }
  }

  function mount(el, medium) {
    mounted.set(el, medium);
    return render(el, medium);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'hasTucket' in changes) for (const [el, medium] of mounted) render(el, medium);
  });

  globalThis.TGFooter = { mount, ctaUrl };
})();
