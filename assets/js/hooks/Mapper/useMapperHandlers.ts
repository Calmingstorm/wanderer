import usePageVisibility from '@/hooks/Mapper/hooks/usePageVisibility.ts';
import debounce from 'lodash.debounce';

import { Command, MapHandlers, OutCommandHandler } from '@/hooks/Mapper/types/mapHandlers.ts';
import type { MapperHooks } from '@/hooks/Mapper/MapRoot.tsx';
import { RefObject, useCallback, useEffect, useRef } from 'react';

// const inIndex = 0;
// const prevEventTime = +new Date();
const LAST_VERSION_KEY = 'wandererLastVersion';

type MapEvent = { type: Command; body: unknown };

export const useMapperHandlers = (handlerRefs: RefObject<MapHandlers>[], hooksRef: RefObject<MapperHooks>) => {
  const visible = usePageVisibility();

  const wasHiddenOnce = useRef(false);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // TODO - do not delete THIS code it needs for debug
  // const [record, setRecord] = useLocalStorageState<boolean>('record', {
  //   defaultValue: false,
  // });
  // const [recordsList, setRecordsList] = useLocalStorageState<{ type; data }[]>('recordsList', {
  //   defaultValue: [],
  // });
  //
  // const ref = useRef({ record, setRecord, recordsList, setRecordsList });
  // ref.current = { record, setRecord, recordsList, setRecordsList };
  //
  // const recordBufferRef = useRef<{ type; data }[]>([]);
  // useEffect(() => {
  //   if (record || recordBufferRef.current.length === 0) {
  //     return;
  //   }
  //
  //   ref.current.setRecordsList([...recordBufferRef.current]);
  //   recordBufferRef.current = [];
  // }, [record]);

  const handleCommand: OutCommandHandler = useCallback(
    async <T = unknown>({ type, data }: Parameters<OutCommandHandler>[0]): Promise<T> => {
      if (!hooksRef.current) {
        throw new Error('Mapper hook is unavailable');
      }

      // TODO - do not delete THIS code it needs for debug
      // console.log('JOipP', `OUT`, ref.current.record, { type, data });
      // if (ref.current.record) {
      //   recordBufferRef.current.push({ type, data });
      // }

      // 'ui_loaded'
      return await hooksRef.current.pushEventAsync<T>(type, data);
    },
    [hooksRef.current],
  );

  const eventsBufferRef = useRef<MapEvent[]>([]);

  const eventTick = useCallback(
    debounce(() => {
      if (eventsBufferRef.current.length === 0) {
        return;
      }

      const { type, body } = eventsBufferRef.current.shift()!;
      handlerRefs.forEach(ref => {
        if (!ref.current) {
          return;
        }

        ref.current?.command(type, body);
      });

      // TODO - do not delete THIS code it needs for debug
      // console.log('JOipP', `Tick Buff`, eventsBufferRef.current.length);

      if (eventsBufferRef.current.length > 0) {
        eventTick();
      }
    }, 10),
    [],
  );
  const eventTickRef = useRef(eventTick);
  eventTickRef.current = eventTick;

  const handleMapEvent = useCallback(({ type, body }: MapEvent) => {
    // TODO - do not delete THIS code it needs for debug
    // const currentTime = +new Date();
    // const timeDiff = currentTime - prevEventTime;
    // prevEventTime = currentTime;
    // console.log('JOipP', `IN [${inIndex++}] [${timeDiff}] ${getFormattedTime()}`, { type, body });

    if (!eventTickRef.current || !visibleRef.current) {
      return;
    }

    eventsBufferRef.current.push({ type, body });
    eventTickRef.current();
  }, []);

  useEffect(() => {
    if (!visible && !wasHiddenOnce.current) {
      wasHiddenOnce.current = true;
      return;
    }

    if (!wasHiddenOnce.current) {
      return;
    }

    if (!visible) {
      return;
    }

    hooksRef.current?.pushEventAsync('ui_loaded', { version: localStorage.getItem(LAST_VERSION_KEY) });
  }, [hooksRef.current, visible]);

  return { handleCommand, handleMapEvent };
};
