let timerElement = null;
let countdownInterval = null;

function createTimerElement(duration) {
  if (timerElement) {
    // Timer already exists, just update the duration
    startCountdown(duration * 60);
    return;
  }

  timerElement = document.createElement('div');
  timerElement.style.position = 'fixed';
  timerElement.style.bottom = '20px';
  timerElement.style.right = '20px';
  timerElement.style.padding = '10px';
  timerElement.style.backgroundColor = '#2196F3'; // Main blue color from your CSS
  timerElement.style.color = 'white';
  timerElement.style.borderRadius = '4px'; // Matching the border-radius from your CSS
  timerElement.style.zIndex = '9999';
  timerElement.style.fontFamily = 'Arial, sans-serif'; // Matching the font-family from your CSS
  timerElement.style.fontSize = '14px'; // Matching the font-size of buttons in your CSS
  timerElement.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)'; // Adding a subtle shadow for depth
  document.body.appendChild(timerElement);

  startCountdown(duration * 60); // Convert minutes to seconds
}

function startCountdown(seconds) {
  updateTimerDisplay(seconds);
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  countdownInterval = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(countdownInterval);
      timerElement.remove();
      timerElement = null;
    } else {
      updateTimerDisplay(seconds);
    }
  }, 1000);
}

function updateTimerDisplay(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  timerElement.textContent = `Pass expires in: ${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startTimer') {
    createTimerElement(parseInt(request.duration));
  }
});

console.log('Timer content script loaded');
