let currentPass = null;
let blockTimer = null;
let isPassActive = false;
let activePassTimers = {};

function shouldBlockUrl(url, blockedSites) {
  const urlObj = new URL(url);
  return blockedSites.some(blockedSite => {
    // Remove protocol and www. if present
    const cleanBlockedSite = blockedSite.replace(/^(https?:\/\/)?(www\.)?/, '');
    const cleanUrlHostname = urlObj.hostname.replace(/^www\./, '');

    // Check if it's a domain-level block
    if (!cleanBlockedSite.includes('/')) {
      return cleanUrlHostname === cleanBlockedSite || cleanUrlHostname.endsWith('.' + cleanBlockedSite);
    } else {
      // It's a specific path block, so block the entire domain
      const blockedDomain = cleanBlockedSite.split('/')[0];
      return cleanUrlHostname === blockedDomain || cleanUrlHostname.endsWith('.' + blockedDomain);
    }
  });
}

// New code for pass tracking
function getToday() {
  return new Date().toDateString();
}

function initializeDailyPassCounts() {
  chrome.storage.local.get(['passCounts', 'lastResetDate'], (result) => {
    const today = getToday();
    if (result.lastResetDate !== today) {
      chrome.storage.local.set({
        passCounts: {
          '1': 0,
          '5': 0,
          '15': 0
        },
        lastResetDate: today
      });
    }
  });
}

function incrementPassCount(duration) {
  chrome.storage.local.get(['passCounts', 'lastResetDate'], (result) => {
    const today = getToday();
    let { passCounts, lastResetDate } = result;

    if (lastResetDate !== today) {
      passCounts = { '1': 0, '5': 0, '15': 0 };
      lastResetDate = today;
    }

    passCounts[duration] = (passCounts[duration] || 0) + 1;

    chrome.storage.local.set({ passCounts, lastResetDate });
  });
}

// Initialize pass counts on extension start
chrome.runtime.onInstalled.addListener(() => {
  initializeDailyPassCounts();
});

// Reset pass counts daily
chrome.alarms.create('resetPassCounts', { periodInMinutes: 1440 }); // 24 hours
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'resetPassCounts') {
    initializeDailyPassCounts();
  }
});

// Initialize alarms when the extension starts
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.clearAll();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'requestPass') {
    console.log('Pass requested for', request.duration, 'minutes');
    
    if (!request.duration) {
      console.error('Invalid duration received');
      sendResponse({granted: false, error: 'Invalid duration'});
      return true;
    }
    
    const tabId = sender.tab.id;
    const alarmName = `expirePass_${tabId}`;
    
    // Clear any existing alarm for this tab
    chrome.alarms.clear(alarmName, (wasCleared) => {
      console.log(`Previous alarm ${wasCleared ? 'was' : 'was not'} cleared`);
      
      // Create a new alarm
      chrome.alarms.create(alarmName, {
        delayInMinutes: parseInt(request.duration)
      });
      
      console.log(`Alarm set for ${request.duration} minutes from now`);

      // Increment pass count
      incrementPassCount(request.duration);

      // Grant the pass immediately and redirect
      chrome.storage.local.get(['blockedUrl'], function(result) {
        if (result.blockedUrl) {
          console.log('Redirecting to:', result.blockedUrl);
          chrome.tabs.update(tabId, {url: result.blockedUrl}, function(tab) {
            if (chrome.runtime.lastError) {
              console.error('Error redirecting:', chrome.runtime.lastError);
              sendResponse({granted: false, error: chrome.runtime.lastError.message});
            } else {
              console.log('Redirect initiated');
              // Inject the content script after the redirect
              chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === tab.id && info.status === 'complete') {
                  chrome.tabs.onUpdated.removeListener(listener);
                  chrome.scripting.executeScript({
                    target: {tabId: tab.id},
                    files: ['timer.js']
                  }, () => {
                    // Send message to content script with pass duration
                    chrome.tabs.sendMessage(tab.id, {action: 'startTimer', duration: request.duration});
                  });
                }
              });
              sendResponse({granted: true});
            }
          });
        } else {
          console.error('No blocked URL found');
          sendResponse({granted: false, error: 'No blocked URL found'});
        }
      });
    });
    
    return true; // for asynchronous response
  }
  
  else if (request.action === 'redirect') {
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
    return true;
  }
});

// Listen for alarm expiration
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('Alarm fired:', alarm);
  if (alarm.name.startsWith('expirePass_')) {
    const tabId = parseInt(alarm.name.split('_')[1]);
    console.log('Pass expired for tab:', tabId);
    chrome.tabs.reload(tabId);
  }
});

// Existing tab update listener
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    chrome.alarms.get(`expirePass_${tabId}`, (alarm) => {
      if (!alarm) {
        chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
          if (data.workMode && data.blockedSites && shouldBlockUrl(tab.url, data.blockedSites)) {
            chrome.storage.local.set({blockedUrl: tab.url}, function() {
              console.log('Blocked URL saved:', tab.url);
            });
            chrome.tabs.update(tabId, {url: chrome.runtime.getURL(`blocked.html?from=${encodeURIComponent(tab.url)}`)});
          }
        });
      }
    });
  }
});