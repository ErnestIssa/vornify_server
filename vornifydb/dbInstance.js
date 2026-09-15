// Singleton MongoDB instance to prevent connection exhaustion
const VortexDB = require('./vornifydb');

let dbInstance = null;

function getDBInstance() {
    if (!dbInstance) {
        console.log('📦 Creating shared MongoDB instance (singleton)');
        dbInstance = new VortexDB();
    }
    return dbInstance;
}

async function closeDBInstance() {
    if (!dbInstance) return;
    await dbInstance.close();
    dbInstance = null;
}

module.exports = getDBInstance;
module.exports.closeDBInstance = closeDBInstance;

