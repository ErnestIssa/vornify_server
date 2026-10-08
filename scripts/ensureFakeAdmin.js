/**
 * One-shot: create/refresh Fake Ernest from FAKE_ADMIN_* env.
 *   node scripts/ensureFakeAdmin.js
 */
require('dotenv').config();
const { ensureFakeAdmin } = require('../services/ensureFakeAdmin');

ensureFakeAdmin()
    .then((result) => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok || result.skipped ? 0 : 1);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
