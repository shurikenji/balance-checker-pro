const { getDatabase } = require('../../db');

function createAuditLog({ adminUserId, action, entityType, entityId, meta }) {
  getDatabase()
    .prepare(
      `
        INSERT INTO audit_logs (admin_user_id, action, entity_type, entity_id, meta_json)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(
      adminUserId || null,
      action,
      entityType,
      entityId ? String(entityId) : null,
      meta ? JSON.stringify(meta) : null
    );
}

module.exports = {
  createAuditLog,
};
