function saveBlockedUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const blockedUrl = urlParams.get('from');
    if (blockedUrl) {
        localStorage.setItem('blockedUrl', blockedUrl);
        console.log('Blocked URL saved to localStorage:', blockedUrl);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    saveBlockedUrl();

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
                if (response && response.granted) {
                    console.log('Pass granted, attempting to redirect');
                    const blockedUrl = localStorage.getItem('blockedUrl');
                    console.log('Blocked URL from localStorage:', blockedUrl);
                    if (blockedUrl) {
                        chrome.runtime.sendMessage({action: 'redirect', url: blockedUrl}, redirectResponse => {
                            console.log('Redirect response:', redirectResponse);
                        });
                    } else {
                        console.error('No blocked URL found in localStorage');
                    }
                } else {
                    console.error('Pass not granted');
                }
            });
        });
    });
});