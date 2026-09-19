// This popup is set per tab only when the panel couldn't be injected. Clear it straight away, so
// the next toolbar click (after the user navigates to a normal page) opens the panel again.
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab) chrome.action.setPopup({ tabId: tab.id, popup: '' });
