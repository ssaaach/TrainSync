// HttpError for expected failures, plus the 404 and central error handlers.
// Every error response has the shape { error, code, requestId }.
const config = require('../config');

class HttpError extends Error {
  constructor(status, message, code = 'error', extra = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.expose = true;
  }
}

const badRequest = (msg, code = 'bad_request', extra) => new HttpError(400, msg, code, extra);
const unauthorized = (msg = 'Not logged in') => new HttpError(401, msg, 'unauthorized');
const forbidden = (msg = 'Forbidden', code = 'forbidden') => new HttpError(403, msg, code);
const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');
const conflict = (msg, code = 'conflict') => new HttpError(409, msg, code);

function apiNotFound(req, res) {
  res.status(404).json({ error: 'Not found', code: 'not_found', requestId: req.id });
}

// Maps library errors to client-safe responses; everything else is a logged 500.
function classify(err) {
  if (err instanceof HttpError) return err;
  if (err.code === 'EBADCSRFTOKEN' || err.code === 'invalid csrf token') {
    return new HttpError(403, 'Your session expired or the form is stale. Please retry.', 'csrf_invalid');
  }
  if (err.type === 'entity.parse.failed') return badRequest('Request body is not valid JSON', 'invalid_json');
  if (err.type === 'entity.too.large') return new HttpError(413, 'Request body is too large', 'too_large');
  if (err.status >= 400 && err.status < 500 && err.expose) return new HttpError(err.status, err.message, 'bad_request');
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const known = classify(err);
  const log = req.log || require('../config/logger');
  if (known) {
    if (known.status >= 500) log.error({ err }, known.message);
    return res.status(known.status).json({ error: known.message, code: known.code, requestId: req.id, ...known.extra });
  }
  log.error({ err }, 'unhandled error');
  if (res.headersSent) return undefined;
  res.status(500).json({
    error: 'Something went wrong on our side. Please try again.',
    code: 'internal',
    requestId: req.id,
    ...(config.isProduction ? {} : { detail: err.message }),
  });
  return undefined;
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, apiNotFound, errorHandler };
