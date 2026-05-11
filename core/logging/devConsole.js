'use strict';

/** True when local / non-production Node runs (never log noisy debug in production). */
function isDevelopment() {
    return process.env.NODE_ENV === 'development';
}

function devLog(...args) {
    if (isDevelopment()) console.log(...args);
}

function devWarn(...args) {
    if (isDevelopment()) console.warn(...args);
}

function devError(...args) {
    if (isDevelopment()) console.error(...args);
}

module.exports = {
    isDevelopment,
    devLog,
    devWarn,
    devError
};
