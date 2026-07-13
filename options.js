document.addEventListener('DOMContentLoaded', function () {
  var input = document.getElementById('api-key');
  var status = document.getElementById('status');

  chrome.storage.sync.get(['apiKey'], function (r) {
    if (r.apiKey) input.value = r.apiKey;
  });

  function flash(msg) {
    status.textContent = msg;
    setTimeout(function () { status.textContent = ''; }, 2500);
  }

  document.getElementById('save').addEventListener('click', function () {
    var key = input.value.trim();
    chrome.storage.sync.set({ apiKey: key }, function () { flash(key ? 'Saved.' : 'Cleared (fallback mode).'); });
  });

  document.getElementById('clear').addEventListener('click', function () {
    input.value = '';
    chrome.storage.sync.remove('apiKey', function () { flash('Cleared (fallback mode).'); });
  });
});
