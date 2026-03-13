const env = require('../../config/env');

function requireAdmin(req, res, next) {
  if (!req.session.adminUser) {
    return res.redirect('/admin/login');
  }

  return next();
}

function enforceAdminIpAllowlist(req, res, next) {
  if (!env.adminIpAllowlist.length) {
    return next();
  }

  const requestIp = normalizeIp(req.ip || req.connection?.remoteAddress || '');

  if (env.adminIpAllowlist.includes(requestIp)) {
    return next();
  }

  return res.status(403).send('Admin access denied for this IP');
}

function normalizeIp(value) {
  return String(value || '').replace(/^::ffff:/, '');
}

module.exports = {
  enforceAdminIpAllowlist,
  requireAdmin,
};
