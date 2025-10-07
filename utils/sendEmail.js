const sgMail = require("@sendgrid/mail");
const EmailTemplates = require('./emailTemplates');
require('dotenv').config();

// Use your API key from .env file
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const emailTemplates = new EmailTemplates();

// Send email using SendGrid template
const sendEmail = async (to, templateId, dynamicData) => {
  const msg = {
    to, // recipient email
    from: "support@peakmode.se", // verified sender
    templateId, // SendGrid template ID
    dynamic_template_data: dynamicData, // dynamic info like customer name, order ID
  };

  try {
    await sgMail.send(msg);
    console.log("Email sent to:", to);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("SendGrid Error:", error);
    return { success: false, error: error.message };
  }
};

// Send email using custom HTML template
const sendCustomEmail = async (to, subject, htmlContent, textContent = null) => {
  const msg = {
    to,
    from: "support@peakmode.se",
    subject,
    html: htmlContent,
    text: textContent || emailTemplates.generatePlainText(htmlContent)
  };

  try {
    await sgMail.send(msg);
    console.log("Custom email sent to:", to);
    return { success: true, message: "Email sent successfully" };
  } catch (error) {
    console.error("SendGrid Error:", error);
    return { success: false, error: error.message };
  }
};

// Order confirmation email
const sendOrderConfirmation = async (orderData) => {
  const htmlContent = emailTemplates.generateOrderConfirmation(orderData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate order confirmation template" };
  }

  const subject = `🖤 Your Peak Mode Order is Confirmed! - ${orderData.orderId}`;
  return await sendCustomEmail(orderData.customer.email, subject, htmlContent);
};

// Order processing email
const sendOrderProcessing = async (orderData) => {
  const htmlContent = emailTemplates.generateOrderProcessing(orderData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate order processing template" };
  }

  const subject = `🖤 Your Peak Mode Order Is Now Being Processed - ${orderData.orderId}`;
  return await sendCustomEmail(orderData.customer.email, subject, htmlContent);
};

// Shipping notification email
const sendShippingNotification = async (orderData) => {
  const htmlContent = emailTemplates.generateShippingNotification(orderData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate shipping notification template" };
  }

  const subject = `🚚 Your Peak Mode Order Is on the Way! - ${orderData.orderId}`;
  return await sendCustomEmail(orderData.customer.email, subject, htmlContent);
};

// Delivery confirmation email
const sendDeliveryConfirmation = async (orderData) => {
  const htmlContent = emailTemplates.generateDeliveryConfirmation(orderData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate delivery confirmation template" };
  }

  const subject = `✅ Your Peak Mode Order Has Arrived! - ${orderData.orderId}`;
  return await sendCustomEmail(orderData.customer.email, subject, htmlContent);
};

// Review request email
const sendReviewRequest = async (orderData) => {
  const htmlContent = emailTemplates.generateReviewRequest(orderData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate review request template" };
  }

  const subject = `🖤 How Was Your Peak Mode Gear? - ${orderData.orderId}`;
  return await sendCustomEmail(orderData.customer.email, subject, htmlContent);
};

// Newsletter welcome email
const sendNewsletterWelcome = async (subscriberData) => {
  const htmlContent = emailTemplates.generateNewsletterWelcome(subscriberData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate newsletter welcome template" };
  }

  const subject = "🖤 Welcome to Peak Mode — Here's 10% OFF Your First Order";
  return await sendCustomEmail(subscriberData.email, subject, htmlContent);
};

// Admin notification email
const sendAdminNotification = async (orderData, notificationType) => {
  const adminEmail = process.env.ADMIN_EMAIL || "eliasnhunzwe@gmail.com";
  
  let subject, htmlContent;
  
  switch (notificationType) {
    case 'new_order':
      subject = `🆕 New Order Received - ${orderData.orderId}`;
      htmlContent = `
        <h2>New Order Received</h2>
        <p><strong>Order ID:</strong> ${orderData.orderId}</p>
        <p><strong>Customer:</strong> ${orderData.customer.name} (${orderData.customer.email})</p>
        <p><strong>Total:</strong> ${orderData.totals.total} SEK</p>
        <p><strong>Items:</strong> ${orderData.items.length} item(s)</p>
        <p><strong>Status:</strong> ${orderData.status}</p>
        <p><strong>Date:</strong> ${new Date(orderData.createdAt).toLocaleString()}</p>
      `;
      break;
    case 'status_update':
      subject = `📝 Order Status Updated - ${orderData.orderId}`;
      htmlContent = `
        <h2>Order Status Updated</h2>
        <p><strong>Order ID:</strong> ${orderData.orderId}</p>
        <p><strong>Customer:</strong> ${orderData.customer.name} (${orderData.customer.email})</p>
        <p><strong>New Status:</strong> ${orderData.status}</p>
        <p><strong>Updated:</strong> ${new Date(orderData.updatedAt).toLocaleString()}</p>
      `;
      break;
    default:
      return { success: false, error: "Invalid notification type" };
  }

  return await sendCustomEmail(adminEmail, subject, htmlContent);
};

// Discount reminder email
const sendDiscountReminder = async (subscriberData) => {
  const htmlContent = emailTemplates.generateDiscountReminder(subscriberData);
  if (!htmlContent) {
    return { success: false, error: "Failed to generate discount reminder template" };
  }

  const subject = "⏰ Don't Miss Out — Your 10% OFF Is Waiting";
  return await sendCustomEmail(subscriberData.email, subject, htmlContent);
};

module.exports = { 
  sendEmail, 
  sendCustomEmail,
  sendOrderConfirmation,
  sendOrderProcessing,
  sendShippingNotification,
  sendDeliveryConfirmation,
  sendReviewRequest,
  sendAdminNotification,
  sendNewsletterWelcome,
  sendDiscountReminder
};
