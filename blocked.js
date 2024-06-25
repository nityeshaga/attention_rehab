function saveBlockedUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const blockedUrl = urlParams.get('from');
    if (blockedUrl) {
        chrome.storage.local.set({blockedUrl: blockedUrl}, function() {
            console.log('Blocked URL saved to storage:', blockedUrl);
        });
    }
}

function updatePassCounts() {
    chrome.storage.local.get(['passCounts'], function(result) {
        const passCounts = result.passCounts || { '1': 0, '5': 0, '15': 0 };
        document.getElementById('count-1').textContent = `Issued ${passCounts['1']} times today`;
        document.getElementById('count-5').textContent = `Issued ${passCounts['5']} times today`;
        document.getElementById('count-15').textContent = `Issued ${passCounts['15']} times today`;
    });
}

document.addEventListener('DOMContentLoaded', () => {
    saveBlockedUrl();
    updatePassCounts();

    const passButtons = document.querySelectorAll('.pass-button');
    console.log('Found pass buttons:', passButtons.length);
    
    passButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            const duration = button.getAttribute('data-duration');
            console.log('Button clicked. Duration attribute:', duration);
            
            if (!duration) {
                console.error('Duration is null or undefined');
                return;
            }
            
            console.log('Requesting pass for', duration, 'minutes');
            chrome.runtime.sendMessage({action: 'requestPass', duration: duration}, response => {
                console.log('Received response:', response);
                if (!response || !response.granted) {
                    console.error('Pass not granted:', response ? response.error : 'Unknown error');
                } else {
                    updatePassCounts(); // Update counts after granting a pass
                }
            });
        });
    });
});