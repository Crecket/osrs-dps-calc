import { describe, expect, test } from '@jest/globals';
import v8 from 'node:v8';
import RootStore from '@/state/RootStore';
import { BulkStore, PresetStorage } from '@/bulk/state/BulkStore';
import SetupSync from '@/bulk/state/SetupSync';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { availableEquipment } from '@/lib/Equipment';

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

const setup = async () => {
  const bulk = new BulkStore(new MemoryStorage());
  await bulk.load();
  const target = bulk.active!.setups.find((s) => s.name === 'Max scythe')!;
  const calc = new RootStore();
  const sync = new SetupSync(bulk, calc, target.id, 0);
  sync.start();
  const current = () => bulk.active!.setups.find((s) => s.id === target.id)!.player;
  return {
    bulk, calc, sync, current,
  };
};

describe('SetupSync', () => {
  test('loads the setup into the panel', async () => {
    const { calc, sync } = await setup();
    expect(calc.loadouts.currentLoadout.equipment.weapon?.id).toBe(22325);
    expect(calc.loadouts.currentLoadout.prayers).toContain(Prayer.PIETY);
    sync.dispose();
  });

  test('toggling a prayer in the panel changes the setup', async () => {
    const { calc, sync, current } = await setup();
    calc.loadouts.currentLoadout.togglePrayer(Prayer.PIETY);
    expect(current().prayers).not.toContain(Prayer.PIETY);
    sync.dispose();
  });

  test('toggling a potion recomputes and saves the boosts', async () => {
    const { calc, sync, current } = await setup();
    calc.loadouts.currentLoadout.togglePotion(Potion.SUPER_COMBAT);
    expect(current().buffs.potions).toEqual([]);
    expect(current().boosts.str).toBe(0);
    sync.dispose();
  });

  test('changing a level changes the setup and its boosts', async () => {
    const { calc, sync, current } = await setup();
    calc.loadouts.currentLoadout.setSkills({ str: 80 });
    expect(current().skills.str).toBe(80);
    expect(current().boosts.str).toBeLessThan(19);
    sync.dispose();
  });

  test('opening a setup does not change it, even when its saved stats are out of date', async () => {
    const { bulk, current, calc } = await setup();
    bulk.updateSetupPlayer(bulk.active!.setups.find((s) => s.name === 'Max scythe')!.id, { ...current(), attackSpeed: 99 });
    const saved = current();
    const before = bulk.active!.updatedAt;

    const reopened = new SetupSync(bulk, calc, bulk.active!.setups.find((s) => s.name === 'Max scythe')!.id, 0);
    reopened.start();

    expect(current()).toBe(saved);
    expect(bulk.active!.updatedAt).toBe(before);
    reopened.dispose();
  });

  test('an edit made elsewhere reaches the panel', async () => {
    const {
      bulk, calc, sync, current,
    } = await setup();
    bulk.updateSetupPlayer(bulk.active!.setups.find((s) => s.name === 'Max scythe')!.id, { ...current(), prayers: [] });
    expect(calc.loadouts.currentLoadout.prayers).toEqual([]);
    sync.dispose();
  });

  test('the setup keeps its name and gear', async () => {
    const { calc, sync, current } = await setup();
    calc.loadouts.currentLoadout.togglePrayer(Prayer.PIETY);
    expect(current().name).toBe('Max scythe');
    expect(current().equipment.weapon?.id).toBe(22325);
    sync.dispose();
  });

  test('changing gear in the panel changes the setup and its bonuses', async () => {
    const { calc, sync, current } = await setup();
    const before = current().offensive.slash;
    calc.loadouts.currentLoadout.setEquipment({ weapon: availableEquipment.find((e) => e.id === 4151)! });

    expect(current().equipment.weapon?.name).toBe('Abyssal whip');
    expect(current().offensive.slash).not.toBe(before);
    sync.dispose();
  });
});
