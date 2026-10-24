/**
 * Tells open bulk tool tabs that the saved presets changed in another page (the best setup page adds setups), so they
 * read them again instead of overwriting them with their own copy on their next save. Without BroadcastChannel (jsdom,
 * old browsers) both ends do nothing.
 */
export const PRESETS_CHANNEL = 'bulk-presets';

const hasChannel = () => typeof BroadcastChannel !== 'undefined';

export const notifyPresetsChanged = () => {
  if (!hasChannel()) return;
  const channel = new BroadcastChannel(PRESETS_CHANNEL);
  channel.postMessage('changed');
  channel.close();
};

/** Calls `listener` on every change notice from another page or tab; returns the function that stops listening. */
export const onPresetsChanged = (listener: () => void): (() => void) => {
  if (!hasChannel()) return () => {};
  const channel = new BroadcastChannel(PRESETS_CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
};
