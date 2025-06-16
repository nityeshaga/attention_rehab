function updateCountdown() {
    console.log('updateCountdown called');
    
    // Get the blocked URL from the URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const blockedUrl = urlParams.get('from');
    
    console.log('blockedUrl:', blockedUrl);
    
    if (!blockedUrl) {
        console.log('No blocked URL found, setting default message');
        document.getElementById('countdown-display').innerHTML = 'Pattern-breaking mode: ACTIVE! 🧠⚡';
        return;
    }

    // Extract domain from URL
    const domain = new URL(blockedUrl).hostname.replace(/^www\./, '');

    // Get blocked sites data
    console.log('Attempting to get blocked sites from chrome.storage');
    chrome.storage.sync.get(['blockedSites'], function(data) {
        console.log('Storage data received:', data);
        if (!data.blockedSites) {
            console.log('No blocked sites found in storage');
            document.getElementById('countdown-display').innerHTML = 'Pattern-breaking mode: ACTIVE! 🧠⚡';
            return;
        }

        // Find the matching site
        console.log('Looking for domain:', domain);
        console.log('Blocked sites:', data.blockedSites);
        const matchingSite = data.blockedSites.find(site => {
            if (typeof site === 'string') return false;
            const siteClean = site.site.replace(/^www\./, '');
            console.log('Checking site:', siteClean, 'against domain:', domain);
            return domain === siteClean || domain.endsWith('.' + siteClean);
        });
        console.log('Matching site found:', matchingSite);

        if (matchingSite && matchingSite.hardBlockExpiry) {
            const remainingMs = matchingSite.hardBlockExpiry - Date.now();
            
            if (remainingMs > 0) {
                const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
                const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
                
                let countdownText;
                if (remainingDays > 1) {
                    countdownText = `Just <strong>${remainingDays} more days</strong> to break the pattern! 💪`;
                } else if (remainingDays === 1) {
                    countdownText = `Less than <strong>24 hours</strong> left! You're almost there! 🔥`;
                } else if (remainingHours > 1) {
                    countdownText = `Only <strong>${remainingHours} hours</strong> left! The finish line is in sight! 🏁`;
                } else {
                    countdownText = `<strong>Less than 1 hour</strong> left! You absolute legend! 🏆`;
                }
                
                document.getElementById('countdown-display').innerHTML = countdownText;
            } else {
                document.getElementById('countdown-display').innerHTML = '🎉 <strong>PATTERN BROKEN!</strong> You did it! Hard block complete! 🎉';
            }
        } else {
            document.getElementById('countdown-display').innerHTML = 'Pattern-breaking mode: ACTIVE! 🧠⚡';
        }
    });
}

console.log('hard-blocked.js loaded');

// Simple test function
function testCountdownDisplay() {
    console.log('Testing countdown display element');
    const element = document.getElementById('countdown-display');
    if (element) {
        console.log('Element found, updating text');
        element.innerHTML = 'Just <strong>5 more days</strong> to break the pattern! 💪 (test)';
    } else {
        console.log('Element NOT found!');
    }
}

// Update countdown when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, calling updateCountdown');
    testCountdownDisplay(); // Test first
    updateCountdown();
});

// Update countdown every minute
setInterval(updateCountdown, 60000);