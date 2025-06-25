// server/chat-log.js
const fs   = require('fs');
const path = require('path');

// Path to your rolling chat log
const logFile = path.join(__dirname, 'chat.log');

/**
 * Append a chat entry to the log file.
 *
 * @param {Object} params
 * @param {string} params.user      Username or user-ID
 * @param {string} params.message   The message text
 * @param {string} [params.timestamp]  Optional ISO timestamp; defaults to now
 */
function logMessage({ user, message, timestamp }) {
  const time   = timestamp || new Date().toISOString();
  const entry  = `[${time}] ${user}: ${message}\n`;
  fs.appendFile(logFile, entry, err => {
    if (err) console.error('⚠️ Failed to write chat log:', err);
  });
}

module.exports = { logMessage };
