const crypto = require('crypto');

const env = require('../../config/env');

function getKeyBuffer() {
  return crypto.createHash('sha256').update(env.encryptionKey).digest();
}

function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const key = getKeyBuffer();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptText(payload) {
  const raw = Buffer.from(String(payload), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const key = getKeyBuffer();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = {
  decryptText,
  encryptText,
};
