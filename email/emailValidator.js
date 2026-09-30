const { getDefinition, resolveSubjectForJob } = require('./emailDefinitions');

const APPROVED_HOSTS = () => {
  const hosts = new Set(['peakmode.se', 'www.peakmode.se', 'localhost', '127.0.0.1']);
  for (const key of ['STOREFRONT_URL', 'FRONTEND_URL', 'PUBLIC_STORE_URL']) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      hosts.add(u.hostname);
    } catch {
      /* ignore */
    }
  }
  return hosts;
};

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isHttpsUrl(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (process.env.NODE_ENV === 'production' && u.protocol !== 'https:') return false;
    return APPROVED_HOSTS().has(u.hostname) || u.hostname.endsWith('.peakmode.se');
  } catch {
    return false;
  }
}

function validateEmailJob({ emailType, recipient, payload }) {
  const def = getDefinition(emailType);
  if (!def) {
    return { valid: false, error: 'UNKNOWN_EMAIL_TYPE', details: emailType };
  }
  if (!isValidEmail(recipient)) {
    return { valid: false, error: 'INVALID_RECIPIENT' };
  }
  const resolvedSubject = resolveSubjectForJob(emailType, payload);
  if (!resolvedSubject) {
    return { valid: false, error: 'MISSING_SUBJECT_DEFINITION' };
  }

  const data = payload || {};
  if (def.deliveryMode === 'html') {
    if (!data.html || !String(data.html).trim()) {
      return { valid: false, error: 'MISSING_HTML_BODY' };
    }
  }
  for (const field of def.requiredFields || []) {
    const val = data[field] ?? data[field.replace(/Url$/, '_url')] ?? data[field.replace(/Url$/, '_link')];
    if (val == null || String(val).trim() === '') {
      return { valid: false, error: 'MISSING_REQUIRED_FIELD', field };
    }
  }

  for (const urlField of def.urlFields || []) {
    const val =
      data[urlField] ||
      data[`${urlField.replace(/Url$/, '')}_url`] ||
      data[`${urlField.replace(/Url$/, '')}_link`];
    if (val && !isHttpsUrl(val)) {
      return { valid: false, error: 'INVALID_URL', field: urlField, value: String(val).slice(0, 80) };
    }
  }

  return { valid: true, subject: resolvedSubject };
}

module.exports = {
  validateEmailJob,
  isValidEmail,
  isHttpsUrl,
};
