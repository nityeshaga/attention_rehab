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
    // We'll keep this function for backward compatibility
    // but modify it to use the new data structure
    const today = getToday();
    chrome.storage.local.get(['passData'], function(result) {
        const passData = result.passData || {};
        const todayData = passData[today] || {};
        
        // Calculate total passes for today
        let pass1Total = 0, pass5Total = 0, pass15Total = 0;
        
        for (let hour = 0; hour < 24; hour++) {
            const hourData = todayData[hour] || { "1": 0, "5": 0, "15": 0 };
            pass1Total += hourData["1"] || 0;
            pass5Total += hourData["5"] || 0;
            pass15Total += hourData["15"] || 0;
        }
        
        document.getElementById('count-1').textContent = `Issued ${pass1Total} times today`;
        document.getElementById('count-5').textContent = `Issued ${pass5Total} times today`;
        document.getElementById('count-15').textContent = `Issued ${pass15Total} times today`;
    });
}

// Helper function to get today's date in YYYY-MM-DD format
function getToday() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Helper function to get a date string for N days ago
function getDateString(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Helper function to get data for the last 24 hours
function getLast24HoursData(passData) {
    const currentDate = new Date();
    const currentHour = currentDate.getHours();
    const result = [];
    
    // Start with today's data up to the current hour
    const today = getToday();
    const todayData = passData[today] || {};
    
    // Add data for hours from yesterday that fall within the last 24 hours
    const yesterday = getDateString(1);
    const yesterdayData = passData[yesterday] || {};
    
    // First add yesterday's hours that fall within our 24-hour window
    for (let hour = currentHour + 1; hour < 24; hour++) {
        result.push(yesterdayData[hour] || { "1": 0, "5": 0, "15": 0 });
    }
    
    // Then add today's hours up to and including the current hour
    for (let hour = 0; hour <= currentHour; hour++) {
        result.push(todayData[hour] || { "1": 0, "5": 0, "15": 0 });
    }
    
    return result;
}

// Helper function to get data for the last 7 days
function getLast7DaysData(passData) {
    const result = [];
    
    // Get data for each of the last 7 days
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
        const dateString = getDateString(daysAgo);
        const dayData = passData[dateString] || {};
        
        // Sum up all pass types for each day
        let day1MinTotal = 0;
        let day5MinTotal = 0;
        let day15MinTotal = 0;
        
        for (let hour = 0; hour < 24; hour++) {
            const hourData = dayData[hour] || { "1": 0, "5": 0, "15": 0 };
            day1MinTotal += hourData["1"] || 0;
            day5MinTotal += hourData["5"] || 0;
            day15MinTotal += hourData["15"] || 0;
        }
        
        // Add the daily totals to the result
        result.push({
            "1": day1MinTotal,
            "5": day5MinTotal,
            "15": day15MinTotal,
            "date": dateString
        });
    }
    
    return result;
}

// Global variable to track current view mode
let currentViewMode = '24h';

function renderHourlyChart() {
    chrome.storage.local.get(['passData'], function(result) {
        const passData = result.passData || {};
        
        // Get data based on current view mode
        let chartData;
        let isDaily = false;
        
        if (currentViewMode === '24h') {
            chartData = getLast24HoursData(passData);
        } else {
            chartData = getLast7DaysData(passData);
            isDaily = true;
        }
        
        console.log(passData);
        console.log("Chart data:", chartData);
        
        const chartContainer = document.getElementById('hourly-chart');
        
        // Clear previous chart if any
        chartContainer.innerHTML = '';
        
        // Calculate the maximum total passes for scaling
        let maxTotal = 1; // Default to 1 to avoid division by zero
        chartData.forEach(dataPoint => {
            const total = (dataPoint["1"] || 0) + (dataPoint["5"] || 0) + (dataPoint["15"] || 0);
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
        
        // Get current date for time calculations
        const currentDate = new Date();
        
        // Create bars for each data point
        chartData.forEach((dataPoint, index) => {
            let barLabel;
            
            if (isDaily) {
                // For 7-day view, use date as label
                const date = new Date(dataPoint.date);
                barLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
            } else {
                // For 24-hour view, calculate hour label
                const hoursAgo = 24 - 1 - index;
                const barDate = new Date(currentDate);
                barDate.setHours(currentDate.getHours() - hoursAgo);
                const barHour = barDate.getHours();
                barLabel = barHour === 0 ? '12am' : barHour === 12 ? '12pm' : barHour > 12 ? `${barHour-12}pm` : `${barHour}am`;
            }
            
            const pass1Count = dataPoint["1"] || 0;
            const pass5Count = dataPoint["5"] || 0;
            const pass15Count = dataPoint["15"] || 0;
            const totalPasses = pass1Count + pass5Count + pass15Count;
            
            // Skip rendering if no passes for this period
            if (totalPasses === 0) {
                const emptyBar = document.createElement('div');
                emptyBar.className = 'chart-bar';
                emptyBar.style.height = '1%'; // Minimal height for empty bars
                
                // Add label
                const label = document.createElement('div');
                label.className = 'chart-bar-label';
                label.textContent = barLabel;
                
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
            bar.style.overflow = 'visible'; // Change from hidden to visible to ensure labels show
            
            // Add label
            const label = document.createElement('div');
            label.className = 'chart-bar-label';
            label.textContent = barLabel;
            
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
            bar.style.transitionDelay = `${index * 30}ms`;
            
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

    // Add event listeners for time range toggle buttons
    const toggle24h = document.getElementById('toggle-24h');
    const toggle7d = document.getElementById('toggle-7d');
    
    toggle24h.addEventListener('click', () => {
        if (currentViewMode !== '24h') {
            currentViewMode = '24h';
            toggle24h.classList.add('active');
            toggle7d.classList.remove('active');
            renderHourlyChart();
        }
    });
    
    toggle7d.addEventListener('click', () => {
        if (currentViewMode !== '7d') {
            currentViewMode = '7d';
            toggle7d.classList.add('active');
            toggle24h.classList.remove('active');
            renderHourlyChart();
        }
    });

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