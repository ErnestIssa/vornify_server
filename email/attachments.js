const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const CLOUDINARY_HOSTS = new Set([
  'res.cloudinary.com',
  'cloudinary.com',
]);

function isAllowedCloudinaryUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    return CLOUDINARY_HOSTS.has(u.hostname) || u.hostname.endsWith('.cloudinary.com');
  } catch {
    return false;
  }
}

function sanitizeFilename(name) {
  const base = String(name || 'attachment')
    .replace(/[/\\<>:"|?*\x00-\x1f]/g, '_')
    .replace(/\.\./g, '_')
    .slice(0, 180);
  return base || 'attachment';
}

function normalizeInlineAttachments(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || !item.contentBase64) continue;
    const buf = Buffer.from(String(item.contentBase64), 'base64');
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error('ATTACHMENT_TOO_LARGE');
    }
    const type = item.type || 'application/octet-stream';
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) {
      throw new Error('ATTACHMENT_MIME_INVALID');
    }
    out.push({
      content: item.contentBase64,
      filename: sanitizeFilename(item.filename),
      type,
      disposition: 'attachment',
    });
  }
  return out;
}

async function fetchCloudinaryAttachment(url, meta = {}) {
  if (!isAllowedCloudinaryUrl(url)) {
    throw new Error('ATTACHMENT_URL_NOT_ALLOWED');
  }
  const https = require('https');
  const DOWNLOAD_TIMEOUT_MS = 20_000;
  const buf = await new Promise((resolve, reject) => {
    const req = https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`ATTACHMENT_DOWNLOAD_${response.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_ATTACHMENT_BYTES) {
            reject(new Error('ATTACHMENT_TOO_LARGE'));
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });
    req.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      req.destroy(new Error('ATTACHMENT_DOWNLOAD_TIMEOUT'));
    });
    req.on('error', reject);
  });
  return {
    content: buf.toString('base64'),
    filename: sanitizeFilename(meta.filename || meta.name),
    type: meta.type || meta.mimeType || 'application/octet-stream',
    disposition: 'attachment',
  };
}

async function resolveAttachments(payload) {
  const inline = normalizeInlineAttachments(payload?.attachments);
  const refs = Array.isArray(payload?.attachmentUrls) ? payload.attachmentUrls : [];
  const fetched = [];
  for (const ref of refs) {
    const url = ref.url || ref.secure_url || ref.path;
    if (!url) continue;
    fetched.push(await fetchCloudinaryAttachment(url, ref));
  }
  return [...inline, ...fetched];
}

module.exports = {
  normalizeInlineAttachments,
  resolveAttachments,
  isAllowedCloudinaryUrl,
  MAX_ATTACHMENT_BYTES,
};
