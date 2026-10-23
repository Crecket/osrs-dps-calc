import { describe, expect, test } from '@jest/globals';
import v8 from 'node:v8';
import { GlobalState } from '@/state';
import { BulkStore, PresetStorage } from '@/bulk/state/BulkStore';
import TargetSync from '@/bulk/state/TargetSync';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';

class MemoryStorage implements PresetStorage {
  data = new Map<string, unknown>();

  async getItem<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }

  async setItem<T>(key: string, value: T): Promise<T> {
    this.data.set(key, v8.deserialize(v8.serialize(value)));
    return value;
  }
}

const byName = (name: string) => monsterFromSearch(getMonsters().find((m) => m.name === name)!);

const setup = async () => {
  const bulk = new BulkStore(new MemoryStorage());
  await bulk.load();
  const calc = new GlobalState();
  const sync = new TargetSync(bulk, calc, 0);
  return { bulk, calc, sync };
};

describe('TargetSync', () => {
  test("loads the preset's target into the panel", async () => {
    const { bulk, calc, sync } = await setup();
    bulk.setMonster(byName('Vasa Nistirio'));
    sync.start();

    expect(calc.monster.name).toBe('Vasa Nistirio');
    sync.dispose();
  });

  test('settings changed in the panel become the target', async () => {
    const { bulk, calc, sync } = await setup();
    bulk.setMonster(byName('Vasa Nistirio'));
    sync.start();

    calc.updateMonster({ inputs: { isFromCoxCm: true, partySize: 3 } });

    expect(bulk.active?.monster?.monster.inputs.isFromCoxCm).toBe(true);
    expect(bulk.active?.monster?.monster.inputs.partySize).toBe(3);
    sync.dispose();
  });

  test('picking another monster in the panel replaces the target', async () => {
    const { bulk, calc, sync } = await setup();
    sync.start();

    const vorkath = getMonsters().find((m) => m.name === 'Vorkath')!;
    calc.updateMonster(vorkath);

    expect(bulk.active?.monster?.monster.name).toBe('Vorkath');
    sync.dispose();
  });

  test('switching preset shows that preset’s target', async () => {
    const { bulk, calc, sync } = await setup();
    bulk.setMonster(byName('Vasa Nistirio'));
    const first = bulk.activeId!;
    bulk.createPreset('Second');
    bulk.setMonster(byName('Vorkath'));
    sync.start();

    bulk.setActive(first);

    expect(calc.monster.name).toBe('Vasa Nistirio');
    expect(bulk.active?.monster?.monster.name).toBe('Vasa Nistirio');
    sync.dispose();
  });

  test('loading a target does not count as an edit', async () => {
    const { bulk, sync } = await setup();
    bulk.setMonster(byName('Vasa Nistirio'));
    const before = bulk.active!.updatedAt;
    const id = bulk.active!.monster!.id;
    sync.start();

    expect(bulk.active!.updatedAt).toBe(before);
    expect(bulk.active!.monster!.id).toBe(id);
    sync.dispose();
  });
});
