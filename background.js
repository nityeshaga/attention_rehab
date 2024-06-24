let currentPass = null;
let blockTimer = null;

function shouldBlockUrl(url, blockedSites) {
  const urlObj = new URL(url);
  return blockedSites.some(blockedSite => {
    // Remove protocol and www. if present
    const cleanBlockedSite = blockedSite.replace(/^(https?:\/\/)?(www\.)?/, '');
    const cleanUrlHostname = urlObj.hostname.replace(/^www\./, '');

    // Check if it's a domain-level block or a specific path block
    if (cleanBlockedSite.includes('/')) {
      // Specific path block
      return url.includes(cleanBlockedSite);
    } else {
      // Domain-level block
      return cleanUrlHostname === cleanBlockedSite || cleanUrlHostname.endsWith('.' + cleanBlockedSite);
    }
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
      if (data.workMode && data.blockedSites && shouldBlockUrl(tab.url, data.blockedSites)) {
        // Store the blocked URL before redirecting
        chrome.storage.local.set({blockedUrl: tab.url}, function() {
          console.log('Blocked URL saved:', tab.url);
        });
        chrome.tabs.update(tabId, {url: chrome.runtime.getURL(`blocked.html?from=${encodeURIComponent(tab.url)}`)});
      }
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Received message:', request);
    if (request.action === 'requestPass') {
        console.log('Pass requested for', request.duration, 'minutes');
        
        if (!request.duration) {
            console.error('Invalid duration received');
            sendResponse({granted: false, error: 'Invalid duration'});
            return true;
        }
        
        // Clear any existing timer
        if (blockTimer) {
            clearTimeout(blockTimer);
        }

        // Set up a new timer
        const durationMs = parseInt(request.duration) * 60 * 1000; // Convert minutes to milliseconds
        console.log('Setting timer for', durationMs, 'milliseconds');
        blockTimer = setTimeout(() => {
            console.log('Timer expired, re-blocking site');
            chrome.tabs.update(sender.tab.id, {url: chrome.runtime.getURL("blocked.html")});
        }, durationMs);

        // Grant the pass immediately
        console.log('Granting pass');
        sendResponse({granted: true});
        return true; // Indicates that the response is sent asynchronously
    } else if (request.action === 'redirect') {
        console.log('Redirect requested to:', request.url);
        chrome.tabs.update(sender.tab.id, {url: request.url}, tab => {
            if (chrome.runtime.lastError) {
                console.error('Error redirecting:', chrome.runtime.lastError);
                sendResponse({success: false, error: chrome.runtime.lastError.message});
            } else {
                console.log('Redirect successful');
                sendResponse({success: true});
            }
        });
        return true; // Indicates that the response is sent asynchronously
    }
});

// Add this to handle blocking when a new tab is opened or URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && shouldBlockSite(tab.url)) {
        chrome.tabs.update(tabId, {url: chrome.runtime.getURL("blocked.html")});
    }
});

function shouldBlockSite(url) {
    // Implement your logic to determine if a site should be blocked
    // For example:
    return url.includes('example.com') && !blockTimer;
}

console.log('Background service worker started');

