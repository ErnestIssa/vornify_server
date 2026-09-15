/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s) without extra dependencies.
 * MFA secrets are encrypted at rest with AES-256-GCM.
 */

const crypto = require('crypto');
const QRCode = require('qrcode');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encryptionKey() {
    const secret = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || '';
    return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function encryptSecret(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(payload) {
    if (!payload) return null;
    const text = String(payload);
    if (!text.includes(':')) return text;
    const [ivHex, tagHex, dataHex] = text.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
}

function toBase32(buf) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
    return output;
}

function fromBase32(str) {
    const clean = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const ch of clean) {
        const idx = BASE32.indexOf(ch);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

function generateSecret() {
    return toBase32(crypto.randomBytes(20));
}

function hotp(secretBuf, counter) {
    const buf = Buffer.alloc(8);
    buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    buf.writeUInt32BE(counter >>> 0, 4);
    const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    );
    return String(code % 1_000_000).padStart(6, '0');
}

function generateTotp(secretBase32, atMs = Date.now()) {
    const counter = Math.floor(atMs / 1000 / 30);
    return hotp(fromBase32(secretBase32), counter);
}

function verifyTotp(secretBase32, token, window = 1) {
    const expected = String(token || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(expected)) return false;
    const secret = fromBase32(secretBase32);
    if (!secret.length) return false;
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i += 1) {
        if (hotp(secret, counter + i) === expected) return true;
    }
    return false;
}

function otpauthUrl(email, secret, issuer = 'Peak Mode Admin') {
    const label = encodeURIComponent(`${issuer}:${email}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

async function qrDataUrl(otpauth) {
    return QRCode.toDataURL(otpauth, { margin: 1, width: 220 });
}

function generateRecoveryCodes(count = 8) {
    const codes = [];
    for (let i = 0; i < count; i += 1) {
        codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
    }
    return codes;
}

function hashRecoveryCode(code) {
    return crypto.createHash('sha256').update(String(code).replace(/\s+/g, '').toUpperCase(), 'utf8').digest('hex');
}

function consumeRecoveryCode(hashedList, code) {
    const hashed = hashRecoveryCode(code);
    const list = Array.isArray(hashedList) ? hashedList : [];
    const idx = list.indexOf(hashed);
    if (idx === -1) return { ok: false, remaining: list };
    const remaining = list.filter((_, i) => i !== idx);
    return { ok: true, remaining };
}

module.exports = {
    encryptSecret,
    decryptSecret,
    generateSecret,
    generateTotp,
    verifyTotp,
    otpauthUrl,
    qrDataUrl,
    generateRecoveryCodes,
    hashRecoveryCode,
    consumeRecoveryCode
};
