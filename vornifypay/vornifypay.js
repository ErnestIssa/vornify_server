const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Decimal } = require('decimal.js');

class VornifyPay {
    constructor() {
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLIC_KEY) {
            throw new Error('Missing required Stripe configuration');
        }
        this.stripe = stripe;
        this.publicKey = process.env.STRIPE_PUBLIC_KEY;
    }

    validatePaymentData(data) {
        const required = ['amount', 'currency', 'payment_type', 'product_data'];
        const missing = required.filter(field => !data[field]);
        
        if (missing.length > 0) {
            return { 
                isValid: false, 
                error: `Missing required fields: ${missing.join(', ')}` 
            };
        }

        if (!['onetime', 'recurring'].includes(data.payment_type)) {
            return { 
                isValid: false, 
                error: 'Invalid payment_type. Must be either "onetime" or "recurring"' 
            };
        }

        return { isValid: true };
    }

    validateSubscriptionData(data) {
        const required = ['customer_email', 'price_id', 'product_data'];
        const missing = required.filter(field => !data[field]);
        
        if (missing.length > 0) {
            return { 
                isValid: false, 
                error: `Missing required fields: ${missing.join(', ')}` 
            };
        }

        return { isValid: true };
    }

    async processPayment(requestData) {
        try {
            console.log('Processing payment request:', requestData);

            const { command, data = {} } = requestData;

            switch (command) {
                case 'payment':
                    const paymentValidation = this.validatePaymentData(data);
                    if (!paymentValidation.isValid) {
                        return { status: false, error: paymentValidation.error };
                    }
                    return await this.handlePayment(data);

                case 'subscription':
                    const subscriptionValidation = this.validateSubscriptionData(data);
                    if (!subscriptionValidation.isValid) {
                        return { status: false, error: subscriptionValidation.error };
                    }
                    return await this.handleSubscription(data);

                case 'verify':
                    if (!data.payment_intent_id) {
                        return { status: false, error: 'payment_intent_id is required' };
                    }
                    return await this.verifyPayment(data);

                case 'create_subscription':
                    return await this.createSubscription(data);
                case 'complete_subscription':
                    return await this.completeSubscription(data);

                default:
                    return { status: false, error: 'Invalid command' };
            }
        } catch (error) {
            console.error('Payment processing error:', error);
            return { 
                status: false, 
                error: error.message,
                code: error.code || 'unknown_error'
            };
        }
    }

    async handlePayment(data) {
        const { amount, currency, payment_type, product_data } = data;
        
        try {
            const amountInCents = Math.round(new Decimal(amount).times(100).toNumber());

            const metadata = this.prepareMetadata({
                payment_type,
                ...product_data
            });

            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: amountInCents,
                currency: currency.toLowerCase(),
                automatic_payment_methods: { enabled: true },
                metadata,
                description: product_data.description || `Payment for ${product_data.name}`
            });

            return {
                status: true,
                payment_intent_id: paymentIntent.id,
                client_secret: paymentIntent.client_secret,
                public_key: this.publicKey,
                amount,
                currency,
                payment_type,
                product_details: product_data
            };
        } catch (error) {
            console.error('Payment creation error:', error);
            return { status: false, error: error.message };
        }
    }

    async handleSubscription(data) {
        try {
            const { 
                customer_email, 
                price_id, 
                trial_days = 0,
                product_data 
            } = data;

            // Validate price_id format
            if (!price_id.startsWith('price_')) {
                return {
                    status: false,
                    error: 'Invalid price_id format. Must start with "price_"'
                };
            }

            try {
                // Verify the price exists
                await this.stripe.prices.retrieve(price_id);
            } catch (error) {
                return {
                    status: false,
                    error: 'Invalid price_id. Price does not exist.',
                    details: error.message
                };
            }

            // Create or get customer
            let customer;
            try {
                customer = await this.getOrCreateCustomer(customer_email, product_data);
            } catch (error) {
                return {
                    status: false,
                    error: 'Failed to create/retrieve customer',
                    details: error.message
                };
            }

            // Prepare subscription metadata
            const metadata = this.prepareMetadata({
                ...product_data,
                customer_email,
                subscription_type: 'recurring'
            });

            // Create subscription
            const subscription = await this.stripe.subscriptions.create({
                customer: customer.id,
                items: [{ price: price_id }],
                trial_period_days: trial_days,
                payment_behavior: 'default_incomplete',
                payment_settings: { 
                    save_default_payment_method: 'on_subscription',
                    payment_method_types: ['card']
                },
                metadata,
                expand: ['latest_invoice.payment_intent']
            });

            return {
                status: true,
                subscription_id: subscription.id,
                client_secret: subscription.latest_invoice.payment_intent.client_secret,
                public_key: this.publicKey,
                customer_id: customer.id,
                trial_end: subscription.trial_end,
                current_period_end: subscription.current_period_end,
                product_details: product_data
            };
        } catch (error) {
            console.error('Subscription creation error:', error);
            return {
                status: false,
                error: error.message,
                code: error.code || 'subscription_creation_failed'
            };
        }
    }

    async handleRefund(data) {
        try {
            const { payment_intent_id, amount } = data;
            const refundData = { payment_intent: payment_intent_id };

            if (amount) {
                refundData.amount = this.convertAmount(amount);
            }

            const refund = await this.stripe.refunds.create(refundData);

            return {
                status: true,
                refund_id: refund.id,
                amount: this.convertFromSmallestUnit(refund.amount),
                currency: refund.currency
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async verifyPayment(data) {
        try {
            const { payment_intent_id } = data;
            const paymentIntent = await this.stripe.paymentIntents.retrieve(payment_intent_id);

            return {
                status: true,
                payment_status: paymentIntent.status,
                amount: this.convertFromSmallestUnit(paymentIntent.amount),
                currency: paymentIntent.currency,
                metadata: paymentIntent.metadata
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async createSubscription(data) {
        try {
            const {
                customer_email,
                amount,
                currency,
                trial_days = 0,
                billing_interval = 'month',
                product_data
            } = data;

            // Create or get customer
            const customer = await this.getOrCreateCustomer(customer_email, {
                name: product_data.customer_name || '',
                metadata: this.prepareMetadata(product_data)
            });

            // Create product if it doesn't exist
            const product = await this.stripe.products.create({
                name: product_data.name,
                description: product_data.description,
                metadata: this.prepareMetadata({
                    features: JSON.stringify(product_data.features),
                    ...product_data.metadata
                })
            });

            // Create price
            const price = await this.stripe.prices.create({
                product: product.id,
                unit_amount: this.convertAmount(amount),
                currency: currency.toLowerCase(),
                recurring: {
                    interval: billing_interval,
                    interval_count: 1
                },
                metadata: {
                    product_name: product_data.name
                }
            });

            // Calculate trial end
            const trial_end = trial_days > 0 
                ? Math.floor(Date.now() / 1000) + (trial_days * 24 * 60 * 60)
                : undefined;

            // Create subscription
            const subscription = await this.stripe.subscriptions.create({
                customer: customer.id,
                items: [{ price: price.id }],
                trial_end,
                payment_behavior: 'default_incomplete',
                payment_settings: { 
                    payment_method_types: ['card'],
                    save_default_payment_method: 'on_subscription' 
                },
                metadata: this.prepareMetadata({
                    ...product_data,
                    subscription_type: 'recurring'
                }),
                expand: ['latest_invoice.payment_intent']
            });

            return {
                status: true,
                subscription_id: subscription.id,
                client_secret: subscription.latest_invoice.payment_intent.client_secret,
                public_key: this.publicKey,
                subscription_details: {
                    amount,
                    currency,
                    trial_end: trial_end ? new Date(trial_end * 1000).toISOString() : null,
                    billing_interval,
                    product_name: product_data.name,
                    customer_email,
                    status: subscription.status
                }
            };
        } catch (error) {
            console.error('Subscription creation error:', error);
            return {
                status: false,
                error: error.message,
                code: error.code || 'subscription_creation_failed'
            };
        }
    }

    async completeSubscription(data) {
        try {
            const { subscription_id, payment_method } = data;

            const subscription = await this.stripe.subscriptions.retrieve(subscription_id);
            
            if (!subscription) {
                return {
                    status: false,
                    error: 'Subscription not found'
                };
            }

            // Update subscription with payment method
            const updatedSubscription = await this.stripe.subscriptions.update(
                subscription_id,
                {
                    default_payment_method: payment_method.id,
                    metadata: {
                        payment_method_added: 'true'
                    }
                }
            );

            return {
                status: true,
                subscription: {
                    id: updatedSubscription.id,
                    status: updatedSubscription.status,
                    current_period_end: new Date(updatedSubscription.current_period_end * 1000).toISOString(),
                    trial_end: updatedSubscription.trial_end 
                        ? new Date(updatedSubscription.trial_end * 1000).toISOString()
                        : null
                }
            };
        } catch (error) {
            console.error('Complete subscription error:', error);
            return {
                status: false,
                error: error.message,
                code: error.code || 'subscription_completion_failed'
            };
        }
    }

    // Utility methods
    convertAmount(amount) {
        return Math.round(new Decimal(amount).times(100).toNumber());
    }

    convertFromSmallestUnit(amount) {
        return new Decimal(amount).div(100).toNumber();
    }

    prepareMetadata(data) {
        return Object.entries(data).reduce((acc, [key, value]) => {
            const formattedKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            acc[formattedKey] = String(value);
            return acc;
        }, {});
    }

    async getOrCreateCustomer(email, metadata = {}) {
        const customers = await this.stripe.customers.list({
            email,
            limit: 1
        });

        if (customers.data.length > 0) {
            return customers.data[0];
        }

        return await this.stripe.customers.create({
            email,
            metadata: this.prepareMetadata(metadata)
        });
    }

    handleError(error) {
        if (error instanceof stripe.errors.StripeError) {
            return {
                status: false,
                error: error.message,
                code: error.code,
                type: error.type
            };
        }
        return {
            status: false,
            error: 'An unexpected error occurred',
            code: 'internal_error'
        };
    }
}

module.exports = VornifyPay; 