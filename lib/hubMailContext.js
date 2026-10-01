/** Options for Hub account emails from an HTTP request + optional user record. */
function hubMailOptions(req, user) {
  return {
    fallbackOrigin: req?.headers?.origin,
    user: user || undefined,
    language: req?.body?.language,
    acceptLanguage: req?.headers?.['accept-language'],
  };
}

module.exports = { hubMailOptions };
