/**
 * Order Status State Machine
 * 
 * Enforces forward-only status progression with validation
 * Prevents timeline bugs, random admin updates, and broken animations
 */

/** Canonical API status values (single source of truth for admin & client) */
const CANONICAL_STATUSES = [
    'pending', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'cancelled'
];

/**
 * Valid status transitions
 * Each status can only transition to the next status in sequence, or to cancelled
 */
const VALID_TRANSITIONS = {
    pending: ['processing', 'cancelled'],
    processing: ['packed', 'cancelled'],
    packed: ['shipped', 'cancelled'],
    shipped: ['in_transit', 'cancelled'],
    in_transit: ['out_for_delivery', 'cancelled'],
    out_for_delivery: ['delivered', 'cancelled'],
    delivered: [], // Final state, no transitions allowed
    cancelled: [] // Final state, no transitions allowed
};

/**
 * Status order for timeline mapping
 * Maps status to timeline step index (0-6)
 */
const STATUS_ORDER = {
    pending: 0,
    processing: 1,
    packed: 2,
    shipped: 3,
    in_transit: 4,
    out_for_delivery: 5,
    delivered: 6
};

/**
 * Human-readable status text (aligned with admin & client "Track my order" labels)
 * API value → Display label
 */
const STATUS_TEXT = {
    pending: 'Paid',
    processing: 'Processing',
    packed: 'Packed',
    shipped: 'Shipped',
    in_transit: 'In Transit',
    out_for_delivery: 'Out for Delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled'
};

/**
 * Check if a status transition is valid
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Desired new status
 * @returns {boolean} - True if transition is valid
 */
function canTransition(fromStatus, toStatus) {
    if (!fromStatus || !toStatus) {
        return false;
    }

    const normalizedFrom = String(fromStatus).toLowerCase().trim();
    const normalizedTo = String(toStatus).toLowerCase().trim();

    // Same status is not a transition
    if (normalizedFrom === normalizedTo) {
        return false;
    }

    // Check if transition is in valid transitions list
    const allowedTransitions = VALID_TRANSITIONS[normalizedFrom];
    if (!allowedTransitions) {
        return false;
    }

    return allowedTransitions.includes(normalizedTo);
}

/**
 * Validate status transition and return error if invalid
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Desired new status
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
function validateTransition(fromStatus, toStatus) {
    if (!fromStatus) {
        return {
            valid: false,
            error: 'Current status is required'
        };
    }

    if (!toStatus) {
        return {
            valid: false,
            error: 'New status is required'
        };
    }

    const normalizedFrom = String(fromStatus).toLowerCase().trim();
    const normalizedTo = String(toStatus).toLowerCase().trim();

    // Check if statuses are valid
    if (!VALID_TRANSITIONS.hasOwnProperty(normalizedFrom)) {
        return {
            valid: false,
            error: `Invalid current status: ${normalizedFrom}`
        };
    }

    if (!STATUS_TEXT.hasOwnProperty(normalizedTo) && normalizedTo !== 'cancelled') {
        return {
            valid: false,
            error: `Invalid target status: ${normalizedTo}`
        };
    }

    // Check if transition is allowed
    if (!canTransition(normalizedFrom, normalizedTo)) {
        const allowed = VALID_TRANSITIONS[normalizedFrom];
        return {
            valid: false,
            error: `Cannot transition from "${normalizedFrom}" to "${normalizedTo}". Allowed transitions: ${allowed.join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * Get timeline step index for a status
 * @param {string} status - Order status
 * @returns {number|null} - Timeline step index (0-6) or null if invalid
 */
function getStatusStepIndex(status) {
    if (!status) return null;
    const normalized = String(status).toLowerCase().trim();
    return STATUS_ORDER.hasOwnProperty(normalized) ? STATUS_ORDER[normalized] : null;
}

/**
 * Get human-readable status text
 * @param {string} status - Order status
 * @returns {string} - Human-readable status text
 */
function getStatusText(status) {
    if (!status) return 'Unknown';
    const normalized = String(status).toLowerCase().trim();
    return STATUS_TEXT[normalized] || normalized;
}

/**
 * Create status history entry
 * @param {string} status - New status
 * @param {string} changedBy - Who/what made the change (system, admin ID, etc.)
 * @returns {object} - Status history entry
 */
function createStatusHistoryEntry(status, changedBy = 'system') {
    return {
        status: String(status).toLowerCase().trim(),
        timestamp: new Date().toISOString(),
        changedBy: String(changedBy)
    };
}

/**
 * Update status timestamps object
 * @param {object} currentTimestamps - Current statusTimestamps object
 * @param {string} newStatus - New status
 * @returns {object} - Updated statusTimestamps object
 */
function updateStatusTimestamps(currentTimestamps = {}, newStatus) {
    const normalizedStatus = String(newStatus).toLowerCase().trim();
    const timestamp = new Date().toISOString();

    return {
        ...currentTimestamps,
        [normalizedStatus]: timestamp
    };
}

/**
 * Determine which timeline steps are completed based on status timestamps
 * @param {string} currentStatus - Current order status
 * @param {object} statusTimestamps - Status timestamps object
 * @returns {object} - Object with completed, current, and future step indices
 */
function getTimelineStepStates(currentStatus, statusTimestamps = {}) {
    const currentStepIndex = getStatusStepIndex(currentStatus);
    
    if (currentStepIndex === null) {
        return {
            completed: [],
            current: null,
            future: []
        };
    }

    const completed = [];
    const future = [];

    // Check each status in order
    Object.keys(STATUS_ORDER).forEach(status => {
        const stepIndex = STATUS_ORDER[status];
        const hasTimestamp = statusTimestamps[status] !== undefined;

        if (stepIndex <= currentStepIndex || hasTimestamp) {
            completed.push(stepIndex);
        } else {
            future.push(stepIndex);
        }
    });

    return {
        completed: completed.sort((a, b) => a - b),
        current: currentStepIndex,
        future: future.sort((a, b) => a - b)
    };
}

/**
 * Check if order is in a final state (cannot be updated)
 * @param {string} status - Order status
 * @returns {boolean} - True if order is in final state
 */
function isFinalState(status) {
    if (!status) return false;
    const normalized = String(status).toLowerCase().trim();
    return normalized === 'delivered' || normalized === 'cancelled';
}

/**
 * Check if order is cancelled
 * @param {string} status - Order status
 * @returns {boolean} - True if order is cancelled
 */
function isCancelled(status) {
    if (!status) return false;
    return String(status).toLowerCase().trim() === 'cancelled';
}

module.exports = {
    CANONICAL_STATUSES,
    VALID_TRANSITIONS,
    STATUS_ORDER,
    STATUS_TEXT,
    canTransition,
    validateTransition,
    getStatusStepIndex,
    getStatusText,
    createStatusHistoryEntry,
    updateStatusTimestamps,
    getTimelineStepStates,
    isFinalState,
    isCancelled
};

