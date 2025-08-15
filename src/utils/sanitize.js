// Utility to sanitize logs to avoid leaking sensitive data
// - Redacts phone numbers (international and local forms)
// - Redacts WhatsApp JIDs (e.g., 1234567890@s.whatsapp.net)
// - Redacts file paths and file names
// - Truncates long strings

const PHONE_REGEX = /\+?\d[\d\s\-()]{6,}\d/g; // loose phone matcher
const JID_REGEX = /\b\d{5,}@s\.whatsapp\.net\b/gi;
const FILE_PATH_REGEX = /([A-Za-z]:\\[^\s"']+|\/[\w\-\.\/@]+|\\[\w\-\.\\@]+)/g; // windows + posix-ish

function redact(input) {
  if (typeof input !== 'string') {
    try {
      input = JSON.stringify(input);
    } catch {
      input = String(input);
    }
  }
  let out = input;
  out = out.replace(JID_REGEX, '[REDACTED_JID]');
  out = out.replace(PHONE_REGEX, '[REDACTED_PHONE]');
  out = out.replace(FILE_PATH_REGEX, '[REDACTED_PATH]');
  return out;
}

function truncate(input, max = 120) {
  if (input.length <= max) return input;
  return input.slice(0, max) + `... [${input.length - max} more chars]`;
}

function sanitizeLog(value) {
  const redacted = redact(value);
  const preview = truncate(redacted);
  return {
    redacted,
    preview,
    summary: `len=${String(value).length}, preview="${preview}"`
  };
}

module.exports = { sanitizeLog, redact, truncate };
