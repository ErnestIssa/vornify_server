/**
 * Staff access policy — single source of truth for admin authorization.
 * Roles grant permissions. API checks permissions, not role names.
 */

const STAFF_EMAIL_DOMAIN = String(process.env.ADMIN_EMAIL_DOMAIN || 'peakmode.se')
    .toLowerCase()
    .replace(/^@/, '')
    .trim();

const STAFF_ROLES = Object.freeze(['super_admin', 'admin', 'manager', 'support']);
const INVITABLE_ROLES = Object.freeze(['admin', 'manager', 'support']);

const ACCOUNT_STATUSES = Object.freeze(['pending', 'active', 'suspended', 'removed']);

const PERMISSIONS = Object.freeze([
    'dashboard.view',
    'products.view',
    'products.create',
    'products.edit',
    'products.delete',
    'orders.view',
    'orders.edit',
    'orders.cancel',
    'orders.refund',
    'customers.view',
    'customers.edit',
    'reviews.view',
    'reviews.moderate',
    'discounts.view',
    'discounts.create',
    'discounts.edit',
    'discounts.delete',
    'newsletter.view',
    'newsletter.send',
    'media.view',
    'media.upload',
    'media.delete',
    'messages.view',
    'messages.reply',
    'shipping.view',
    'shipping.edit',
    'email.view',
    'email.manage',
    'hub.view',
    'hub.edit',
    'releases.view',
    'releases.create',
    'releases.edit',
    'releases.publish',
    'releases.archive',
    'staff.view',
    'staff.invite',
    'staff.edit',
    'staff.suspend',
    'staff.remove',
    'security.view',
    'security.manage',
    'audit.view',
    'notifications.view',
    'tasks.view',
    'tasks.create',
    'tasks.edit',
    'tasks.assign',
    'tasks.complete',
    'tasks.delete',
    'tasks.manage'
]);

const ALL_PERMISSIONS = PERMISSIONS;

const ROLE_PERMISSIONS = Object.freeze({
    super_admin: ALL_PERMISSIONS,

    admin: PERMISSIONS.filter((p) =>
        !p.startsWith('staff.') &&
        p !== 'security.manage' &&
        p !== 'audit.view'
    ),

    manager: Object.freeze([
        'dashboard.view',
        'products.view',
        'products.create',
        'products.edit',
        'products.delete',
        'orders.view',
        'orders.edit',
        'orders.cancel',
        'customers.view',
        'customers.edit',
        'reviews.view',
        'reviews.moderate',
        'discounts.view',
        'discounts.create',
        'discounts.edit',
        'discounts.delete',
        'newsletter.view',
        'newsletter.send',
        'media.view',
        'media.upload',
        'media.delete',
        'messages.view',
        'messages.reply',
        'shipping.view',
        'shipping.edit',
        'hub.view',
        'hub.edit',
        'releases.view',
        'notifications.view',
        'security.view',
        'tasks.view',
        'tasks.create',
        'tasks.edit',
        'tasks.assign',
        'tasks.complete',
        'tasks.delete'
    ]),

    support: Object.freeze([
        'dashboard.view',
        'customers.view',
        'orders.view',
        'messages.view',
        'messages.reply',
        'reviews.view',
        'releases.view',
        'notifications.view',
        'security.view',
        'tasks.view',
        'tasks.complete'
    ])
});

function getStaffEmailDomain() {
    return STAFF_EMAIL_DOMAIN;
}

function isAllowedStaffEmail(email) {
    const normalized = String(email || '').toLowerCase().trim();
    if (!normalized || !normalized.includes('@')) return false;
    return normalized.endsWith(`@${STAFF_EMAIL_DOMAIN}`);
}

function normalizeRole(role) {
    const value = String(role || '').toLowerCase().trim();
    if (STAFF_ROLES.includes(value)) return value;
    return 'admin';
}

function isStaffRole(role) {
    return STAFF_ROLES.includes(String(role || '').toLowerCase().trim());
}

function isInvitableRole(role) {
    return INVITABLE_ROLES.includes(String(role || '').toLowerCase().trim());
}

function getPermissionsForRole(role) {
    const normalized = normalizeRole(role);
    return [...(ROLE_PERMISSIONS[normalized] || [])];
}

function hasPermission(roleOrPermissions, permission) {
    if (!permission) return false;
    const list = Array.isArray(roleOrPermissions)
        ? roleOrPermissions
        : getPermissionsForRole(roleOrPermissions);
    return list.includes(permission);
}

function mfaRequiredForRole(role) {
    const normalized = normalizeRole(role);
    return normalized === 'super_admin' || normalized === 'admin';
}

function getRoleCatalog() {
    return STAFF_ROLES.map((role) => ({
        role,
        permissions: getPermissionsForRole(role),
        mfaRequired: mfaRequiredForRole(role),
        invitable: isInvitableRole(role)
    }));
}

module.exports = {
    STAFF_EMAIL_DOMAIN,
    STAFF_ROLES,
    INVITABLE_ROLES,
    ACCOUNT_STATUSES,
    PERMISSIONS,
    ROLE_PERMISSIONS,
    getStaffEmailDomain,
    isAllowedStaffEmail,
    normalizeRole,
    isStaffRole,
    isInvitableRole,
    getPermissionsForRole,
    hasPermission,
    mfaRequiredForRole,
    getRoleCatalog
};
