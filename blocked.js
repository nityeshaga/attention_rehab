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

function renderHourlyChart() {
    chrome.storage.local.get(['hourlyPassTypeUsage'], function(result) {
        const hourlyData = result.hourlyPassTypeUsage || Array(24).fill({1: 0, 5: 0, 15: 0});
        const chartContainer = document.getElementById('hourly-chart');
        
        // Clear previous chart if any
        chartContainer.innerHTML = '';
        
        // Calculate the maximum total passes in any hour for scaling
        let maxTotal = 1; // Default to 1 to avoid division by zero
        hourlyData.forEach(hourData => {
            const total = (hourData[1] || 0) + (hourData[5] || 0) + (hourData[15] || 0);
            if (total > maxTotal) maxTotal = total;
        });
        
        // Add horizontal grid lines for better readability
        if (maxTotal > 0) {
            // Add grid lines at 25%, 50%, 75%, and 100% of max value
            [0.25, 0.5, 0.75, 1].forEach(ratio => {
                const gridLine = document.createElement('div');
                gridLine.className = 'chart-axis';
                gridLine.style.bottom = `${ratio * 100}%`;
                
                // Add label for this grid line
                const label = document.createElement('div');
                label.className = 'chart-axis-label';
                label.style.bottom = `${ratio * 100}%`;
                label.textContent = Math.round(maxTotal * ratio);
                
                chartContainer.appendChild(gridLine);
                chartContainer.appendChild(label);
            });
        }
        
        // Create bars for each hour
        hourlyData.forEach((hourData, hour) => {
            const pass1Count = hourData[1] || 0;
            const pass5Count = hourData[5] || 0;
            const pass15Count = hourData[15] || 0;
            const totalPasses = pass1Count + pass5Count + pass15Count;
            
            // Skip rendering if no passes for this hour
            if (totalPasses === 0) {
                const emptyBar = document.createElement('div');
                emptyBar.className = 'chart-bar';
                emptyBar.style.height = '1%'; // Minimal height for empty bars
                
                // Add hour label
                const label = document.createElement('div');
                label.className = 'chart-bar-label';
                label.textContent = hour === 0 ? '12am' : hour === 12 ? '12pm' : hour > 12 ? `${hour-12}pm` : `${hour}am`;
                
                emptyBar.appendChild(label);
                chartContainer.appendChild(emptyBar);
                return;
            }
            
            // Create the main bar container
            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            bar.style.height = `${(totalPasses / maxTotal) * 100}%`;
            bar.style.background = 'none'; // Remove default background
            bar.style.display = 'flex';
            bar.style.flexDirection = 'column-reverse'; // Stack from bottom
            bar.style.overflow = 'hidden';
            
            // Add hour label
            const label = document.createElement('div');
            label.className = 'chart-bar-label';
            label.textContent = hour === 0 ? '12am' : hour === 12 ? '12pm' : hour > 12 ? `${hour-12}pm` : `${hour}am`;
            
            // Add count value that shows on hover
            const value = document.createElement('div');
            value.className = 'chart-bar-value';
            value.textContent = `${totalPasses} pass${totalPasses > 1 ? 'es' : ''}`;
            
            // Create segments for each pass type
            if (pass1Count > 0) {
                const segment1 = document.createElement('div');
                segment1.className = 'pass-segment pass-segment-1';
                segment1.style.height = `${(pass1Count / totalPasses) * 100}%`;
                segment1.setAttribute('title', `${pass1Count} 1-minute pass${pass1Count > 1 ? 'es' : ''}`);
                bar.appendChild(segment1);
            }
            
            if (pass5Count > 0) {
                const segment5 = document.createElement('div');
                segment5.className = 'pass-segment pass-segment-5';
                segment5.style.height = `${(pass5Count / totalPasses) * 100}%`;
                segment5.setAttribute('title', `${pass5Count} 5-minute pass${pass5Count > 1 ? 'es' : ''}`);
                bar.appendChild(segment5);
            }
            
            if (pass15Count > 0) {
                const segment15 = document.createElement('div');
                segment15.className = 'pass-segment pass-segment-15';
                segment15.style.height = `${(pass15Count / totalPasses) * 100}%`;
                segment15.setAttribute('title', `${pass15Count} 15-minute pass${pass15Count > 1 ? 'es' : ''}`);
                bar.appendChild(segment15);
            }
            
            // Add subtle animation delay for a staggered effect
            bar.style.transitionDelay = `${hour * 30}ms`;
            
            bar.appendChild(label);
            bar.appendChild(value);
            chartContainer.appendChild(bar);
        });
        
        // Add animation class to trigger the bars to grow from bottom
        setTimeout(() => {
            const bars = chartContainer.querySelectorAll('.chart-bar');
            bars.forEach(bar => {
                const originalHeight = bar.style.height;
                bar.style.height = '0%';
                
                // Force reflow
                void bar.offsetWidth;
                
                // Animate to original height
                bar.style.height = originalHeight;
            });
        }, 100);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    saveBlockedUrl();
    updatePassCounts();
    renderHourlyChart();

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
                    renderHourlyChart(); // Update the chart after granting a pass
                }
            });
        });
    });
});