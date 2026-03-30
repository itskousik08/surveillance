/* SENTINEL AI — static/js/sentinel.js
   Optional: Move inline JS here if you prefer separation.
   Currently all JS is inline in templates for zero-dependency offline use. */

// Utility: format timestamp to HH:MM:SS
function fmtTime(iso) {
  if (!iso) return '--:--:--';
  return iso.substring(11, 19);
}

// Utility: confidence to color class
function confColor(pct) {
  if (pct >= 80) return '#ff3636';
  if (pct >= 60) return '#ffd600';
  return '#00e87a';
}
