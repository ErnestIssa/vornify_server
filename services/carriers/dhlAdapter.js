/**
 * DHL carrier adapter (stub).
 * Replace with real DHL API when credentials are configured via Admin.
 */
async function getRates(creds, origin, destination, parcel) {
    return { success: false, error: 'DHL rate fetching not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function createLabel(creds, shipmentData) {
    return { success: false, error: 'DHL label creation not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function trackShipment(creds, trackingNumber) {
    return { success: false, error: 'DHL tracking not integrated.' };
}
async function cancelShipment(creds, shipmentId) {
    return { success: false, error: 'DHL cancel not integrated.' };
}
module.exports = { getRates, createLabel, trackShipment, cancelShipment };
