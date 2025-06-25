// mods.js

/**
 * In-memory set of banned user IDs
 * @type {Set<string>}
 */
const banned = new Set();

/**
 * Ban a user.
 * @param {string} userId
 */
function banUser(userId) {
  banned.add(userId);
}

/**
 * Unban a user.
 * @param {string} userId
 */
function unbanUser(userId) {
  banned.delete(userId);
}

// server/mods.js

// In-memory sets for banned users and IPs
const bannedUsers = new Set();
const bannedIPs   = new Set();

/** Ban by user ID (if you ever have one) */
function banUser(userId) {
  bannedUsers.add(userId);
}

/** Ban by IP */
function banIP(ip) {
  bannedIPs.add(ip);
}

function unbanUser(userId) {
  bannedUsers.delete(userId);
}

function unbanIP(ip) {
  bannedIPs.delete(ip);
}

function isBanned(userId) {
  return bannedUsers.has(userId);
}

function isIPBanned(ip) {
  return bannedIPs.has(ip);
}

/** Hook into Socket.IO to reject banned users or IPs */
function applyModMiddleware(io) {
  io.use((socket, next) => {
    const { userId } = socket.handshake.auth || {};
    const ip = socket.handshake.address;

    if ((userId && isBanned(userId)) || isIPBanned(ip)) {
      return next(new Error('You are banned'));
    }
    next();
  });
}

module.exports = {
  applyModMiddleware,
  banUser,
  unbanUser,
  isBanned,
  banIP,
  unbanIP,
  isIPBanned,
};

