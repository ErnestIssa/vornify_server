require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const assert = require('assert');
const {
    getPermissionsForRole,
    hasPermission,
    isAllowedStaffEmail,
    isInvitableRole,
    normalizeRole,
    mfaRequiredForRole
} = require('../services/staffAccessPolicy');
const { resolveAccountStatus, canAuthenticate } = require('../services/adminAccountState');
const { authorizeVornifyDb } = require('../services/vornifydbAccess');
const { closeDBInstance } = require('../vornifydb/dbInstance');

assert.ok(getPermissionsForRole('super_admin').includes('staff.remove'));
assert.ok(!getPermissionsForRole('admin').includes('staff.invite'));
assert.ok(!getPermissionsForRole('manager').includes('releases.publish'));
assert.ok(getPermissionsForRole('support').includes('messages.reply'));
assert.ok(getPermissionsForRole('support').includes('tasks.view'));
assert.ok(getPermissionsForRole('support').includes('tasks.complete'));
assert.ok(!getPermissionsForRole('support').includes('tasks.create'));
assert.ok(getPermissionsForRole('manager').includes('tasks.assign'));
assert.ok(!getPermissionsForRole('manager').includes('tasks.manage'));
assert.ok(getPermissionsForRole('admin').includes('tasks.manage'));
assert.ok(!getPermissionsForRole('support').includes('products.edit'));
assert.strictEqual(hasPermission('support', 'orders.view'), true);
assert.strictEqual(hasPermission('support', 'orders.edit'), false);
assert.strictEqual(isInvitableRole('super_admin'), false);
assert.strictEqual(isInvitableRole('manager'), true);
assert.strictEqual(normalizeRole('nope'), 'admin');
assert.strictEqual(mfaRequiredForRole('super_admin'), true);
assert.strictEqual(mfaRequiredForRole('support'), false);
assert.strictEqual(isAllowedStaffEmail('jane@peakmode.se'), true);
assert.strictEqual(isAllowedStaffEmail('jane@gmail.com'), false);

assert.strictEqual(resolveAccountStatus({ status: 'suspended' }), 'suspended');
assert.strictEqual(resolveAccountStatus({ active: false }), 'suspended');
assert.strictEqual(resolveAccountStatus({ status: 'pending' }), 'pending');
assert.strictEqual(canAuthenticate({ status: 'active' }), true);
assert.strictEqual(canAuthenticate({ status: 'suspended' }), false);
assert.strictEqual(canAuthenticate({ status: 'active', active: false }), false);

const support = { permissions: getPermissionsForRole('support') };
const manager = { permissions: getPermissionsForRole('manager') };
assert.strictEqual(authorizeVornifyDb({ collection: 'admins', command: '--read', admin: manager }).ok, false);
assert.strictEqual(authorizeVornifyDb({ collection: 'discount_codes', command: '--create', admin: support }).ok, false);
assert.strictEqual(authorizeVornifyDb({ collection: 'discount_codes', command: '--create', admin: manager }).ok, true);
assert.strictEqual(authorizeVornifyDb({ collection: 'products', command: '--read' }).ok, true);
assert.strictEqual(authorizeVornifyDb({ collection: 'customers', command: '--read' }).ok, false);
assert.strictEqual(authorizeVornifyDb({ collection: 'orders', command: '--read' }).ok, false);
assert.strictEqual(authorizeVornifyDb({
    collection: 'orders',
    command: '--read',
    data: { email: 'buyer@example.com' }
}).ok, true);
assert.strictEqual(authorizeVornifyDb({ collection: 'newsletter_subscribers', command: '--create' }).ok, true);
assert.strictEqual(authorizeVornifyDb({ collection: 'products', command: '--create' }).ok, false);
assert.strictEqual(authorizeVornifyDb({ collection: 'products', command: '--read', admin: support }).ok, false);
assert.strictEqual(authorizeVornifyDb({ collection: 'orders', command: '--read', admin: support }).ok, true);

console.log('staffAccessPolicy tests passed');

closeDBInstance()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
