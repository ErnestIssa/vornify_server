const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');

// Test email templates
router.get('/test/:template', async (req, res) => {
  try {
    const { template } = req.params;
    const testEmail = req.query.email || 'test@peakmode.co';
    
    // Sample order data for testing
    const testOrderData = {
      orderId: 'PM123456',
      customer: {
        name: 'Test Customer',
        email: testEmail,
        phone: '+46701234567'
      },
      items: [
        {
          productId: 'prod_test_001',
          name: 'Peak Mode Training Shorts',
          quantity: 1,
          price: 499,
          image: 'https://vornify-server.onrender.com/uploads/shorts.jpg',
          variant: {
            color: 'Black',
            size: 'M',
            variantId: 'variant_black_m'
          }
        }
      ],
      totals: {
        subtotal: 499,
        discount: 0,
        tax: 124.75,
        shipping: 0,
        total: 623.75
      },
      shippingAddress: {
        name: 'Test Customer',
        street: 'Testgatan 123',
        city: 'Stockholm',
        postalCode: '12345',
        country: 'Sweden',
        phone: '+46701234567'
      },
      billingAddress: {
        name: 'Test Customer',
        street: 'Testgatan 123',
        city: 'Stockholm',
        postalCode: '12345',
        country: 'Sweden'
      },
      paymentMethod: 'card',
      paymentStatus: 'paid',
      status: 'processing',
      shippingProvider: 'PostNord',
      trackingNumber: 'ABC123456789',
      trackingUrl: 'https://www.postnord.se/track?id=ABC123456789',
      estimatedDelivery: '2025-10-07',
      timeline: [
        {
          status: 'Order Placed',
          date: '2025-10-01T02:27:09.391Z',
          description: 'Order received and payment confirmed'
        }
      ],
      createdAt: '2025-10-01T02:27:09.391Z',
      updatedAt: '2025-10-01T02:27:09.391Z',
      orderDate: '2025-10-01T02:27:09.391Z'
    };

    let result;
    
    switch (template) {
      case 'confirmation':
        result = await emailService.sendOrderConfirmationEmail(
          testOrderData.customer.email,
          testOrderData.customer.name,
          testOrderData
        );
        break;
      case 'processing':
        result = await emailService.sendOrderProcessingEmail(
          testOrderData.customer.email,
          testOrderData
        );
        break;
      case 'shipping':
        result = await emailService.sendShippingNotificationEmail(
          testOrderData.customer.email,
          testOrderData
        );
        break;
      case 'delivery':
        result = await emailService.sendDeliveryConfirmationEmail(
          testOrderData.customer.email,
          testOrderData
        );
        break;
      case 'review':
        result = await emailService.sendReviewRequestEmail(
          testOrderData.customer.email,
          testOrderData
        );
        break;
      case 'newsletter-welcome':
        result = await emailService.sendNewsletterWelcomeEmail(
          testEmail,
          'Test User',
          'PEAK10-TEST123'
        );
        break;
      case 'discount-reminder':
        result = await emailService.sendDiscountReminderEmail(
          testEmail,
          'Test User',
          'PEAK10-TEST123'
        );
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid template. Use: confirmation, processing, shipping, delivery, review, newsletter-welcome, or discount-reminder'
        });
    }

    res.json({
      success: true,
      message: `${template} email test completed`,
      result: result
    });

  } catch (error) {
    console.error('Email test error:', error);
    res.status(500).json({
      success: false,
      error: 'Email test failed',
      details: error.message
    });
  }
});

// Test all email templates
router.get('/test-all', async (req, res) => {
  try {
    const testEmail = req.query.email || 'test@peakmode.co';
    
    const testOrderData = {
      orderId: 'PM123456',
      customer: {
        name: 'Test Customer',
        email: testEmail,
        phone: '+46701234567'
      },
      items: [
        {
          productId: 'prod_test_001',
          name: 'Peak Mode Training Shorts',
          quantity: 1,
          price: 499,
          image: 'https://vornify-server.onrender.com/uploads/shorts.jpg',
          variant: {
            color: 'Black',
            size: 'M',
            variantId: 'variant_black_m'
          }
        }
      ],
      totals: {
        subtotal: 499,
        discount: 0,
        tax: 124.75,
        shipping: 0,
        total: 623.75
      },
      shippingAddress: {
        name: 'Test Customer',
        street: 'Testgatan 123',
        city: 'Stockholm',
        postalCode: '12345',
        country: 'Sweden',
        phone: '+46701234567'
      },
      status: 'processing',
      shippingProvider: 'PostNord',
      trackingNumber: 'ABC123456789',
      trackingUrl: 'https://www.postnord.se/track?id=ABC123456789',
      createdAt: '2025-10-01T02:27:09.391Z',
      updatedAt: '2025-10-01T02:27:09.391Z',
      orderDate: '2025-10-01T02:27:09.391Z'
    };

    const results = {};
    
    // Test all templates
    results.confirmation = await emailService.sendOrderConfirmationEmail(
      testOrderData.customer.email,
      testOrderData.customer.name,
      testOrderData
    );
    results.processing = await emailService.sendOrderProcessingEmail(
      testOrderData.customer.email,
      testOrderData
    );
    results.shipping = await emailService.sendShippingNotificationEmail(
      testOrderData.customer.email,
      testOrderData
    );
    results.delivery = await emailService.sendDeliveryConfirmationEmail(
      testOrderData.customer.email,
      testOrderData
    );
    results.review = await emailService.sendReviewRequestEmail(
      testOrderData.customer.email,
      testOrderData
    );

    res.json({
      success: true,
      message: 'All email templates tested',
      results: results
    });

  } catch (error) {
    console.error('Email test error:', error);
    res.status(500).json({
      success: false,
      error: 'Email test failed',
      details: error.message
    });
  }
});

// Debug environment variables
router.get('/debug-env', (req, res) => {
    res.json({
        success: true,
        message: 'Environment variables debug',
        data: {
            SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? 'Present (length: ' + process.env.SENDGRID_API_KEY.length + ')' : 'Missing',
            NODE_ENV: process.env.NODE_ENV,
            hasApiKey: !!process.env.SENDGRID_API_KEY,
            apiKeyPrefix: process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY.substring(0, 10) + '...' : 'N/A'
        }
    });
});

module.exports = router;
