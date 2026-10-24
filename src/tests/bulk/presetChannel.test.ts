import {
  afterEach, describe, expect, jest, test,
} from '@jest/globals';
import { notifyPresetsChanged, onPresetsChanged, PRESETS_CHANNEL } from '@/bulk/state/presetChannel';

// a BroadcastChannel stand-in: like the real one, a message reaches every other channel of the same name
const channels: FakeChannel[] = [];
class FakeChannel {
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(public name: string) { channels.push(this); }

  postMessage(data: unknown) {
    channels.filter((c) => c !== this && c.name === this.name).forEach((c) => c.onmessage?.({ data }));
  }

  close() { channels.splice(channels.indexOf(this), 1); }
}

describe('presetChannel', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel;
    channels.length = 0;
  });

  test('a change notice reaches listeners until they stop listening', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).BroadcastChannel = FakeChannel;
    const listener = jest.fn();
    const stop = onPresetsChanged(listener);
    notifyPresetsChanged();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(channels.every((c) => c.name === PRESETS_CHANNEL)).toBe(true);

    stop();
    notifyPresetsChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('does nothing without BroadcastChannel', () => {
    const listener = jest.fn();
    const stop = onPresetsChanged(listener);
    expect(() => notifyPresetsChanged()).not.toThrow();
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});
