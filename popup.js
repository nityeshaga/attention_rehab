document.addEventListener('DOMContentLoaded', function() {
    const newSiteInput = document.getElementById('new-site');
    const addSiteButton = document.getElementById('add-site');
    const siteList = document.getElementById('site-list');
    const workModeToggle = document.getElementById('work-mode-toggle');
    const passBtns = document.querySelectorAll('#access-passes button');
  
    // Load blocked sites
    chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
      if (data.blockedSites) {
        data.blockedSites.forEach(site => addSiteToList(site));
      }
      workModeToggle.checked = data.workMode || false;
    });
  
    // Add new site
    addSiteButton.addEventListener('click', function() {
      const site = newSiteInput.value.trim();
      if (site) {
        chrome.storage.sync.get('blockedSites', function(data) {
          const blockedSites = data.blockedSites || [];
          blockedSites.push(site);
          chrome.storage.sync.set({blockedSites: blockedSites}, function() {
            addSiteToList(site);
            newSiteInput.value = '';
          });
        });
      }
    });
  
    // Toggle work mode
    workModeToggle.addEventListener('change', function() {
      chrome.storage.sync.set({workMode: this.checked});
    });
  
    // Request access pass
    passBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const duration = this.id.split('-')[1];
        chrome.runtime.sendMessage({action: 'requestPass', duration: duration});
      });
    });
  
    function addSiteToList(site) {
      const li = document.createElement('li');
      li.textContent = site;
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function() {
        chrome.storage.sync.get('blockedSites', function(data) {
          const blockedSites = data.blockedSites.filter(s => s !== site);
          chrome.storage.sync.set({blockedSites: blockedSites}, function() {
            li.remove();
          });
        });
      });
      li.appendChild(removeBtn);
      siteList.appendChild(li);
    }
  });