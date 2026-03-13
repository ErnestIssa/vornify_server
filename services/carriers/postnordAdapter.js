/**
 * PostNord carrier adapter (stub).
 * Replace with real PostNord API calls when credentials are configured.
 * Credentials come from DB (carrier_integrations); admin configures in panel.
 */
async function getRates(creds, origin, destination, parcel) {
    return { success: false, error: 'PostNord rate fetching not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function createLabel(creds, shipmentData) {
    return { success: false, error: 'PostNord label creation not integrated. Configure API in Admin → Carrier Integrations.' };
}
async function trackShipment(creds, trackingNumber) {
    return { success: false, error: 'PostNord tracking not integrated.' };
}
async function cancelShipment(creds, shipmentId) {
    return { success: false, error: 'PostNord cancel not integrated.' };
}
module.exports = { getRates, createLabel, trackShipment, cancelShipment };
