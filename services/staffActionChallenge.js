/**
 * One-time typed challenges for Super Admin staff control actions.
 * Codes are 12 chars (letters, digits, symbols). Never reused for the same
 * actor within a session window, and never repeated for the same action+target.
 */

const crypto = require('crypto');
const getDBInstance = require('../vornifydb/dbInstance');

const db = getDBInstance();
const DATABASE = 'peakmode';
const COLLECTION = 'admin_staff_challenges';

const CHALLENGE_LEN = 12;
const TTL_MS = 10 * 60 * 1000;
/** Codes issued to an actor in this window must not repeat. */
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;

const ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_=+';

const ACTIONS = new Set([
    'update',
    'suspend',
    'reactivate',
    'remove',
    'revoke_sessions',
    'reset_mfa'
]);

function nowIso() {
    return new Date().toISOString();
}

function randomCode() {
    let out = '';
    const bytes = crypto.randomBytes(CHALLENGE_LEN);
    for (let i = 0; i < CHALLENGE_LEN; i += 1) {
        out += ALPHABET[bytes[i] % ALPHABET.length];
    }
    return out;
}

function normalizeAction(action) {
    return String(action || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
}

function isKnownAction(action) {
    return ACTIONS.has(normalizeAction(action));
}

async function readRecentForActor(actorId) {
    const since = new Date(Date.now() - SESSION_WINDOW_MS).toISOString();
    const result = await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--read',
        data: { actorId: String(actorId) }
    });
    if (!result.success || !result.data) return [];
    const rows = Array.isArray(result.data) ? result.data : [result.data];
    return rows.filter((row) => String(row.createdAt || '') >= since);
}

async function issueChallenge({ actorId, targetStaffId, action }) {
    const normalized = normalizeAction(action);
    if (!isKnownAction(normalized)) {
        return { ok: false, error: 'Unknown staff action', code: 'INVALID_ACTION' };
    }
    const actor = String(actorId || '').trim();
    const target = String(targetStaffId || '').trim();
    if (!actor || !target) {
        return { ok: false, error: 'Missing actor or target', code: 'VALIDATION_ERROR' };
    }

    const recent = await readRecentForActor(actor);
    const usedCodes = new Set(recent.map((row) => String(row.code || '')));
    const sameActionCodes = new Set(
        recent
            .filter(
                (row) =>
                    String(row.action) === normalized && String(row.targetStaffId) === target
            )
            .map((row) => String(row.code || ''))
    );

    let code = '';
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const candidate = randomCode();
        if (usedCodes.has(candidate)) continue;
        if (sameActionCodes.has(candidate)) continue;
        code = candidate;
        break;
    }
    if (!code) {
        return { ok: false, error: 'Could not issue a unique challenge', code: 'CHALLENGE_EXHAUSTED' };
    }

    const id = `ch_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const stamp = nowIso();
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const doc = {
        id,
        actorId: actor,
        targetStaffId: target,
        action: normalized,
        code,
        expiresAt,
        consumedAt: null,
        createdAt: stamp
    };

    const created = await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--create',
        data: doc
    });
    if (!created.success) {
        return { ok: false, error: created.error || 'Failed to create challenge', code: 'CHALLENGE_CREATE_FAILED' };
    }

    return {
        ok: true,
        challengeId: id,
        challenge: code,
        action: normalized,
        expiresAt
    };
}

async function consumeChallenge({ actorId, targetStaffId, action, challengeId, challenge }) {
    const normalized = normalizeAction(action);
    const actor = String(actorId || '').trim();
    const target = String(targetStaffId || '').trim();
    const id = String(challengeId || '').trim();
    const typed = String(challenge || '');

    if (!isKnownAction(normalized) || !actor || !target || !id || typed.length !== CHALLENGE_LEN) {
        return { ok: false, error: 'Challenge confirmation failed', code: 'CHALLENGE_INVALID' };
    }

    const result = await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--read',
        data: { id }
    });
    if (!result.success || !result.data) {
        return { ok: false, error: 'Challenge not found or expired', code: 'CHALLENGE_NOT_FOUND' };
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) {
        return { ok: false, error: 'Challenge not found or expired', code: 'CHALLENGE_NOT_FOUND' };
    }
    if (row.consumedAt) {
        return { ok: false, error: 'Challenge already used', code: 'CHALLENGE_USED' };
    }
    if (String(row.expiresAt || '') < nowIso()) {
        return { ok: false, error: 'Challenge expired — request a new one', code: 'CHALLENGE_EXPIRED' };
    }
    if (String(row.actorId) !== actor) {
        return { ok: false, error: 'Challenge does not belong to this session', code: 'CHALLENGE_ACTOR_MISMATCH' };
    }
    if (String(row.targetStaffId) !== target || String(row.action) !== normalized) {
        return { ok: false, error: 'Challenge does not match this action', code: 'CHALLENGE_ACTION_MISMATCH' };
    }
    if (String(row.code) !== typed) {
        return { ok: false, error: 'Challenge code does not match', code: 'CHALLENGE_MISMATCH' };
    }

    await db.executeOperation({
        database_name: DATABASE,
        collection_name: COLLECTION,
        command: '--update',
        data: {
            filter: { id },
            update: { consumedAt: nowIso() }
        }
    });

    return { ok: true, challengeId: id, action: normalized };
}

module.exports = {
    ACTIONS: [...ACTIONS],
    CHALLENGE_LEN,
    isKnownAction,
    issueChallenge,
    consumeChallenge
};
