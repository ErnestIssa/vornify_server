/**
 * One-time seed for admin-controlled shipping config.
 * Run from project root: node scripts/seed-shipping-config.js
 * Creates shipping_zones, shipping_methods, shipping_prices, shipping_free_areas with example data.
 * Safe to run multiple times: does not duplicate if zones already exist.
 * Requires: .env with MONGODB_URI (or set in environment).
 */
require('dotenv').config();
const getDBInstance = require('../vornifydb/dbInstance');

const DATABASE_NAME = 'peakmode';
const COLLECTIONS = {
    ZONES: 'shipping_zones',
    METHODS: 'shipping_methods',
    PRICES: 'shipping_prices',
    FREE_AREAS: 'shipping_free_areas'
};

const EU_COUNTRIES = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES'
];

async function seed() {
    const db = getDBInstance();
    const zonesColl = await db.getCollection(DATABASE_NAME, COLLECTIONS.ZONES);
    const methodsColl = await db.getCollection(DATABASE_NAME, COLLECTIONS.METHODS);
    const pricesColl = await db.getCollection(DATABASE_NAME, COLLECTIONS.PRICES);
    const freeAreasColl = await db.getCollection(DATABASE_NAME, COLLECTIONS.FREE_AREAS);

    const existingZones = await zonesColl.countDocuments();
    if (existingZones > 0) {
        console.log('Shipping zones already exist. Skip seed or delete existing docs first.');
        return;
    }

    const zoneSE = await zonesColl.insertOne({
        name: 'Sweden',
        countries: ['SE'],
        currency: 'SEK',
        active: true
    });
    const zoneEU = await zonesColl.insertOne({
        name: 'EU',
        countries: EU_COUNTRIES,
        currency: 'SEK',
        active: true
    });

    const methodHome = await methodsColl.insertOne({
        id: 'home_delivery',
        name: 'Home delivery',
        type: 'home',
        carrier: 'PostNord',
        active: true,
        estimatedDays: '2-5 business days',
        description: 'Delivery to your home address',
        supportsServicePoints: false,
        supportsHomeDelivery: true
    });
    const methodLocker = await methodsColl.insertOne({
        id: 'parcel_locker',
        name: 'Collect at parcel locker',
        type: 'parcel_locker',
        carrier: 'PostNord',
        active: true,
        estimatedDays: '2-5 business days',
        description: 'Pick up from a nearby parcel locker',
        supportsServicePoints: true,
        supportsHomeDelivery: false
    });
    const methodMailbox = await methodsColl.insertOne({
        id: 'mailbox_door',
        name: 'Collect at mailbox / door',
        type: 'mailbox',
        carrier: 'PostNord',
        active: true,
        estimatedDays: '2-5 business days',
        description: 'Delivery to your mailbox or door',
        supportsServicePoints: false,
        supportsHomeDelivery: true
    });
    const methodEco = await methodsColl.insertOne({
        id: 'home_delivery_eco',
        name: 'Home delivery 🌿 Eco',
        type: 'home_eco',
        carrier: 'PostNord',
        active: true,
        estimatedDays: '3-7 business days',
        description: 'Eco-friendly delivery to your home address',
        supportsServicePoints: false,
        supportsHomeDelivery: true
    });

    const prices = [
        { zoneId: zoneSE.insertedId, methodId: 'home_delivery', basePrice: 89, currency: 'SEK', active: true },
        { zoneId: zoneSE.insertedId, methodId: 'parcel_locker', basePrice: 79, currency: 'SEK', active: true },
        { zoneId: zoneSE.insertedId, methodId: 'mailbox_door', basePrice: 79, currency: 'SEK', active: true },
        { zoneId: zoneSE.insertedId, methodId: 'home_delivery_eco', basePrice: 79, currency: 'SEK', active: true },
        { zoneId: zoneEU.insertedId, methodId: 'home_delivery', basePrice: 109, currency: 'SEK', active: true },
        { zoneId: zoneEU.insertedId, methodId: 'parcel_locker', basePrice: 99, currency: 'SEK', active: true },
        { zoneId: zoneEU.insertedId, methodId: 'mailbox_door', basePrice: 99, currency: 'SEK', active: true },
        { zoneId: zoneEU.insertedId, methodId: 'home_delivery_eco', basePrice: 99, currency: 'SEK', active: true }
    ];
    for (const p of prices) {
        await pricesColl.insertOne(p);
    }

    const freeMunicipalities = [
        'Håbo', 'Enköping', 'Uppsala', 'Knivsta', 'Heby',
        'Sigtuna', 'Upplands-Bro', 'Upplands Väsby', 'Järfälla', 'Sollentuna',
        'Sundbyberg', 'Solna', 'Stockholm', 'Danderyd', 'Täby', 'Vallentuna',
        'Ekerö', 'Vaxholm', 'Nacka', 'Värmdö', 'Tyresö', 'Haninge'
    ];
    await freeAreasColl.insertMany(
        freeMunicipalities.map(m => ({ country: 'SE', municipality: m, active: true }))
    );

    console.log('Seed done: zones 2, methods 4, prices 8, free areas', freeMunicipalities.length);
}

seed().catch(err => {
    console.error(err);
    process.exit(1);
});
