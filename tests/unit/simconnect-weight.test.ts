import { afterEach, describe, expect, it, vi } from 'vitest';
import { open } from 'node-simconnect';
import { SimConnectSource } from '../../adapters/electron/simconnect-source';
import type { SimSample } from '../../core/sim';

vi.mock('node-simconnect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node-simconnect')>()),
  open: vi.fn(),
}));

afterEach(() => vi.useRealTimers());

describe('SimConnect flying weight', () => {
  it('reads TOTAL WEIGHT in kg from the user aircraft sample and leaves old timestamps unchanged', async () => {
    vi.useFakeTimers();
    const events = new Map<string, (...args: any[]) => void>();
    const handle = {
      addToDataDefinition: vi.fn(),
      requestDataOnSimObject: vi.fn(),
      requestSystemState: vi.fn(),
      subscribeToSystemEvent: vi.fn(),
      clearDataDefinition: vi.fn(),
      close: vi.fn(),
      on: vi.fn((event, cb) => events.set(event, cb)),
    };
    vi.mocked(open).mockResolvedValue({ recvOpen: { applicationName: 'fixture' }, handle } as unknown as Awaited<ReturnType<typeof open>>);
    const source = new SimConnectSource();
    const samples: SimSample[] = [];
    source.start(sample => samples.push(sample));
    try {
      await vi.advanceTimersByTimeAsync(0);
      const definition = handle.addToDataDefinition.mock.calls.filter(call => call[0] === 1);
      expect(definition.map(call => [call[1], call[2]])).toEqual([
        ['AIRSPEED INDICATED', 'knots'], ['FLAPS HANDLE INDEX', 'number'],
        ['FLAPS NUM HANDLE POSITIONS', 'number'], ['FLAPS HANDLE PERCENT', 'percent over 100'],
        ['SIM ON GROUND', 'bool'], ['TOTAL WEIGHT', 'kilograms'], ['PLANE ALT ABOVE GROUND', 'feet'],
        ['AMBIENT WIND VELOCITY', 'knots'], ['WING SPAN','meters'], ['TITLE', null],
      ]);
      const receive = (weight: number, title = 'fixture') => {
        const values = [75, 2, 8, 0.25, 0, weight, 637.5, 14.25, 18];
        events.get('simObjectData')!({
          requestID: 1,
          data: { readFloat64: () => values.shift(), readString256: () => title },
        });
      };
      receive(537.25);
      expect(samples.at(-1)).toMatchObject({ totalWeightKg: 537.25, aglFt: 637.5, windKt: 14.25, iasKt: 75, flapIndex: 2, aircraftTitle: 'fixture' });
      const req = handle.requestSystemState.mock.calls.at(-1)![0];
      expect(handle.requestSystemState).toHaveBeenCalledWith(req,'AircraftLoaded');
      events.get('systemState')!({requestID:req,dataString:'C:/fixture/SimObjects/Airplanes/publisher_model/aircraft.cfg'});
      receive(537.25);
      expect(samples.at(-1)).toMatchObject({aircraftContainer:'publisher_model',wingSpanM:18});
      receive(500,'another');
      const next = handle.requestSystemState.mock.calls.at(-1)![0];
      expect(next).not.toBe(req);
      events.get('systemState')!({requestID:req,dataString:'C:/fixture/SimObjects/Airplanes/old_model/aircraft.cfg'});
      receive(500,'another');
      expect(samples.at(-1)?.aircraftContainer).toBeNull();
      events.get('systemState')!({requestID:next,dataString:'C:/fixture/SimObjects/Airplanes/new_model/aircraft.cfg'});
      receive(500,'another');
      expect(samples.at(-1)?.aircraftContainer).toBe('new_model');
      const timestamp = samples.at(-1)!.t;
      await vi.advanceTimersByTimeAsync(2000);
      expect(samples.at(-1)!.t).toBe(timestamp);
      for (const invalid of [0, -1, NaN, Infinity]) {
        receive(invalid);
        expect(samples.at(-1)!.totalWeightKg).toBeNull();
      }
      receive(400);
      expect(samples.at(-1)!.totalWeightKg).toBe(400);
      events.get('quit')!();
      expect(samples.at(-1)).toMatchObject({ connected: false, totalWeightKg: null });
    } finally {
      source.stop();
    }
  });
});
