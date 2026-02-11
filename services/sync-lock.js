/**
 * Global sync lock to prevent concurrent manual and auto sync
 */

let isSyncing = false;

function acquireLock() {
  if (isSyncing) {
    return false;
  }
  isSyncing = true;
  return true;
}

function releaseLock() {
  isSyncing = false;
}

function isLocked() {
  return isSyncing;
}

module.exports = {
  acquireLock,
  releaseLock,
  isLocked
};
