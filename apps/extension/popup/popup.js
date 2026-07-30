const statusElement = document.querySelector('#status');
const { foundationStatus } = await chrome.storage.local.get('foundationStatus');

if (foundationStatus?.status === 'ready') {
  statusElement.textContent = 'Extension foundation is installed and ready.';
}
