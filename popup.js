document.addEventListener('DOMContentLoaded', function() {
  const newSiteInput = document.getElementById('new-site');
  const addSiteButton = document.getElementById('add-site');
  const siteList = document.getElementById('site-list');
  const workModeToggle = document.getElementById('work-mode-toggle');
  const emptyStateMessage = document.getElementById('empty-sites-message');
  const passBtns = document.querySelectorAll('#access-passes button');

  // Load blocked sites
  chrome.storage.sync.get(['blockedSites', 'workMode'], function(data) {
    if (data.blockedSites && data.blockedSites.length > 0) {
      data.blockedSites.forEach(site => addSiteToList(site));
      emptyStateMessage.style.display = 'none';
    } else {
      emptyStateMessage.style.display = 'block';
    }
    workModeToggle.checked = data.workMode || false;
  });

  // Add new site
  addSiteButton.addEventListener('click', addNewSite);

  // Allow adding sites with Enter key
  newSiteInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      addNewSite();
    }
  });

  // Toggle work mode
  workModeToggle.addEventListener('change', function() {
    chrome.storage.sync.set({workMode: this.checked});

    // Visual feedback for toggle
    const label = document.querySelector('.mode-label');
    if (this.checked) {
      label.textContent = 'Work Mode: On';
      label.style.color = 'var(--primary-color)';
      label.style.fontWeight = '600';
    } else {
      label.textContent = 'Work Mode';
      label.style.color = 'var(--text-secondary)';
      label.style.fontWeight = '500';
    }
  });

  // Request access pass
  passBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const duration = this.id.split('-')[1];
      chrome.runtime.sendMessage({action: 'requestPass', duration: duration});
    });
  });

  function addNewSite() {
    let site = newSiteInput.value.trim();

    // Basic validation
    if (!site) return;

    // Add http:// prefix if missing and not a simple domain
    if (!site.includes('.')) {
      newSiteInput.value = '';
      showInputError('Please enter a valid domain (e.g., twitter.com)');
      return;
    }

    // Remove http/https protocol if included
    if (site.startsWith('http://')) site = site.substring(7);
    if (site.startsWith('https://')) site = site.substring(8);

    // Remove www. prefix if included
    if (site.startsWith('www.')) site = site.substring(4);

    chrome.storage.sync.get('blockedSites', function(data) {
      const blockedSites = data.blockedSites || [];

      // Check for duplicates
      if (blockedSites.some(existingSite => existingSite.toLowerCase() === site.toLowerCase())) {
        showInputError('This site is already blocked');
        return;
      }

      blockedSites.push(site);
      chrome.storage.sync.set({blockedSites: blockedSites}, function() {
        addSiteToList(site);
        newSiteInput.value = '';
        emptyStateMessage.style.display = 'none';
      });
    });
  }

  function showInputError(message) {
    newSiteInput.classList.add('error');
    newSiteInput.placeholder = message;

    setTimeout(() => {
      newSiteInput.classList.remove('error');
      newSiteInput.placeholder = 'e.g., twitter.com, youtube.com';
    }, 2000);
  }

  function addSiteToList(site) {
    const li = document.createElement('li');

    const siteNameSpan = document.createElement('span');
    siteNameSpan.textContent = site;
    siteNameSpan.className = 'site-name';
    li.appendChild(siteNameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'remove-button';

    removeBtn.addEventListener('click', function() {
      chrome.storage.sync.get('blockedSites', function(data) {
        const blockedSites = data.blockedSites.filter(s => s !== site);
        chrome.storage.sync.set({blockedSites: blockedSites}, function() {
          li.remove();

          // Show empty state if no sites left
          if (blockedSites.length === 0) {
            emptyStateMessage.style.display = 'block';
          }
        });
      });
    });

    li.appendChild(removeBtn);
    siteList.appendChild(li);
  }
});