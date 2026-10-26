'use strict';
// Best-effort web haptics. An API accepting a pulse is not proof the hardware vibrated.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createLumenHaptics = factory;
})(typeof window === 'object' ? window : globalThis, function createHaptics({ navigator, storage, visible = () => true, now = () => performance.now() }) {
  const patterns = { selection: 10, impact: 18, primary: [12, 40, 12] };
  const supported = typeof navigator?.vibrate === 'function';
  let enabled = true;
  let last = -Infinity;
  try { enabled = storage?.getItem('lumen-haptics') !== 'off'; } catch { /* private/restricted storage */ }
  function cancel() {
    if (supported) try { navigator.vibrate(0); } catch { /* optional hardware */ }
  }
  return {
    supported,
    get enabled() { return enabled; },
    setEnabled(value) {
      enabled = !!value;
      try { storage?.setItem('lumen-haptics', enabled ? 'on' : 'off'); } catch { /* retain in memory */ }
      if (!enabled) cancel();
    },
    trigger(kind = 'selection', force = false) {
      if (!supported || !enabled || !visible()) return false;
      const time = now();
      if (!force && time - last < 80) return false;
      last = time;
      try { return navigator.vibrate(patterns[kind] || patterns.selection) !== false; } catch { return false; }
    },
    cancel
  };
});
