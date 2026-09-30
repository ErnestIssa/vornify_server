/** Normalize vornifydb --read results for `users` (object, array, or empty). */

function pickUserFromDbRead(data) {
  if (data == null) return null;
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null;
  if (typeof data === 'object' && (data.email || data._id)) return data;
  return null;
}

function hasUserFromDbRead(data) {
  return pickUserFromDbRead(data) != null;
}

module.exports = { pickUserFromDbRead, hasUserFromDbRead };
