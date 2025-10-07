const express = require('express');
const router = express.Router();
const { 
  sendOrderConfirmation, 
  sendOrderProcessing, 
  sendShippingNotification, 
  sendDeliveryConfirmation, 
  sendReviewRequest,
  sendNewsletterWelcome,
  sendDiscountReminder
} = require('../utils/sendEmail');

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
        result = await sendOrderConfirmation(testOrderData);
        break;
      case 'processing':
        result = await sendOrderProcessing(testOrderData);
        break;
      case 'shipping':
        result = await sendShippingNotification(testOrderData);
        break;
      case 'delivery':
        result = await sendDeliveryConfirmation(testOrderData);
        break;
      case 'review':
        result = await sendReviewRequest(testOrderData);
        break;
      case 'newsletter-welcome':
        const subscriberData = {
          email: testEmail,
          name: 'Test User',
          discountCode: 'PEAK10-TEST123'
        };
        result = await sendNewsletterWelcome(subscriberData);
        break;
      case 'discount-reminder':
        const reminderData = {
          email: testEmail,
          name: 'Test User',
          discountCode: 'PEAK10-TEST123'
        };
        result = await sendDiscountReminder(reminderData);
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
    results.confirmation = await sendOrderConfirmation(testOrderData);
    results.processing = await sendOrderProcessing(testOrderData);
    results.shipping = await sendShippingNotification(testOrderData);
    results.delivery = await sendDeliveryConfirmation(testOrderData);
    results.review = await sendReviewRequest(testOrderData);

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

module.exports = router;
