/**
 * Language for Hub / account emails at send time (default English).
 */
function normalizeLang(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (s === 'sv' || s.startsWith('sv-') || s === 'swedish') return 'sv';
  if (s === 'en' || s.startsWith('en-') || s === 'english') return 'en';
  return null;
}

function fromAcceptLanguage(header) {
  if (!header) return null;
  const first = String(header).split(',')[0]?.split(';')[0]?.trim();
  return normalizeLang(first);
}

function resolveHubEmailLanguage(options = {}) {
  const fromOptions =
    normalizeLang(options.language) ||
    normalizeLang(options.locale) ||
    normalizeLang(options.user?.language) ||
    normalizeLang(options.user?.locale) ||
    normalizeLang(options.user?.preferredLanguage) ||
    fromAcceptLanguage(options.acceptLanguage || options.req?.headers?.['accept-language']);

  return fromOptions || 'en';
}

module.exports = { resolveHubEmailLanguage, normalizeLang };
