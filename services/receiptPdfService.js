/**
 * Peak Mode order receipt PDF (HTML → Puppeteer → PDF).
 * Reusable: generateReceiptPdfBuffer(order) returns Buffer + filename.
 * Language/currency from order (checkout). QR (header) + Code 128 (footer) link to admin order URL (staff scan).
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');

const COMPANY = {
    name: process.env.RECEIPT_COMPANY_NAME || 'PM SHOP AB',
    orgNumber: process.env.RECEIPT_ORG_NUMBER || '559557-5480',
    website: process.env.RECEIPT_WEBSITE_URL || 'https://www.peakmode.se',
    supportEmail: process.env.RECEIPT_SUPPORT_EMAIL || 'support@peakmode.se',
    addressLine: process.env.RECEIPT_COMPANY_ADDRESS || 'Jyllandsgatan 112, 164 47 Kista, Sweden'
};

const LOGO_URL = process.env.RECEIPT_LOGO_URL || 'https://www.peakmode.se/favicon.ico';

function displayWebsite(raw) {
    const s = (raw || '').trim();
    if (!s) return 'www.peakmode.se';
    // Normalize accidental "https://https://..." and always display without protocol.
    return s
        .replace(/^https?:\/\//i, '')
        .replace(/^https?:\/\//i, '')
        .replace(/^\/+/, '')
        .replace(/\/$/, '');
}

/** Base URL for QR (admin opens order). Trailing slash optional. */
function getAdminOrderQrBase() {
    const base = (process.env.ADMIN_RECEIPT_QR_URL_BASE || process.env.ADMIN_APP_BASE_URL || 'https://peakmode.se').replace(/\/$/, '');
    return base.includes('/admin/orders') ? base : `${base}/admin/orders`;
}

function stableInvoiceNumber(orderId) {
    const hex = crypto.createHash('sha256').update(String(orderId)).digest('hex');
    const num = (parseInt(hex.slice(0, 10), 16) % 900000) + 100000;
    return `INV-${num}`;
}

const STRINGS = {
    en: {
        thankYou: 'Thank You For Your Order!',
        confirmed: 'Your Purchase Has Been Confirmed!',
        customer: 'Customer',
        order: 'Order #',
        email: 'Email',
        invoice: 'Invoice #',
        phone: 'Phone',
        fulfillment: 'Fulfillment',
        date: 'Date',
        time: 'Time',
        subtotal: 'Subtotal',
        tax: 'Tax',
        shipping: 'Shipping',
        total: 'Total',
        paymentMethod: 'Payment Method',
        cardLast4: 'Card Last 4',
        transactionId: 'Transaction ID',
        paymentStatus: 'Payment Status',
        paid: 'Paid',
        tracking: 'Tracking',
        questions: 'If you have any questions about your order, please contact',
        trackHint: 'Track your order using the tracking number provided:',
        footerThanks: 'Thank you for shopping with us!',
        tagline: 'No Limits. Just Peaks.',
        policies: 'Policies & information',
        privacy: 'Privacy policy',
        terms: 'Terms & conditions',
        scanLabel: 'Opens this order in admin (barcode)',
        adminOnlyNote: 'For Peak Mode admin use only',
        returnsSummaryTitle: 'Returns & refunds (summary)',
        returnsReadMore: 'Read the full policy on',
        returnsP1: 'Under Swedish and EU consumer law you may withdraw from your purchase within 30 days of receiving your order. To exercise the right of withdrawal, notify Peak Mode in writing (e.g. by email) within 14 days.',
        returnsP2: 'Returned items must be unused, unwashed, and in original condition, with tags and packaging intact. We may refuse a return or issue a reduced refund if items show use, damage, odour, or missing tags.',
        returnsP3: 'For hygiene reasons, certain items (such as underwear or items worn on the skin) may not be returnable if opened or used.',
        card: 'Card',
        country: 'Country'
    },
    sv: {
        thankYou: 'Tack för din beställning!',
        confirmed: 'Ditt köp är bekräftat!',
        customer: 'Kund',
        order: 'Order #',
        email: 'E-post',
        invoice: 'Faktura #',
        phone: 'Telefon',
        fulfillment: 'Leverans',
        date: 'Datum',
        time: 'Tid',
        subtotal: 'Delsumma',
        tax: 'Moms',
        shipping: 'Frakt',
        total: 'Totalt',
        paymentMethod: 'Betalningsmetod',
        cardLast4: 'Kort sista 4',
        transactionId: 'Transaktions-ID',
        paymentStatus: 'Betalningsstatus',
        paid: 'Betald',
        tracking: 'Spårning',
        questions: 'Vid frågor om din order, kontakta',
        trackHint: 'Spåra din order med spårningsnumret nedan:',
        footerThanks: 'Tack för att du handlar hos oss!',
        tagline: 'No Limits. Just Peaks.',
        policies: 'Policy och information',
        privacy: 'Integritetspolicy',
        terms: 'Köpvillkor',
        scanLabel: 'Öppnar ordern i admin (streckkod)',
        adminOnlyNote: 'Endast för Peak Modes administrativa användning',
        returnsSummaryTitle: 'Retur & återbetalning (kort)',
        returnsReadMore: 'Läs hela policyn på',
        returnsP1: 'Enligt svensk och EU-konsumenträtt har du rätt att ångra köpet inom 30 dagar från att du mottagit varorna. För att utöva ångerrätten ska du meddela Peak Mode skriftligt (t.ex. via e-post) inom 14 dagar.',
        returnsP2: 'Returnerade varor ska vara oanvända, otvättade och i originalskick med etiketter och förpackning intakta. Vi förbehåller oss rätten att neka retur eller göra avdrag vid spår av användning, skada, lukt eller saknade etiketter.',
        returnsP3: 'Av hygieniska skäl kan vissa varor (t.ex. underkläder eller varor mot huden) inte returneras om de öppnats eller använts.',
        card: 'Kort',
        country: 'Land'
    }
};

function t(lang, key) {
    const L = STRINGS[lang === 'sv' ? 'sv' : 'en'];
    return L[key] || STRINGS.en[key] || key;
}

function round2(n) {
    return Math.round((typeof n === 'number' && !isNaN(n) ? n : 0) * 100) / 100;
}

function formatMoney(amount, currency) {
    const n = typeof amount === 'number' && !isNaN(amount) ? amount : 0;
    const c = (currency || 'SEK').toUpperCase();
    return `${n.toFixed(2)} ${c}`;
}

function itemTitle(item) {
    return item.name || item.title || item.productName || 'Item';
}

/** Display card number as **** **** **** xxxx when last 4 digits are known. */
function formatCardMaskedLast4(raw) {
    const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (digits.length >= 4) {
        return `**** **** **** ${digits.slice(-4)}`;
    }
    return '**** **** **** ****';
}

/**
 * Ensure order has invoiceNumber in DB (idempotent).
 * @returns {Promise<string>} invoiceNumber
 */
async function ensureInvoiceNumberOnOrder(order, db) {
    const orderId = order.orderId;
    if (order.invoiceNumber) return order.invoiceNumber;
    const invoiceNumber = stableInvoiceNumber(orderId);
    await db.executeOperation({
        database_name: 'peakmode',
        collection_name: 'orders',
        command: '--update',
        data: {
            filter: { orderId },
            update: { invoiceNumber, receiptInvoiceAssignedAt: new Date().toISOString() }
        }
    });
    return invoiceNumber;
}

function buildReceiptHtml(order, invoiceNumber, qrDataUrl, barcodeDataUrl, lang) {
    const currency = (order.displayCurrency || order.currency || order.totals?.currency || 'SEK').toUpperCase();
    const totals = order.totals || {};
    const subEx = totals.subtotalExVat ?? totals.subtotal ?? order.subtotal ?? 0;
    const vatProducts = totals.vatAmount ?? totals.tax ?? order.tax ?? 0;
    const vatShip = typeof totals.shippingVat === 'number' ? totals.shippingVat : 0;
    const vatAmt = round2(vatProducts + vatShip);
    const vatRate = typeof totals.vatRate === 'number' ? totals.vatRate : 0.25;
    const ship = totals.shippingGross ?? totals.shipping ?? order.shipping ?? 0;
    const grandTotal = totals.total ?? order.total ?? 0;

    const cust = order.customer || {};
    const customerName = [cust.firstName, cust.lastName].filter(Boolean).join(' ') || cust.name || order.customerName || '';
    const email = cust.email || order.customerEmail || '';
    const phone = cust.phone || '';
    const shipAddr = order.shippingAddress || cust;
    const country = (shipAddr.country || cust.country || '').toString().toUpperCase();

    const created = new Date(order.createdAt || order.orderDate || order.date || Date.now());
    const dateStr = created.toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = created.toLocaleTimeString(lang === 'sv' ? 'sv-SE' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const fulfillment = typeof order.shippingMethod === 'string'
        ? order.shippingMethod
        : (order.shippingMethod?.name || order.shippingMethodDetails?.name || '—');

    const paymentLabel = order.paymentMethod === 'card' || !order.paymentMethod
        ? `${t(lang, 'card')} / Visa, Mastercard`
        : String(order.paymentMethod);
    const last4Raw = order.paymentCardLast4;
    const last4Display = formatCardMaskedLast4(last4Raw);
    const txId = order.paymentIntentId || order.stripeChargeId || '—';

    const privacyUrl = process.env.RECEIPT_PRIVACY_URL || 'https://www.peakmode.se/privacy-policy';
    const termsUrl = process.env.RECEIPT_TERMS_URL || 'https://peakmode.se/terms-of-service';
    const returnsInfoUrl = process.env.RECEIPT_RETURNS_INFO_URL || termsUrl;

    const lines = (order.items || []).map((item) => {
        const qty = item.quantity || 1;
        const price = typeof item.price === 'number' ? item.price : 0;
        const line = qty * price;
        return `<tr><td>${qty} ${escapeHtml(itemTitle(item))}</td><td style="text-align:right">${formatMoney(line, currency)}</td></tr>`;
    }).join('');

    const trackingBlock = order.trackingNumber
        ? `<div class="dots"></div><p class="track">${escapeHtml(order.trackingNumber)}</p><div class="dots"></div>`
        : '<div class="dots"></div>';

    return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; color: #111; margin: 0; padding: 24px; max-width: 600px; margin: 0 auto; }
    .logo { max-height: 48px; margin-bottom: 8px; }
    .receipt-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
    .company { font-size: 10px; line-height: 1.5; color: #333; flex: 1; min-width: 0; margin-bottom: 0; }
    .admin-qr-top { flex-shrink: 0; text-align: right; max-width: 120px; }
    .admin-qr-top img { width: 96px; height: 96px; display: block; margin-left: auto; }
    .dots { border-top: 1px dotted #999; margin: 12px 0; }
    h1 { font-size: 15px; text-align: center; margin: 8px 0; font-weight: 700; }
    h2 { font-size: 13px; text-align: center; margin: 4px 0 16px; font-weight: 600; }
    table.meta { width: 100%; margin: 12px 0; }
    table.meta td { padding: 3px 0; vertical-align: top; }
    table.meta .k { color: #555; width: 35%; }
    table.lines { width: 100%; border-collapse: collapse; margin: 12px 0; }
    table.lines td { padding: 6px 0; border-bottom: 1px solid #eee; }
    table.totals { width: 100%; margin-top: 8px; }
    table.totals td { padding: 4px 0; }
    .track { text-align: center; font-size: 12px; font-weight: 600; letter-spacing: 0.5px; }
    .footer { margin-top: 20px; font-size: 10px; color: #444; text-align: center; line-height: 1.6; }
    .qr-wrap { text-align: center; margin-top: 24px; padding-top: 16px; }
    .qr-wrap .barcode-img { max-width: 100%; height: auto; }
    .qr-label { font-size: 9px; color: #666; margin-top: 6px; }
    .admin-code-note { font-size: 8px; color: #888; margin-top: 4px; max-width: 120px; margin-left: auto; line-height: 1.3; }
    .admin-qr-top .admin-code-note { margin-left: auto; margin-right: 0; text-align: right; }
    .qr-wrap .admin-code-note { margin-left: auto; margin-right: auto; text-align: center; max-width: 280px; }
    .returns-block { margin-top: 20px; padding-top: 14px; border-top: 1px dotted #bbb; font-size: 8.5px; line-height: 1.45; color: #444; text-align: left; }
    .returns-block h3 { font-size: 9.5px; margin: 0 0 8px 0; font-weight: 600; color: #111; }
    .returns-block p { margin: 0 0 6px 0; }
    .returns-block .read-more { margin-top: 8px; font-size: 8px; color: #555; }
    a { color: #111; }
  </style>
</head>
<body>
  <img class="logo" src="${escapeHtml(LOGO_URL)}" alt="Peak Mode" onerror="this.style.display='none'"/>
  <div class="receipt-header">
    <div class="company">
      <strong>${escapeHtml(COMPANY.name)}</strong><br/>
      Org.nr ${escapeHtml(COMPANY.orgNumber)}<br/>
      ${escapeHtml(displayWebsite(COMPANY.website))}<br/>
      ${t(lang, 'customer') === 'Kund' ? 'Support' : 'Support'}: ${escapeHtml(COMPANY.supportEmail)}<br/>
      ${escapeHtml(COMPANY.addressLine)}
    </div>
    <div class="admin-qr-top">
      <img src="${qrDataUrl}" alt="QR"/>
      <div class="admin-code-note">${escapeHtml(t(lang, 'adminOnlyNote'))}</div>
    </div>
  </div>
  <div class="dots"></div>
  <h1>${escapeHtml(t(lang, 'thankYou'))}</h1>
  <h2>${escapeHtml(t(lang, 'confirmed'))}</h2>
  <div class="dots"></div>
  <table class="meta">
    <tr><td class="k">${escapeHtml(t(lang, 'customer'))}</td><td>${escapeHtml(customerName)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'order'))}</td><td>${escapeHtml(order.orderId || '')}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'email'))}</td><td>${escapeHtml(email)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'invoice'))}</td><td>${escapeHtml(invoiceNumber)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'phone'))}</td><td>${escapeHtml(phone || '—')}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'fulfillment'))}</td><td>${escapeHtml(fulfillment)}</td></tr>
    ${country ? `<tr><td class="k">${escapeHtml(t(lang, 'country'))}</td><td>${escapeHtml(country)}</td></tr>` : ''}
  </table>
  <div class="dots"></div>
  <p><strong>${escapeHtml(t(lang, 'date'))}:</strong> ${escapeHtml(dateStr)} &nbsp; <strong>${escapeHtml(t(lang, 'time'))}:</strong> ${escapeHtml(timeStr)}</p>
  <div class="dots"></div>
  <table class="lines">${lines}</table>
  <table class="totals">
    <tr><td>${escapeHtml(t(lang, 'subtotal'))}</td><td style="text-align:right">${formatMoney(subEx, currency)}</td></tr>
    ${ship > 0 ? `<tr><td>${escapeHtml(t(lang, 'shipping'))}</td><td style="text-align:right">${formatMoney(ship, currency)}</td></tr>` : ''}
    <tr><td>${escapeHtml(t(lang, 'tax'))} (${Math.round(vatRate * 100)}%)</td><td style="text-align:right">${formatMoney(vatAmt, currency)}</td></tr>
    <tr><td><strong>${escapeHtml(t(lang, 'total'))}</strong></td><td style="text-align:right"><strong>${formatMoney(grandTotal, currency)}</strong></td></tr>
  </table>
  <div class="dots"></div>
  <table class="meta">
    <tr><td class="k">${escapeHtml(t(lang, 'paymentMethod'))}</td><td>${escapeHtml(paymentLabel)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'cardLast4'))}</td><td style="font-family: Consolas, 'Courier New', monospace; letter-spacing: 0.5px;">${escapeHtml(last4Display)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'transactionId'))}</td><td>${escapeHtml(txId)}</td></tr>
    <tr><td class="k">${escapeHtml(t(lang, 'paymentStatus'))}</td><td>${escapeHtml(t(lang, 'paid'))}</td></tr>
  </table>
  ${trackingBlock}
  <div class="footer">
    <p>${escapeHtml(t(lang, 'questions'))} <a href="mailto:${escapeHtml(COMPANY.supportEmail)}">${escapeHtml(COMPANY.supportEmail)}</a>.</p>
    <p>${escapeHtml(t(lang, 'trackHint'))} ${escapeHtml(`(${order.orderId || ''})`)}</p>
    <p><strong>${escapeHtml(t(lang, 'footerThanks'))}</strong><br/>${escapeHtml(t(lang, 'tagline'))}</p>
    <p>${escapeHtml(t(lang, 'policies'))}: <a href="${escapeHtml(privacyUrl)}">${escapeHtml(t(lang, 'privacy'))}</a> · <a href="${escapeHtml(termsUrl)}">${escapeHtml(t(lang, 'terms'))}</a></p>
  </div>
  <div class="qr-wrap">
    <img class="barcode-img" src="${barcodeDataUrl}" alt="Barcode"/>
    <div class="qr-label">${escapeHtml(t(lang, 'scanLabel'))}</div>
    <div class="admin-code-note">${escapeHtml(t(lang, 'adminOnlyNote'))}</div>
  </div>
  <div class="returns-block">
    <h3>${escapeHtml(t(lang, 'returnsSummaryTitle'))}</h3>
    <p>${escapeHtml(t(lang, 'returnsP1'))}</p>
    <p>${escapeHtml(t(lang, 'returnsP2'))}</p>
    <p>${escapeHtml(t(lang, 'returnsP3'))}</p>
    <p class="read-more">${escapeHtml(t(lang, 'returnsReadMore'))} <a href="${escapeHtml(returnsInfoUrl)}">${escapeHtml(displayWebsite(returnsInfoUrl))}</a></p>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Generate PDF buffer for an order (does not persist invoiceNumber — call ensureInvoiceNumberOnOrder first if needed).
 * @param {object} order - Full order document
 * @returns {Promise<{ buffer: Buffer, filename: string, invoiceNumber: string }>}
 */
async function generateReceiptPdfBuffer(order) {
    const invoiceNumber = order.invoiceNumber || stableInvoiceNumber(order.orderId);
    const lang = (order.language || 'en').toLowerCase().startsWith('sv') ? 'sv' : 'en';
    const orderId = order.orderId;
    const adminUrl = `${getAdminOrderQrBase()}/${encodeURIComponent(orderId)}`;
    // QR (top right) + Code 128 barcode (footer); both encode the same admin order URL.
    const qrDataUrl = await QRCode.toDataURL(adminUrl, { margin: 1, width: 200, color: { dark: '#000000', light: '#ffffff' } });

    let barcodeDataUrl;
    try {
        const png = await bwipjs.toBuffer({
            bcid: 'code128',
            text: adminUrl,
            scale: 2,
            height: 4,
            includetext: false,
            backgroundcolor: 'FFFFFF'
        });
        barcodeDataUrl = `data:image/png;base64,${png.toString('base64')}`;
    } catch (e) {
        // Fallback: if barcode generation fails, reuse a compact QR at the footer so generation still works.
        barcodeDataUrl = await QRCode.toDataURL(adminUrl, { margin: 1, width: 160, color: { dark: '#000000', light: '#ffffff' } });
    }

    const html = buildReceiptHtml(order, invoiceNumber, qrDataUrl, barcodeDataUrl, lang);

    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

    async function launchBrowser() {
        // 1) Prefer bundled puppeteer if it can launch (local/dev and some hosts)
        try {
            const puppeteer = require('puppeteer');
            const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
            return await puppeteer.launch({
                headless: true,
                executablePath,
                args: launchArgs
            });
        } catch (e1) {
            // 2) Fallback for constrained/serverless Linux: puppeteer-core + @sparticuz/chromium
            try {
                const puppeteerCore = require('puppeteer-core');
                const chromium = require('@sparticuz/chromium');
                const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (await chromium.executablePath());
                return await puppeteerCore.launch({
                    args: [...chromium.args, ...launchArgs],
                    defaultViewport: chromium.defaultViewport,
                    executablePath,
                    headless: chromium.headless
                });
            } catch (e2) {
                const more = [
                    `puppeteer_error=${e1?.message || e1}`,
                    `chromium_fallback_error=${e2?.message || e2}`,
                    `platform=${process.platform}`,
                    `arch=${process.arch}`,
                    `node=${process.version}`,
                    `PUPPETEER_EXECUTABLE_PATH=${process.env.PUPPETEER_EXECUTABLE_PATH || ''}`
                ].join(' | ');
                const err = new Error(`Failed to launch Chromium for receipt PDF. ${more}`);
                err.cause = { puppeteer: e1, chromiumFallback: e2 };
                throw err;
            }
        }
    }

    const browser = await launchBrowser();
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const buffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' }
        });
        const safeId = String(orderId).replace(/[^a-zA-Z0-9-_]/g, '_');
        const filename = `PeakMode-Receipt-${safeId}.pdf`;
        return { buffer: Buffer.from(buffer), filename, invoiceNumber };
    } finally {
        await browser.close();
    }
}

module.exports = {
    generateReceiptPdfBuffer,
    ensureInvoiceNumberOnOrder,
    stableInvoiceNumber,
    getAdminOrderQrBase,
    COMPANY
};
