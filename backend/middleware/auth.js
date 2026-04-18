// middleware/auth.js — Bearer token verification + role guards.

import { verifyAccess } from '../utils/tokens.js';
import { User } from '../models/User.js';
import { log } from '../utils/logger.js';

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const token = h.slice(7);
  let claims;
  try {
    claims = verifyAccess(token);
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Verify user still exists and tokenVersion matches — revoke-all-sessions support
  const user = await User.findById(claims.sub).lean();
  if (!user || user.disabledAt) return res.status(401).json({ error: 'user_inactive' });
  if ((user.tokenVersion || 0) !== (claims.v || 0)) {
    return res.status(401).json({ error: 'token_stale' });
  }

  req.user = { id: String(user._id), role: user.role, loginId: user.loginId };
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
