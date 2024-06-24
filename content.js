chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
    if (data.workMode && data.blockedSites) {
      const currentHost = window.location.hostname;
      if (data.blockedSites.some(site => currentHost.includes(site))) {
        document.body.innerHTML = '<h1>This site is blocked</h1><p>Use the extension to request an access pass.</p>';
      }
    }
  });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'passExpired') {
    // Re-block the site
    blockSite();
  } else if (request.action === 'reblock') {
    console.log('Reblocking site');
    window.location.href = chrome.runtime.getURL('blocked.html');
  }
});

function blockSite() {
  // Get the current URL
  const currentUrl = window.location.href;
  
  // Redirect to the blocked page
  window.location.href = chrome.runtime.getURL('blocked.html') + '?from=' + encodeURIComponent(currentUrl);
}