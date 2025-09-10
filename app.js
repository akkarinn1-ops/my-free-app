if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

document.getElementById('save').onclick = () => {
  localStorage.setItem('memo', 'こんにちは！ ' + new Date().toLocaleString());
  document.getElementById('out').textContent = localStorage.getItem('memo');
};
