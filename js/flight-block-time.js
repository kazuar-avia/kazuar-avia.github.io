(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UCAAFlightBlockTime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function speedKnots(aircraft = {}, title = '') {
    const text = String([
      aircraft?.registration, aircraft?.airframeIdent, aircraft?.airframeType,
      aircraft?.icao, aircraft?.name, aircraft?.customName, title
    ].filter(Boolean).join(' ')).toUpperCase();
    if (/\bAN-?2\b/.test(text) || text.includes('UR-40308')) return 90;
    if (text.includes('C208') || text.includes('CESSNA 208') || text.includes('UR-PAX') || text.includes('UR-VAN')) return 150;
    if (text.includes('F27') || text.includes('F271') || text.includes('UR-KZR')) return 215;
    if (/\bAT4[23]?\b/.test(text) || /\bATR[\s-]*42\b/.test(text)) return 225;
    if (/\bAT7[256]?\b/.test(text) || /\bATR(?:[\s-]*(?:72|75|76))?\b/.test(text) || text.includes('UR-RWC') || text.includes('UR-ATR')) return 245;
    return 430;
  }

  function blockMinutes(distanceNm, aircraft = {}, title = '') {
    const nm = Number(distanceNm);
    if (!Number.isFinite(nm) || nm <= 0) return 0;
    return Math.max(10, Math.round((30 + nm / speedKnots(aircraft, title) * 60) / 10) * 10);
  }

  return {speedKnots, blockMinutes};
});
