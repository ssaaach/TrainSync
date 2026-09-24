// Session guards for private routes.

function requireAuth(req, res, next) {
  if (req.session && req.session.user && req.session.user.user_id) return next();
  return res.status(401).json({ error: 'Not logged in', code: 'unauthorized' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    const user = req.session && req.session.user;
    if (!user || !user.user_id) return res.status(401).json({ error: 'Not logged in', code: 'unauthorized' });
    if (!roles.includes(user.role)) return res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
    return next();
  };
}

module.exports = { requireAuth, requireRole };
