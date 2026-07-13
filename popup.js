document.addEventListener('DOMContentLoaded', function() {
  const newSiteInput = document.getElementById('new-site');
  const addSiteButton = document.getElementById('add-site');
  const siteList = document.getElementById('site-list');
  const emptyStateMessage = document.getElementById('empty-sites-message');
  const STATIC_HOSTS = ['x.com', 'twitter.com', 'youtube.com'];

  function baseDomain(hostname) {
    hostname = hostname.replace(/^www\./, '').toLowerCase();
    const parts = hostname.split('.');
    if (parts.length > 2) return parts.slice(-2).join('.');
    return hostname;
  }

  // Load blocked sites
  chrome.storage.sync.get(['blockedSites'], function(data) {
    if (data.blockedSites && data.blockedSites.length > 0) {
      data.blockedSites.forEach(siteData => {
        addSiteToList(siteData.site, siteData.hardBlock || false, siteData.hardBlockExpiry || null);
      });
      emptyStateMessage.style.display = 'none';
    } else {
      emptyStateMessage.style.display = 'block';
    }
  });

  // Add new site
  addSiteButton.addEventListener('click', addNewSite);

  // Allow adding sites with Enter key
  newSiteInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      addNewSite();
    }
  });


  const openOptions = document.getElementById('open-options');
  if (openOptions) {
    openOptions.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

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

      const isDuplicate = blockedSites.some(existingSite =>
        existingSite.site.toLowerCase() === site.toLowerCase()
      );
      
      if (isDuplicate) {
        showInputError('This site is already blocked');
        return;
      }

      // Add in new object format
      blockedSites.push({ site: site, hardBlock: false, hardBlockExpiry: null });

      function persist() {
        chrome.storage.sync.set({blockedSites: blockedSites}, function() {
          addSiteToList(site, false, null);
          newSiteInput.value = '';
          emptyStateMessage.style.display = 'none';
        });
      }

      // Managed platforms already have host permission; user-added domains need
      // one granted (in this user gesture) so the enforcer can be injected.
      const base = baseDomain(site);
      if (STATIC_HOSTS.indexOf(base) === -1) {
        const origins = ['*://*.' + base + '/*', '*://' + base + '/*'];
        chrome.permissions.request({ origins: origins }, function (granted) {
          if (!granted) {
            showInputError('Permission needed to block ' + base);
            return;
          }
          persist();
        });
      } else {
        persist();
      }
    });
  }

  function showInputError(message) {
    newSiteInput.classList.add('error');
    newSiteInput.placeholder = message;

    setTimeout(() => {
      newSiteInput.classList.remove('error');
      newSiteInput.placeholder = 'e.g. twitter.com, reddit.com';
    }, 2000);
  }

  // Helper functions for 7-day lockout
  function isInLockout(hardBlockExpiry) {
    return hardBlockExpiry && Date.now() < hardBlockExpiry;
  }

  function getRemainingDays(hardBlockExpiry) {
    if (!hardBlockExpiry) return 0;
    const remainingMs = hardBlockExpiry - Date.now();
    return Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
  }

  function showHardBlockConfirmation(site, checkbox) {
    const confirmed = confirm(
      `⚠️ HARD BLOCK WARNING ⚠️\n\n` +
      `You are about to enable Hard Block for "${site}".\n\n` +
      `This means:\n` +
      `• The site will be COMPLETELY INACCESSIBLE for 7 DAYS\n` +
      `• NO access passes will be available\n` +
      `• The ONLY way to access this site will be to uninstall the entire extension\n` +
      `• You CANNOT undo this for 7 days\n\n` +
      `Are you absolutely sure you want to proceed?\n\n` +
      `This is designed to help you break harmful browsing patterns.`
    );
    
    if (confirmed) {
      toggleHardBlock(site, true);
    } else {
      // Reset the checkbox if user cancelled
      checkbox.checked = false;
    }
  }

  function addSiteToList(site, isHardBlock = false, hardBlockExpiry = null) {
    const li = document.createElement('li');
    if (isHardBlock) {
      li.classList.add('hard-block');
    }

    // Site info container
    const siteInfo = document.createElement('div');
    siteInfo.className = 'site-info';

    const siteNameSpan = document.createElement('span');
    siteNameSpan.textContent = site;
    siteNameSpan.className = isHardBlock ? 'site-name hard-block' : 'site-name';
    siteInfo.appendChild(siteNameSpan);

    // Add hard block indicator icon
    if (isHardBlock) {
      const indicator = document.createElement('span');
      indicator.textContent = 'no passes';
      indicator.className = 'hard-block-indicator';
      indicator.title = 'Hard block — no access passes available';
      siteInfo.appendChild(indicator);
    }

    li.appendChild(siteInfo);

    // Controls container
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'site-controls';

    // Hard block toggle
    const hardBlockContainer = document.createElement('div');
    hardBlockContainer.className = 'hard-block-toggle-container';

    const hardBlockLabel = document.createElement('div');
    hardBlockLabel.className = 'hard-block-label';
    hardBlockLabel.textContent = 'Hard';

    const hardBlockSwitch = document.createElement('label');
    hardBlockSwitch.className = 'hard-block-switch';

    const hardBlockInput = document.createElement('input');
    hardBlockInput.type = 'checkbox';
    hardBlockInput.checked = isHardBlock;
    
    // Check if in lockout period
    const inLockout = isInLockout(hardBlockExpiry);
    const remainingDays = getRemainingDays(hardBlockExpiry);
    
    if (inLockout) {
      hardBlockInput.disabled = true;
      hardBlockLabel.textContent = `${remainingDays}d`;
      hardBlockLabel.title = `Hard block active for ${remainingDays} more days`;
      hardBlockLabel.style.color = '#b3261e';
      hardBlockLabel.style.fontSize = '9px';
    }
    
    hardBlockInput.addEventListener('change', function() {
      if (this.checked) {
        showHardBlockConfirmation(site, this);
      } else {
        toggleHardBlock(site, false);
      }
    });

    const hardBlockSlider = document.createElement('span');
    hardBlockSlider.className = 'hard-block-slider';

    hardBlockSwitch.appendChild(hardBlockInput);
    hardBlockSwitch.appendChild(hardBlockSlider);
    hardBlockContainer.appendChild(hardBlockLabel);
    hardBlockContainer.appendChild(hardBlockSwitch);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.className = 'remove-button';
    removeBtn.addEventListener('click', function() {
      removeSite(site, li);
    });

    controlsDiv.appendChild(hardBlockContainer);
    controlsDiv.appendChild(removeBtn);
    li.appendChild(controlsDiv);
    siteList.appendChild(li);
  }

  function toggleHardBlock(site, isHardBlock) {
    chrome.storage.sync.get('blockedSites', function(data) {
      const blockedSites = data.blockedSites || [];
      
      // Find and update the site
      const updatedSites = blockedSites.map(siteData => {
        if (siteData.site === site) {
          const expiry = isHardBlock ? (Date.now() + (7 * 24 * 60 * 60 * 1000)) : null;
          return { site: site, hardBlock: isHardBlock, hardBlockExpiry: expiry };
        }
        return siteData;
      });

      chrome.storage.sync.set({blockedSites: updatedSites}, function() {
        // Refresh the site list to update visual indicators
        refreshSiteList();
      });
    });
  }

  function removeSite(site, li) {
    chrome.storage.sync.get('blockedSites', function(data) {
      const blockedSites = data.blockedSites.filter(siteData => siteData.site !== site);
      
      chrome.storage.sync.set({blockedSites: blockedSites}, function() {
        li.remove();

        // Show empty state if no sites left
        if (blockedSites.length === 0) {
          emptyStateMessage.style.display = 'block';
        }
      });
    });
  }

  function refreshSiteList() {
    // Clear current list
    siteList.innerHTML = '';
    
    // Reload sites
    chrome.storage.sync.get(['blockedSites'], function(data) {
      if (data.blockedSites && data.blockedSites.length > 0) {
        data.blockedSites.forEach(siteData => {
          addSiteToList(siteData.site, siteData.hardBlock || false, siteData.hardBlockExpiry || null);
        });
        emptyStateMessage.style.display = 'none';
      } else {
        emptyStateMessage.style.display = 'block';
      }
    });
  }
});