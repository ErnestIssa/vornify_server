/**
 * UPS carrier adapter (stub).
 * Replace with real UPS API when credentials are configured via Admin.
 */
async function getRates(creds, origin, destination, parcel) {
    return { success: false, error: 'UPS rate fetching not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function createLabel(creds, shipmentData) {
    return { success: false, error: 'UPS label creation not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function trackShipment(creds, trackingNumber) {
    return { success: false, error: 'UPS tracking not integrated.' };
}
async function cancelShipment(creds, shipmentId) {
    return { success: false, error: 'UPS cancel not integrated.' };
}
module.exports = { getRates, createLabel, trackShipment, cancelShipment };
