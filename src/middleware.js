export function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect(303, '/login');
  res.status(401).type('text').send('Please sign in.');
}

export function requireStaff(req, res, next) {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'moderator')) return next();
  res.status(404).type('text').send('Not found');
}
