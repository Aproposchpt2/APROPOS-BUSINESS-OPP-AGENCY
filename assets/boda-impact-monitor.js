/* BODA opportunity monitor: aggregate counts only, never exposes recipient information. */
(() => {
  const number = document.getElementById('bodaImpactCount');
  const status = document.getElementById('bodaImpactStatus');
  if (!number || !status) return;
  const url = 'https://bcp.aproposgroupllc.com/.netlify/functions/boda-opportunity-counts';
  async function refresh() {
    try {
      const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
      if (!response.ok) throw new Error('Counts unavailable');
      const data = await response.json();
      if (!data.ok || !Number.isSafeInteger(data.unique_businesses) || data.unique_businesses < 0) throw new Error('Invalid count');
      number.textContent = data.unique_businesses.toLocaleString('en-US');
      status.textContent = data.historical_reconciliation_complete
        ? 'Verified opportunity outreach records · Updates every 5 minutes'
        : 'Recorded opportunity introductions · Historical reconciliation in progress';
    } catch (_) {
      number.textContent = '—';
      status.textContent = 'Live count temporarily unavailable';
    }
  }
  refresh();
  setInterval(refresh, 300000);
})();
