// Project pages: the browser's Back button returns to the project log, wherever the reader came
// from. Arriving from anywhere but the log, we slip a `projects/` entry underneath this page in
// the history; going back lands on it and we load the log there.
(() => {
  let from = '';
  try { from = document.referrer ? new URL(document.referrer).pathname : ''; } catch (e) { /* opaque referrer */ }
  if (/\/projects\/(index\.html)?$/.test(from)) return;
  const here = location.pathname + location.search + location.hash;
  history.replaceState({ log: true }, '', './');
  history.pushState(null, '', here);
  addEventListener('popstate', () => { if (history.state && history.state.log) location.replace('./'); });
})();
