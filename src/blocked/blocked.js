// This popup is set per tab only when the panel couldn't be injected. Clear it straight away, so
// the next toolbar click (after the user navigates to a normal page) opens the panel again.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab) chrome.action.setPopup({ tabId: tab.id, popup: '' });

const $ = (sel) => document.querySelector(sel);

function fail(message) {
  $('#error').textContent = message;
  $('#error').hidden = false;
}

// Chrome lets an extension the user just clicked capture even a locked page (activeTab), so the
// ordinary visible-area capture works; the result tab opens as usual and this popup closes.
$('#shot').onclick = async () => {
  $('#shot').disabled = true;
  const res = await chrome.runtime.sendMessage({ type: 'shot:start', mode: 'visible', tabId: tab?.id }).catch(() => null);
  if (!res?.ok) {
    $('#shot').disabled = false;
    fail(res?.error || 'Couldn’t take the screenshot. Try again.');
  }
};

// The EyeDropper samples the whole screen, so it doesn't need the page at all.
$('#pick').onclick = async () => {
  if (!('EyeDropper' in window)) { fail('This browser has no colour picker.'); return; }
  let hex;
  try {
    ({ sRGBHex: hex } = await new EyeDropper().open());
  } catch {
    return; // Esc
  }
  hex = hex.toUpperCase();
  $('#swatch').style.background = hex;
  $('#hex').textContent = hex;
  $('#picked').hidden = false;
  try {
    const { via } = await TGSend.send('text', hex, { pageUrl: tab?.url || '', pageTitle: tab?.title || '' });
    $('#done').textContent = via === 'tucket' ? 'Sent to Tucket' : 'Copied';
  } catch {
    $('#done').textContent = 'Couldn’t copy';
  }
};
