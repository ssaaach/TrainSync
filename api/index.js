// Vercel serverless entry: the same Express app, no listen(). Static pages in
// public/ are served by Vercel's CDN; vercel.json rewrites the dynamic routes here.
module.exports = require('../app');
