/**
 * Authorization for POST /api/vornifydb.
 * Shop catalog/cart/newsletter subscribe stay public.
 * Admin collections and mutating ops are deny-by-default.
 * Authenticated staff are checked against permissions, not role names.
 */

const { hasPermission } = require('./staffAccessPolicy');

const FORBIDDEN_COLLECTIONS = new Set([
    'admins',
    'admin_audit_logs',
    'admin_activity_logs',
    'admin_sessions',
    'refresh_tokens'
]);

const WRITE_COMMANDS = new Set([
    '--create',
    '--update',
    '--delete',
    '--createmany',
    '--updatemany',
    '--deletemany',
    '--append',
    '--update-field',
    '--delete-field',
    '--verify',
    '--unsubscribe'
]);

const COLLECTION_PERMISSIONS = {
    products: { view: 'products.view', create: 'products.create', update: 'products.edit', delete: 'products.delete' },
    orders: { view: 'orders.view', create: 'orders.edit', update: 'orders.edit', delete: 'orders.edit' },
    customers: { view: 'customers.view', create: 'customers.edit', update: 'customers.edit', delete: 'customers.edit' },
    reviews: { view: 'reviews.view', create: 'reviews.moderate', update: 'reviews.moderate', delete: 'reviews.moderate' },
    discount_codes: { view: 'discounts.view', create: 'discounts.create', update: 'discounts.edit', delete: 'discounts.delete' },
    discounts: { view: 'discounts.view', create: 'discounts.create', update: 'discounts.edit', delete: 'discounts.delete' },
    newsletter: { view: 'newsletter.view', create: 'newsletter.send', update: 'newsletter.send', delete: 'newsletter.send' },
    newsletter_subscribers: { view: 'newsletter.view', create: 'newsletter.send', update: 'newsletter.send', delete: 'newsletter.send' },
    campaigns: { view: 'newsletter.view', create: 'newsletter.send', update: 'newsletter.send', delete: 'newsletter.send' },
    media: { view: 'media.view', create: 'media.upload', update: 'media.upload', delete: 'media.delete' },
    contact_messages: { view: 'messages.view', create: 'messages.reply', update: 'messages.reply', delete: 'messages.reply' },
    shipping_rates: { view: 'shipping.view', create: 'shipping.edit', update: 'shipping.edit', delete: 'shipping.edit' },
    shipping_configs: { view: 'shipping.view', create: 'shipping.edit', update: 'shipping.edit', delete: 'shipping.edit' },
    settings: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    hubfeatures: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    communitystories: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    upcomingdrops: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    hubcontent: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    hub_stats: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    hubstats: { view: 'hub.view', create: 'hub.edit', update: 'hub.edit', delete: 'hub.edit' },
    admin_notifications: { view: 'notifications.view', create: 'notifications.view', update: 'notifications.view', delete: 'notifications.view' },
    order_tracking: { view: 'orders.view', create: 'orders.edit', update: 'orders.edit', delete: 'orders.edit' },
    tracking: { view: 'orders.view', create: 'orders.edit', update: 'orders.edit', delete: 'orders.edit' }
};

const PUBLIC_READ = new Set([
    'products',
    'reviews',
    'media',
    'hubfeatures',
    'communitystories',
    'upcomingdrops',
    'hubcontent',
    'hub_stats',
    'hubstats',
    'settings',
    'shipping_rates',
    'shipping_configs',
    'users',
    'newsletter',
    'newsletter_subscribers',
    'carts'
]);

const PUBLIC_WRITE = {
    newsletter: ['--create', '--update', '--unsubscribe'],
    newsletter_subscribers: ['--create', '--update'],
    contact_messages: ['--create'],
    carts: ['--create', '--update', '--delete'],
    reviews: ['--create'],
    orders: ['--create']
};

function normalizeCommand(command) {
    const raw = String(command || '').toLowerCase().trim();
    if (!raw) return '';
    return raw.startsWith('--') ? raw : `--${raw}`;
}

function isWriteCommand(command) {
    return WRITE_COMMANDS.has(normalizeCommand(command));
}

function writeKind(command) {
    const cmd = normalizeCommand(command);
    if (cmd === '--create' || cmd === '--createmany') return 'create';
    if (cmd === '--delete' || cmd === '--deletemany') return 'delete';
    return 'update';
}

function requiredPermission(collection, command) {
    const spec = COLLECTION_PERMISSIONS[collection];
    if (!spec) {
        return isWriteCommand(command) ? 'security.manage' : null;
    }
    if (!isWriteCommand(command)) return spec.view;
    return spec[writeKind(command)] || spec.update;
}

function hasIdentifyingOrderFilter(data) {
    if (!data || typeof data !== 'object') return false;
    const keys = ['email', 'customeremail', 'orderid', 'id', '_id', 'userid'];
    const visit = (obj, depth) => {
        if (!obj || typeof obj !== 'object' || depth > 4) return false;
        for (const [key, value] of Object.entries(obj)) {
            if (keys.includes(String(key).toLowerCase()) && value != null && String(value).trim() !== '') {
                return true;
            }
            if (key === '$or' || key === '$and') {
                const list = Array.isArray(value) ? value : [];
                if (list.some((item) => visit(item, depth + 1))) return true;
            } else if (value && typeof value === 'object' && visit(value, depth + 1)) {
                return true;
            }
        }
        return false;
    };
    return visit(data, 0);
}

function deny(status, code, message, extra) {
    return { ok: false, status, code, message, ...extra };
}

/**
 * @param {{ collection: string, command: string, data?: object, admin?: { permissions?: string[] } | null }} input
 */
function authorizeVornifyDb(input) {
    const collection = String(input.collection || '').toLowerCase().trim();
    const command = normalizeCommand(input.command);
    const admin = input.admin || null;
    const data = input.data;

    if (!collection || !command) {
        return deny(400, 'INVALID_OPERATION', 'collection and command are required');
    }

    if (FORBIDDEN_COLLECTIONS.has(collection)) {
        return deny(403, 'COLLECTION_FORBIDDEN', 'This collection cannot be accessed through the generic database API');
    }

    const write = isWriteCommand(command);
    const permission = requiredPermission(collection, command);

    if (admin) {
        if (permission && !hasPermission(admin.permissions, permission)) {
            return deny(403, 'INSUFFICIENT_PERMISSIONS', 'You do not have permission to perform this action', {
                required: permission
            });
        }
        return { ok: true };
    }

    if (write) {
        const allowed = PUBLIC_WRITE[collection];
        if (allowed && allowed.includes(command)) return { ok: true };
        return deny(401, 'NO_AUTH', 'Authentication required');
    }

    if (PUBLIC_READ.has(collection)) return { ok: true };
    if (collection === 'orders' && hasIdentifyingOrderFilter(data)) return { ok: true };
    return deny(401, 'NO_AUTH', 'Authentication required');
}

function vornifydbAccessMiddleware(req, res, next) {
    const collection = req.body?.collection_name || req.body?.collection;
    const command = req.body?.command;
    const data = req.body?.data || req.body?.filter || {};
    const decision = authorizeVornifyDb({
        collection,
        command,
        data,
        admin: req.admin || null
    });
    if (decision.ok) return next();
    return res.status(decision.status).json({
        success: false,
        error: decision.message,
        code: decision.code,
        required: decision.required
    });
}

module.exports = {
    authorizeVornifyDb,
    vornifydbAccessMiddleware,
    FORBIDDEN_COLLECTIONS,
    isWriteCommand,
    requiredPermission
};
