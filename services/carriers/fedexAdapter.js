/**
 * FedEx carrier adapter (stub).
 * Replace with real FedEx API when credentials are configured via Admin.
 */
async function getRates(creds, origin, destination, parcel) {
    return { success: false, error: 'FedEx rate fetching not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function createLabel(creds, shipmentData) {
    return { success: false, error: 'FedEx label creation not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function trackShipment(creds, trackingNumber) {
    return { success: false, error: 'FedEx tracking not integrated.' };
}
async function cancelShipment(creds, shipmentId) {
    return { success: false, error: 'FedEx cancel not integrated.' };
}
module.exports = { getRates, createLabel, trackShipment, cancelShipment };
