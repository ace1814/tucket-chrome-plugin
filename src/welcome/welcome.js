TGFooter.mount(document.querySelector('#footer'), 'welcome');

// Show the shortcut the user actually has (they may have changed or cleared it).
chrome.commands.getAll().then((commands) => {
  const action = commands.find((c) => c.name === '_execute_action');
  const kbd = document.querySelector('#shortcut');
  if (action?.shortcut) kbd.textContent = action.shortcut;
  else kbd.closest('li').innerHTML = '<strong>Open it</strong> on any page from the toolbar.';
});
