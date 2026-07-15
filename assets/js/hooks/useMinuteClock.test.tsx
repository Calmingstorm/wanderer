import { act, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useMinuteClock } from './useMinuteClock';

const START = new Date('2026-07-15T13:00:15.250Z').getTime();
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe('useMinuteClock', () => {
  let container: HTMLDivElement;
  let root: Root;
  let observedTimes: number[];

  function Probe() {
    const now = useMinuteClock();

    useEffect(() => {
      observedTimes.push(now);
    }, [now]);

    return null;
  }

  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.setSystemTime(START);
    container = document.createElement('div');
    root = createRoot(container);
    observedTimes = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    jest.useRealTimers();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('ticks on minute boundaries and schedules the next boundary without drift', () => {
    act(() => root.render(<Probe />));

    expect(observedTimes).toEqual([START]);
    expect(jest.getTimerCount()).toBe(1);

    act(() => jest.advanceTimersByTime(44_749));
    expect(observedTimes).toEqual([START]);

    act(() => jest.advanceTimersByTime(1));
    expect(observedTimes).toEqual([START, new Date('2026-07-15T13:01:00.000Z').getTime()]);

    act(() => jest.advanceTimersByTime(60_000));
    expect(observedTimes).toEqual([
      START,
      new Date('2026-07-15T13:01:00.000Z').getTime(),
      new Date('2026-07-15T13:02:00.000Z').getTime(),
    ]);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('cleans up its pending timeout on unmount', () => {
    act(() => root.render(<Probe />));
    expect(jest.getTimerCount()).toBe(1);

    act(() => root.unmount());

    expect(jest.getTimerCount()).toBe(0);
  });
});
