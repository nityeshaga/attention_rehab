chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
    if (data.workMode && data.blockedSites) {
      const currentHost = window.location.hostname;
      if (data.blockedSites.some(site => currentHost.includes(site))) {
        document.body.innerHTML = '<h1>This site is blocked</h1><p>Use the extension to request an access pass.</p>';
      }
    }
  });