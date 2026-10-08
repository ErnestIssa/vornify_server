/**
 * Ensure the Fake Ernest admin account exists (role: admin, not super_admin).
 * Credentials come from FAKE_ADMIN_EMAIL / FAKE_ADMIN_PASSWORD / FAKE_ADMIN_NAME.
 * Same login path as every other staff account.
 */

const bcrypt = require('bcrypt');
const getDBInstance = require('../vornifydb/dbInstance');
const { isAllowedStaffEmail } = require('./staffAccessPolicy');

const db = getDBInstance();
const DATABASE = 'peakmode';
const COLLECTION = 'admins';

function fakeAdminConfig() {
    if (String(process.env.FAKE_ADMIN_ENABLED || 'true').toLowerCase() === 'false') {
        return null;
    }
    const email = String(process.env.FAKE_ADMIN_EMAIL || '')
        .toLowerCase()
        .trim();
    const password = String(process.env.FAKE_ADMIN_PASSWORD || '');
    const name = String(process.env.FAKE_ADMIN_NAME || 'Fake Ernest').trim() || 'Fake Ernest';
    if (!email || !password) return null;
    if (!isAllowedStaffEmail(email)) {
        console.warn(`[FAKE ADMIN] Refusing ${email} — must be a @peakmode.se staff email`);
        return null;
    }
    if (password.length < 6) {
        console.warn('[FAKE ADMIN] Password too short — skipped');
        return null;
    }
    return { email, password, name };
}

async function readByEmail(email) {
    const result = await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--read',
        data: { $or: [{ email }, { username: email }] }
    });
    if (!result.success || !result.data) return null;
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return rows[0] || null;
}

/**
 * Create or refresh the Fake Ernest admin (role admin).
 * Re-hashes password from env so Render/.env stays the source of truth.
 */
async function ensureFakeAdmin() {
    const config = fakeAdminConfig();
    if (!config) return { ok: false, skipped: true };

    const hashedPassword = await bcrypt.hash(config.password, 10);
    const stamp = new Date().toISOString();
    const existing = await readByEmail(config.email);

    const fields = {
        username: config.email,
        email: config.email,
        password: hashedPassword,
        name: config.name,
        role: 'admin',
        status: 'active',
        active: true,
        isFakeAdmin: true,
        mfa: { enabled: false },
        failedLoginAttempts: 0,
        lockedUntil: null,
        inviteToken: null,
        inviteExpiresAt: null,
        updatedAt: stamp
    };

    if (existing) {
        if (String(existing.role || '') === 'super_admin') {
            console.warn('[FAKE ADMIN] Existing account is super_admin — refusing to overwrite role');
            return { ok: false, skipped: true, reason: 'super_admin_guard' };
        }
        await db.executeOperation({
            database_name: DATABASE,
            collection_name: COLLECTION,
            command: '--update',
            data: {
                filter: { email: config.email },
                update: fields
            }
        });
        console.log(`[FAKE ADMIN] Refreshed ${config.email} (role: admin)`);
        return { ok: true, created: false, email: config.email };
    }

    await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--create',
        data: {
            ...fields,
            refreshTokens: [],
            createdAt: stamp
        }
    });
    console.log(`[FAKE ADMIN] Created ${config.email} (role: admin)`);
    return { ok: true, created: true, email: config.email };
}

module.exports = {
    ensureFakeAdmin,
    fakeAdminConfig
};
