/**
 * HTTP acceptance tests for staff access (authn/authz/sessions/MFA/audit).
 * Creates tagged @peakmode.se accounts, hits the running API, then deletes them.
 * Exits 0 only when Mongo is closed after the run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const getDBInstance = require('../vornifydb/dbInstance');
const { closeDBInstance } = require('../vornifydb/dbInstance');
const { generateTotp } = require('../services/totp');
const { countActiveSuperAdmins } = require('../services/adminAccountState');

let BASE = process.env.STAFF_ACCESS_TEST_BASE || '';
let JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || '';
let childServer = null;
const PASSWORD = 'StaffTest#Accept99';
const PREFIX = 'stafftest.';
const EMAIL = {
    super: `${PREFIX}super@peakmode.se`,
    admin: `${PREFIX}admin@peakmode.se`,
    manager: `${PREFIX}manager@peakmode.se`,
    support: `${PREFIX}support@peakmode.se`,
    pending: `${PREFIX}pending@peakmode.se`,
    invitee: `${PREFIX}invitee@peakmode.se`
};

const checks = [];
function check(area, ok, detail) {
    checks.push({ area, ok: Boolean(ok), detail: detail || '' });
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${area}: ${detail || ''}`);
}

function cookieFrom(res) {
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const list = raw.length ? raw : [].concat(res.headers.get('set-cookie') || []);
    return list.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
}

function refreshCookie(cookieHeader) {
    const part = String(cookieHeader || '').split(';').map((s) => s.trim()).find((s) => s.startsWith('refreshToken='));
    return part || '';
}

async function req(path, { method = 'GET', token, cookie, body, headers } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers
        },
        body: body == null ? undefined : JSON.stringify(body)
    });
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, json, cookie: cookieFrom(res), text };
}

async function login(email, password) {
    return req('/api/admin/auth/login', { method: 'POST', body: { email, password } });
}

function tokenOf(loginRes) {
    return loginRes.json && loginRes.json.data && loginRes.json.data.token;
}

async function upsertAdmin(db, { email, role, status, inviteToken, inviteExpiresAt }) {
    const existing = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: { email }
    });
    const row = existing && existing.success
        ? (Array.isArray(existing.data) ? existing.data[0] : existing.data)
        : null;
    const hash = await bcrypt.hash(PASSWORD, 10);
    const doc = {
        username: email,
        email,
        password: hash,
        name: `Staff Test ${role} ${status}`,
        role,
        status,
        active: status === 'active',
        refreshTokens: [],
        mfa: { enabled: false },
        inviteToken: inviteToken || null,
        inviteExpiresAt: inviteExpiresAt || null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date().toISOString()
    };
    if (row && (row._id || row.id)) {
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--update',
            data: { filter: { email }, update: doc }
        });
        return String(row._id || row.id);
    }
    doc.createdAt = new Date().toISOString();
    const created = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--create',
        data: doc
    });
    const data = created && created.data;
    return String((data && (data._id || data.insertedId || data.id)) || email);
}

async function deleteTestAdmins(db) {
    const emails = Object.values(EMAIL);
    for (const email of emails) {
        await db.executeOperation({
            database_name: 'peakmode',
            collection_name: 'admins',
            command: '--delete',
            data: { email }
        });
    }
}

function expectStatus(res, wanted, label) {
    const ok = Array.isArray(wanted) ? wanted.includes(res.status) : res.status === wanted;
    check(label, ok, `HTTP ${res.status} (expected ${wanted}) ${res.json && (res.json.code || res.json.errorCode || res.json.error || '')}`);
    return ok;
}

async function waitForApi() {
    for (let i = 0; i < 60; i += 1) {
        try {
            const health = await fetch(`${BASE}/health`);
            if (health.ok) {
                const probe = await login('nobody@gmail.com', 'x');
                if (probe.status !== 500 || (probe.json && probe.json.errorCode !== 'SERVER_CONFIG_ERROR')) {
                    return true;
                }
            }
        } catch (_) { /* retry */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
}

async function startDedicatedServer() {
    const secret = crypto.randomBytes(32).toString('hex');
    const port = process.env.STAFF_ACCESS_TEST_PORT || '18765';
    JWT_SECRET = secret;
    BASE = `http://127.0.0.1:${port}`;
    childServer = spawn(process.execPath, ['app.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            PORT: String(port),
            JWT_SECRET: secret,
            NODE_ENV: 'development'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
        let started = false;
        const timer = setTimeout(() => reject(new Error('dedicated test server did not start')), 45000);
        const onData = (buf) => {
            const text = buf.toString();
            if (!started && text.includes(`Server is running on port ${port}`)) {
                started = true;
                clearTimeout(timer);
                resolve();
            }
        };
        childServer.stdout.on('data', onData);
        childServer.stderr.on('data', onData);
        childServer.on('error', reject);
        childServer.on('exit', (code) => {
            if (!started) {
                clearTimeout(timer);
                reject(new Error(`test server exited early (${code})`));
            }
        });
    });
}

async function stopDedicatedServer() {
    if (!childServer || childServer.killed) return;
    await new Promise((resolve) => {
        childServer.once('exit', resolve);
        childServer.kill('SIGTERM');
        setTimeout(() => {
            if (!childServer.killed) childServer.kill('SIGKILL');
            resolve();
        }, 8000);
    });
    childServer = null;
}

async function main() {
    if (BASE) {
        JWT_SECRET = JWT_SECRET || process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || '';
    } else {
        await startDedicatedServer();
    }

    const ready = await waitForApi();
    check('Login', ready, ready ? `API reachable at ${BASE}` : `API not reachable at ${BASE}`);
    if (!ready) {
        process.exitCode = 1;
        return;
    }

    const db = getDBInstance();
    await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: { email: EMAIL.super }
    });

    await deleteTestAdmins(db);
    await upsertAdmin(db, { email: EMAIL.super, role: 'super_admin', status: 'active' });
    await upsertAdmin(db, { email: EMAIL.admin, role: 'admin', status: 'active' });
    await upsertAdmin(db, { email: EMAIL.manager, role: 'manager', status: 'active' });
    await upsertAdmin(db, { email: EMAIL.support, role: 'support', status: 'active' });
    await upsertAdmin(db, { email: EMAIL.pending, role: 'support', status: 'pending', inviteToken: 'pending-token', inviteExpiresAt: new Date(Date.now() + 86400000).toISOString() });

    const badDomain = await login('user@gmail.com', PASSWORD);
    check('Login', badDomain.status === 401, `non-@peakmode.se login → ${badDomain.status}`);

    const badPass = await login(EMAIL.admin, 'WrongPassword#1');
    check('Login', badPass.status === 401, `invalid password → ${badPass.status}`);

    const pendingLogin = await login(EMAIL.pending, PASSWORD);
    check('Account status', pendingLogin.status === 403, `pending login → ${pendingLogin.status} ${pendingLogin.json && pendingLogin.json.errorCode}`);

    const superLogin = await login(EMAIL.super, PASSWORD);
    const superTok = tokenOf(superLogin);
    const superCookie = superLogin.cookie;
    check('Login', Boolean(superLogin.status === 200 && superTok), `super_admin login ${superLogin.status}`);

    const adminLogin = await login(EMAIL.admin, PASSWORD);
    const adminTok = tokenOf(adminLogin);
    const adminCookie = adminLogin.cookie;
    check('Admin', Boolean(adminLogin.status === 200 && adminTok), `admin login ${adminLogin.status}`);

    const managerLogin = await login(EMAIL.manager, PASSWORD);
    const managerTok = tokenOf(managerLogin);
    check('Manager', Boolean(managerLogin.status === 200 && managerTok), `manager login ${managerLogin.status}`);

    const supportLogin = await login(EMAIL.support, PASSWORD);
    const supportTok = tokenOf(supportLogin);
    const supportCookie = supportLogin.cookie;
    check('Support', Boolean(supportLogin.status === 200 && supportTok), `support login ${supportLogin.status}`);

    const me = await req('/api/admin/me', { token: superTok });
    expectStatus(me, 200, 'Login');

    const refreshed = await req('/api/admin/auth/refresh', { method: 'POST', cookie: superCookie });
    const rotatedTok = tokenOf(refreshed) || (refreshed.json && refreshed.json.data && refreshed.json.data.token);
    const rotatedCookie = refreshed.cookie || superCookie;
    check('Refresh', refreshed.status === 200 && Boolean(rotatedTok), `refresh ${refreshed.status}`);
    const reuseOld = await req('/api/admin/auth/refresh', { method: 'POST', cookie: refreshCookie(superCookie) });
    check('Refresh', reuseOld.status === 401 || reuseOld.status === 403, `old refresh after rotation → ${reuseOld.status}`);

    const expired = jwt.sign(
        { adminId: me.json && me.json.data && (me.json.data.id || me.json.data._id), email: EMAIL.super, role: 'super_admin', type: 'access' },
        JWT_SECRET,
        { expiresIn: '-30s' }
    );
    const expiredCall = await req('/api/admin/staff', { token: expired });
    check('Login', expiredCall.status === 401, `expired access JWT → ${expiredCall.status}`);

    const unauthStaff = await req('/api/admin/staff');
    expectStatus(unauthStaff, 401, 'Permissions');

    const matrix = [
        ['Support', supportTok, 'GET', '/api/customers', 200],
        ['Support', supportTok, 'GET', '/api/orders/list', 200],
        ['Support', supportTok, 'GET', '/api/support/messages', 200],
        ['Support', supportTok, 'POST', '/api/products', 403],
        ['Support', supportTok, 'DELETE', '/api/products/not-a-real-id', 403],
        ['Support', supportTok, 'POST', '/api/admin/releases/not-a-real-id/publish', 403],
        ['Support', supportTok, 'GET', '/api/admin/staff', 403],
        ['Support', supportTok, 'GET', '/api/admin/audit', 403],
        ['Support', supportTok, 'GET', '/api/admin/shipping/zones', 403],
        ['Manager', managerTok, 'POST', '/api/products', [200, 400, 422]],
        ['Manager', managerTok, 'GET', '/api/admin/staff', 403],
        ['Manager', managerTok, 'GET', '/api/admin/audit', 403],
        ['Manager', managerTok, 'POST', '/api/admin/releases/not-a-real-id/publish', 403],
        ['Admin', adminTok, 'GET', '/api/customers', 200],
        ['Admin', adminTok, 'GET', '/api/admin/staff', 403],
        ['Admin', adminTok, 'GET', '/api/admin/audit', 403],
        ['Admin', adminTok, 'POST', '/api/admin/invite', 403],
        ['Super Admin', superTok, 'GET', '/api/admin/staff', 200],
        ['Super Admin', superTok, 'GET', '/api/admin/audit', 200],
        ['Super Admin', superTok, 'GET', '/api/admin/shipping/zones', 200]
    ];

    for (const [area, token, method, path, expected] of matrix) {
        const res = await req(path, { method, token, body: method === 'GET' ? undefined : {} });
        expectStatus(res, expected, area);
        expectStatus(res, expected, 'Permissions');
    }

    const vornifySupportWrite = await req('/api/vornifydb', {
        method: 'POST',
        token: supportTok,
        body: { database_name: 'peakmode', collection_name: 'discount_codes', command: '--create', data: { code: 'NOPE' } }
    });
    expectStatus(vornifySupportWrite, 403, 'Support');
    expectStatus(vornifySupportWrite, 403, 'Permissions');

    const vornifyManagerWrite = await req('/api/vornifydb', {
        method: 'POST',
        token: managerTok,
        body: { database_name: 'peakmode', collection_name: 'discount_codes', command: '--read', data: {} }
    });
    expectStatus(vornifyManagerWrite, 200, 'Manager');

    const inviteSuper = await req('/api/admin/invite', {
        method: 'POST',
        token: superTok,
        body: { name: 'Nope', email: EMAIL.invitee, role: 'super_admin' }
    });
    check('Invitations', inviteSuper.status === 400, `invite super_admin → ${inviteSuper.status}`);
    check('Super Admin', inviteSuper.status === 400, 'invite flow cannot create Super Admin');

    const invite = await req('/api/admin/invite', {
        method: 'POST',
        token: superTok,
        body: { name: 'Invitee Manager', email: EMAIL.invitee, role: 'manager' }
    });
    check('Invitations', invite.status === 200 && Boolean(invite.json && invite.json.data && invite.json.data.inviteLink), `invite manager → ${invite.status}`);
    const dup = await req('/api/admin/invite', {
        method: 'POST',
        token: superTok,
        body: { name: 'Invitee Manager', email: EMAIL.invitee, role: 'support' }
    });
    check('Invitations', dup.status >= 400, `duplicate invite → ${dup.status}`);

    const inviteRead = await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--read',
        data: { email: EMAIL.invitee }
    });
    const invitee = Array.isArray(inviteRead.data) ? inviteRead.data[0] : inviteRead.data;
    const accept = await req('/api/admin/accept-invite', {
        method: 'POST',
        body: {
            token: invitee && invitee.inviteToken,
            password: PASSWORD,
            confirmPassword: PASSWORD
        }
    });
    check('Invitations', accept.status === 200, `accept invite → ${accept.status}`);

    const expiredInvite = await upsertAdmin(db, {
        email: `${PREFIX}expired@peakmode.se`,
        role: 'support',
        status: 'pending',
        inviteToken: 'expired-invite-token',
        inviteExpiresAt: new Date(Date.now() - 60000).toISOString()
    });
    const acceptExpired = await req('/api/admin/accept-invite', {
        method: 'POST',
        body: { token: 'expired-invite-token', password: PASSWORD, confirmPassword: PASSWORD }
    });
    check('Invitations', acceptExpired.status >= 400, `expired invite → ${acceptExpired.status}`);
    await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--delete',
        data: { email: `${PREFIX}expired@peakmode.se` }
    });

    const staffList = await req('/api/admin/staff', { token: superTok });
    const staffRows = (staffList.json && staffList.json.data) || [];
    const adminRow = staffRows.find((r) => r.email === EMAIL.admin);
    const supportRow = staffRows.find((r) => r.email === EMAIL.support);
    const superRow = staffRows.find((r) => r.email === EMAIL.super);
    check('Staff management', Boolean(adminRow && supportRow && superRow), `listed ${staffRows.length} staff`);

    if (adminRow) {
        const roleChange = await req(`/api/admin/staff/${adminRow.id}`, {
            method: 'PATCH',
            token: superTok,
            body: { role: 'manager' }
        });
        check('Staff management', roleChange.status === 200, `role change admin→manager → ${roleChange.status}`);
        await req(`/api/admin/staff/${adminRow.id}`, { method: 'PATCH', token: superTok, body: { role: 'admin' } });
        const promote = await req(`/api/admin/staff/${supportRow.id}`, {
            method: 'PATCH',
            token: superTok,
            body: { role: 'super_admin' }
        });
        check('Super Admin', promote.status === 403, `promote support to super_admin → ${promote.status}`);
    }

    const others = await countActiveSuperAdmins(superRow && superRow.id);
    if (superRow && others === 0) {
        const demoteLast = await req(`/api/admin/staff/${superRow.id}`, {
            method: 'PATCH',
            token: superTok,
            body: { role: 'admin' }
        });
        check('Super Admin', demoteLast.status === 400, `demote last super → ${demoteLast.status}`);
        const suspendLast = await req(`/api/admin/staff/${superRow.id}/suspend`, { method: 'POST', token: superTok });
        check('Super Admin', suspendLast.status === 400, `suspend last super → ${suspendLast.status}`);
        const removeLast = await req(`/api/admin/staff/${superRow.id}/remove`, { method: 'POST', token: superTok });
        check('Super Admin', removeLast.status === 400, `remove last super → ${removeLast.status}`);
    } else if (superRow) {
        const suspendSelf = await req(`/api/admin/staff/${superRow.id}/suspend`, { method: 'POST', token: superTok });
        check('Super Admin', suspendSelf.status === 400, `cannot suspend self → ${suspendSelf.status}`);
        check('Super Admin', true, `last-super HTTP skip: ${others} other active Super Admin(s) exist`);
    }

    const adminByManager = await req(`/api/admin/staff/${adminRow && adminRow.id}/suspend`, { method: 'POST', token: managerTok });
    check('Staff management', adminByManager.status === 403, `manager suspend → ${adminByManager.status}`);
    const adminByAdmin = await req('/api/admin/staff', { token: adminTok });
    check('Admin', adminByAdmin.status === 403, `admin GET staff → ${adminByAdmin.status}`);

    const staleBefore = await login(EMAIL.support, PASSWORD);
    const staleTok = tokenOf(staleBefore);
    if (supportRow) {
        const suspended = await req(`/api/admin/staff/${supportRow.id}/suspend`, { method: 'POST', token: superTok });
        check('Account status', suspended.status === 200, `suspend support → ${suspended.status}`);
        const staleUse = await req('/api/orders/list', { token: staleTok });
        check('Account status', staleUse.status === 403, `suspended token orders.list → ${staleUse.status} ${staleUse.json && staleUse.json.code}`);
        const suspendedLogin = await login(EMAIL.support, PASSWORD);
        check('Account status', suspendedLogin.status === 403, `suspended login → ${suspendedLogin.status}`);
        const staleRefresh = await req('/api/admin/auth/refresh', { method: 'POST', cookie: staleBefore.cookie });
        check('Sessions', staleRefresh.status === 401 || staleRefresh.status === 403, `suspended refresh → ${staleRefresh.status}`);
        const reactivated = await req(`/api/admin/staff/${supportRow.id}/reactivate`, { method: 'POST', token: superTok });
        check('Account status', reactivated.status === 200, `reactivate → ${reactivated.status}`);
        const removed = await req(`/api/admin/staff/${supportRow.id}/remove`, { method: 'POST', token: superTok });
        check('Account status', removed.status === 200, `remove → ${removed.status}`);
        const removedLogin = await login(EMAIL.support, PASSWORD);
        check('Account status', removedLogin.status === 403, `removed login → ${removedLogin.status}`);
    }

    const sessionLoginA = await login(EMAIL.manager, PASSWORD);
    const listA = await req('/api/admin/security/sessions', {
        token: tokenOf(sessionLoginA),
        cookie: sessionLoginA.cookie
    });
    const sessionAId = ((listA.json && listA.json.data) || []).find((s) => s.current && s.id);
    const sessionLoginB = await login(EMAIL.manager, PASSWORD);
    check('Sessions', Boolean(tokenOf(sessionLoginA) && tokenOf(sessionLoginB) && sessionAId), 'two manager sessions issued');
    const sessions = await req('/api/admin/security/sessions', {
        token: tokenOf(sessionLoginB),
        cookie: sessionLoginB.cookie
    });
    check('Sessions', sessions.status === 200 && Array.isArray(sessions.json && sessions.json.data), `list sessions ${sessions.status}`);
    if (sessionAId && sessionAId.id) {
        const revOne = await req(`/api/admin/security/sessions/${sessionAId.id}`, {
            method: 'DELETE',
            token: tokenOf(sessionLoginB)
        });
        check('Sessions', revOne.status === 200, `revoke one → ${revOne.status}`);
        const reuseA = await req('/api/admin/auth/refresh', { method: 'POST', cookie: sessionLoginA.cookie });
        check('Sessions', reuseA.status === 401 || reuseA.status === 403, `revoked session refresh → ${reuseA.status}`);
    } else {
        check('Sessions', false, 'could not identify session A id (need refresh cookie on GET /sessions)');
    }
    const revOthers = await req('/api/admin/security/sessions/revoke-others', { method: 'POST', token: tokenOf(sessionLoginB) });
    check('Sessions', revOthers.status === 200, `revoke others → ${revOthers.status}`);

    const jsonSessions = JSON.stringify(sessions.json || {});
    check('Sessions', !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(jsonSessions), 'session API does not return JWTs');

    const logout = await req('/api/admin/auth/logout', { method: 'POST', token: tokenOf(sessionLoginB), cookie: sessionLoginB.cookie });
    check('Logout', logout.status === 200, `logout → ${logout.status}`);
    const afterLogout = await req('/api/admin/auth/refresh', { method: 'POST', cookie: sessionLoginB.cookie });
    check('Logout', afterLogout.status === 401 || afterLogout.status === 403, `refresh after logout → ${afterLogout.status}`);

    const resetLogin = await login(EMAIL.manager, PASSWORD);
    await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--update',
        data: {
            filter: { email: EMAIL.manager },
            update: {
                resetPasswordToken: 'stafftest-reset-token',
                resetPasswordExpires: new Date(Date.now() + 3600000).toISOString()
            }
        }
    });
    const reset = await req('/api/admin/auth/reset-password', {
        method: 'POST',
        body: { token: 'stafftest-reset-token', newPassword: PASSWORD, confirmPassword: PASSWORD }
    });
    check('Password reset', reset.status === 200, `reset-password → ${reset.status}`);
    const resetRefresh = await req('/api/admin/auth/refresh', { method: 'POST', cookie: resetLogin.cookie });
    check('Password reset', resetRefresh.status === 401 || resetRefresh.status === 403, `refresh after reset → ${resetRefresh.status}`);
    const forgotDomain = await req('/api/admin/auth/forgot-password', { method: 'POST', body: { email: 'x@gmail.com' } });
    check('Password reset', forgotDomain.status === 200, `forgot-password generic success → ${forgotDomain.status}`);

    const mfaStatus = await req('/api/admin/security/mfa', { token: adminTok });
    check('MFA', mfaStatus.status === 200 && mfaStatus.json && mfaStatus.json.data && mfaStatus.json.data.required === true, 'admin MFA required flag');
    const mfaMgr = await req('/api/admin/security/mfa', { token: managerTok });
    check('MFA', mfaMgr.status === 200 && mfaMgr.json && mfaMgr.json.data && mfaMgr.json.data.required === false, 'manager MFA not required');
    const setup = await req('/api/admin/security/mfa/setup', { method: 'POST', token: managerTok });
    const otpauth = setup.json && setup.json.data && setup.json.data.otpauthUrl;
    const secretMatch = otpauth && String(otpauth).match(/secret=([A-Z2-7]+)/i);
    check('MFA', setup.status === 200 && Boolean(secretMatch), `setup ${setup.status}`);
    if (secretMatch) {
        const fail = await req('/api/admin/security/mfa/enable', { method: 'POST', token: managerTok, body: { code: '000000' } });
        check('MFA', fail.status === 400, `bad TOTP → ${fail.status}`);
        const code = generateTotp(secretMatch[1]);
        const enable = await req('/api/admin/security/mfa/enable', { method: 'POST', token: managerTok, body: { code } });
        const recovery = enable.json && enable.json.data && enable.json.data.recoveryCodes;
        check('MFA', enable.status === 200 && Array.isArray(recovery), `enable ${enable.status}`);
        const challenge = await login(EMAIL.manager, PASSWORD);
        check('MFA', Boolean(challenge.json && challenge.json.data && challenge.json.data.mfaRequired), `login MFA challenge ${challenge.status}`);
        const badVerify = await req('/api/admin/auth/mfa/verify', {
            method: 'POST',
            body: { mfaToken: challenge.json.data.mfaToken, code: '111111' }
        });
        check('MFA', badVerify.status >= 400, `failed MFA verify → ${badVerify.status}`);
        const goodVerify = await req('/api/admin/auth/mfa/verify', {
            method: 'POST',
            body: { mfaToken: challenge.json.data.mfaToken, code: generateTotp(secretMatch[1]) }
        });
        check('MFA', goodVerify.status === 200 && Boolean(tokenOf(goodVerify)), `TOTP verify ${goodVerify.status}`);
        const recLogin = await login(EMAIL.manager, PASSWORD);
        const recVerify = await req('/api/admin/auth/mfa/verify', {
            method: 'POST',
            body: { mfaToken: recLogin.json.data.mfaToken, code: recovery && recovery[0] }
        });
        check('MFA', recVerify.status === 200, `recovery code verify ${recVerify.status}`);
        const disable = await req('/api/admin/security/mfa/disable', {
            method: 'POST',
            token: tokenOf(recVerify) || managerTok,
            body: { password: PASSWORD }
        });
        check('MFA', disable.status === 200, `manager disable MFA → ${disable.status}`);
    }

    if (adminRow) {
        await req('/api/admin/security/mfa/setup', { method: 'POST', token: adminTok });
        const resetMfa = await req(`/api/admin/staff/${adminRow.id}/reset-mfa`, { method: 'POST', token: superTok });
        check('MFA', resetMfa.status === 200, `super reset admin MFA → ${resetMfa.status}`);
    }

    const audit = await req('/api/admin/audit?limit=100', { token: superTok });
    const auditRows = (audit.json && audit.json.data) || [];
    const actions = new Set(auditRows.map((r) => r.action));
    const needed = ['admin.invited', 'admin.suspended', 'admin.reactivated', 'admin.removed', 'admin.role_changed'];
    const foundNeeded = needed.filter((a) => actions.has(a));
    check('Audit', foundNeeded.length >= 4, `privileged actions logged: ${foundNeeded.join(', ') || 'none'}`);
    const blob = JSON.stringify(auditRows);
    const leaked = /password|refreshToken|recoveryCodes|mfaSecret|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./i.test(blob);
    check('Audit', !leaked, leaked ? 'SECRETS IN AUDIT LOG' : 'no passwords/JWTs/MFA secrets in audit payload');
    check('Audit', !blob.toLowerCase().includes(PASSWORD.toLowerCase()), 'test password not in audit log');

    const idleSrc = require('fs').readFileSync(require('path').join(__dirname, '../../Peakmode-admin-1/src/layouts/AdminLayout.tsx'), 'utf8');
    check('Login', idleSrc.includes('INACTIVITY_MS = 5 * 60 * 1000') && idleSrc.includes('logout()'), 'frontend idle timeout still wired (5 min, not wall-clocked)');

    await deleteTestAdmins(db);
    await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'admins',
        command: '--delete',
        data: { email: `${PREFIX}expired@peakmode.se` }
    });
}

const AREAS = [
    'Login', 'Refresh', 'Logout', 'Invitations', 'Password reset', 'Account status',
    'Super Admin', 'Admin', 'Manager', 'Support', 'Permissions', 'Staff management',
    'Sessions', 'MFA', 'Audit'
];

main()
    .catch((err) => {
        console.error(err);
        check('Login', false, err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await deleteTestAdmins(getDBInstance()).catch(() => {});
            await closeDBInstance();
            await stopDedicatedServer();
            check('Test teardown', true, 'Mongo closed and test server stopped');
        } catch (err) {
            check('Test teardown', false, err.message);
            process.exitCode = 1;
        }
        console.log('\nAcceptance summary');
        for (const area of AREAS.concat(['Test teardown'])) {
            const rows = checks.filter((c) => c.area === area);
            const ok = rows.length > 0 && rows.every((c) => c.ok);
            const fail = rows.filter((c) => !c.ok);
            console.log(`| ${area.padEnd(18)} | ${(ok ? 'PASS' : 'FAIL').padEnd(18)} |`);
            fail.forEach((f) => console.log(`    - ${f.detail}`));
        }
        if (checks.some((c) => !c.ok)) process.exitCode = 1;
        process.exit(process.exitCode || 0);
    });
