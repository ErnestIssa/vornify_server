/**
 * Cart sync payloads: when persisted appliedDiscount fails live validation upstream.
 * See routes/cart POST /:userId — merged into cart.cartAdjustments.
 */
const DISCOUNT_ADJUSTMENT_REMOVED = 'discount_removed';

module.exports = {
    DISCOUNT_ADJUSTMENT_REMOVED
};
