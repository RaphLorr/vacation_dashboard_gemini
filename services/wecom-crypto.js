/**
 * WeChat Work (企业微信) Message Callback Crypto Service
 *
 * Implements AES-256-CBC encryption/decryption and SHA1 signature
 * verification for the WeChat Work message callback protocol.
 *
 * Uses only Node.js built-in crypto — no external dependencies.
 */

const crypto = require('crypto');

class WecomCryptoError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'WecomCryptoError';
    this.code = code;
  }
}

const ErrorCodes = {
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
  ENCRYPT_FAILED: 'ENCRYPT_FAILED',
  INVALID_CORPID: 'INVALID_CORPID',
  INVALID_ENCODING_KEY: 'INVALID_ENCODING_KEY',
};

/**
 * Extract a field value from XML using regex.
 * Handles both CDATA-wrapped and plain text values.
 *
 * @param {string} xml - Raw XML string
 * @param {string} fieldName - XML element name to extract
 * @returns {string|null} Field value or null if not found
 */
function extractXmlField(xml, fieldName) {
  if (!xml || typeof xml !== 'string') {
    return null;
  }

  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Try CDATA first: <FieldName><![CDATA[value]]></FieldName>
  const cdataRegex = new RegExp(
    `<${escaped}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${escaped}>`
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1];
  }

  // Fall back to plain text: <FieldName>value</FieldName>
  const plainRegex = new RegExp(
    `<${escaped}>([\\s\\S]*?)</${escaped}>`
  );
  const plainMatch = xml.match(plainRegex);
  if (plainMatch) {
    return plainMatch[1];
  }

  return null;
}

class WecomCrypto {
  /**
   * @param {string} token - Callback token from 企业微信管理后台
   * @param {string} encodingAESKey - 43-char EncodingAESKey from 企业微信管理后台
   * @param {string} corpId - Enterprise corp ID (WECOM_CORPID)
   */
  constructor(token, encodingAESKey, corpId) {
    if (!token || !encodingAESKey || !corpId) {
      throw new WecomCryptoError(
        'token, encodingAESKey, and corpId are all required',
        ErrorCodes.INVALID_ENCODING_KEY
      );
    }

    if (encodingAESKey.length !== 43) {
      throw new WecomCryptoError(
        `EncodingAESKey must be 43 characters, got ${encodingAESKey.length}`,
        ErrorCodes.INVALID_ENCODING_KEY
      );
    }

    this.token = token;
    this.corpId = corpId;

    // Decode: append '=' then Base64 decode → 32-byte AES key
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    // WeChat Work protocol: IV is the first 16 bytes of the AES key
    this.iv = this.aesKey.subarray(0, 16);

    Object.freeze(this);
  }

  /**
   * Compute SHA1 signature over sorted [token, timestamp, nonce, encrypt].
   *
   * @param {string} timestamp
   * @param {string} nonce
   * @param {string} encrypt - Encrypted message string
   * @returns {string} Hex-encoded SHA1 hash
   */
  getSignature(timestamp, nonce, encrypt) {
    const parts = [this.token, timestamp, nonce, encrypt].sort();
    return crypto.createHash('sha1').update(parts.join('')).digest('hex');
  }

  /**
   * Verify a message signature using constant-time comparison.
   *
   * @param {string} msgSignature - Signature from query params
   * @param {string} timestamp
   * @param {string} nonce
   * @param {string} encrypt - Encrypted message string
   * @returns {boolean}
   */
  verifySignature(msgSignature, timestamp, nonce, encrypt) {
    const computed = this.getSignature(timestamp, nonce, encrypt);
    try {
      return crypto.timingSafeEqual(
        Buffer.from(computed, 'utf8'),
        Buffer.from(msgSignature, 'utf8')
      );
    } catch {
      // Length mismatch → definitely not equal
      return false;
    }
  }

  /**
   * Decrypt a WeChat Work encrypted message.
   *
   * Decrypted layout: random(16) + msgLength(4, big-endian) + msg + receiveid
   * Uses AES-256-CBC with manual PKCS#7 unpadding (32-byte block size).
   *
   * @param {string} encrypt - Base64-encoded encrypted string
   * @returns {string} Decrypted plaintext message
   * @throws {WecomCryptoError}
   */
  decrypt(encrypt) {
    try {
      const encrypted = Buffer.from(encrypt, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
      decipher.setAutoPadding(false);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      // Remove PKCS#7 padding (WeChat uses 32-byte block size)
      const padLength = decrypted[decrypted.length - 1];
      if (padLength < 1 || padLength > 32 || padLength > decrypted.length) {
        throw new WecomCryptoError(
          `Invalid PKCS#7 padding value: ${padLength}`,
          ErrorCodes.DECRYPT_FAILED
        );
      }
      for (let i = decrypted.length - padLength; i < decrypted.length; i++) {
        if (decrypted[i] !== padLength) {
          throw new WecomCryptoError(
            'Invalid PKCS#7 padding bytes',
            ErrorCodes.DECRYPT_FAILED
          );
        }
      }
      const unpadded = decrypted.subarray(0, decrypted.length - padLength);

      // Layout: random(16) + msgLength(4) + msg + receiveid
      if (unpadded.length < 20) {
        throw new WecomCryptoError(
          'Decrypted data too short',
          ErrorCodes.DECRYPT_FAILED
        );
      }
      const msgLength = unpadded.readUInt32BE(16);
      if (msgLength > unpadded.length - 20) {
        throw new WecomCryptoError(
          `Message length ${msgLength} exceeds buffer size`,
          ErrorCodes.DECRYPT_FAILED
        );
      }
      const msg = unpadded.subarray(20, 20 + msgLength).toString('utf8');
      const receiveid = unpadded.subarray(20 + msgLength).toString('utf8');

      // Validate receiveid matches our corpId
      if (receiveid !== this.corpId) {
        throw new WecomCryptoError(
          'receiveid does not match configured corpId',
          ErrorCodes.INVALID_CORPID
        );
      }

      return msg;
    } catch (error) {
      if (error instanceof WecomCryptoError) {
        throw error;
      }
      throw new WecomCryptoError(
        `Decryption failed: ${error.message}`,
        ErrorCodes.DECRYPT_FAILED
      );
    }
  }

  /**
   * Encrypt a reply message for WeChat Work.
   *
   * Layout: random(16) + msgLength(4, big-endian) + msg + receiveid + PKCS#7 padding
   *
   * @param {string} replyMsg - Plaintext reply message
   * @returns {string} Base64-encoded encrypted string
   * @throws {WecomCryptoError}
   */
  encrypt(replyMsg) {
    try {
      const msgBuf = Buffer.from(replyMsg, 'utf8');
      const receiveidBuf = Buffer.from(this.corpId, 'utf8');

      // random(16) + msgLength(4) + msg + receiveid
      const randomBytes = crypto.randomBytes(16);
      const msgLenBuf = Buffer.alloc(4);
      msgLenBuf.writeUInt32BE(msgBuf.length, 0);

      const plaintext = Buffer.concat([randomBytes, msgLenBuf, msgBuf, receiveidBuf]);

      // PKCS#7 padding with 32-byte block size
      const blockSize = 32;
      const padLength = blockSize - (plaintext.length % blockSize);
      const padding = Buffer.alloc(padLength, padLength);
      const padded = Buffer.concat([plaintext, padding]);

      const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.iv);
      cipher.setAutoPadding(false);

      const encrypted = Buffer.concat([
        cipher.update(padded),
        cipher.final(),
      ]);

      return encrypted.toString('base64');
    } catch (error) {
      if (error instanceof WecomCryptoError) {
        throw error;
      }
      throw new WecomCryptoError(
        `Encryption failed: ${error.message}`,
        ErrorCodes.ENCRYPT_FAILED
      );
    }
  }
}

module.exports = {
  WecomCrypto,
  WecomCryptoError,
  extractXmlField,
};
