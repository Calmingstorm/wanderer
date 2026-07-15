import { PrimeReactProvider } from 'primereact/api';
import { ErrorBoundary } from 'react-error-boundary';

import { Command, Commands, MapHandlers } from '@/hooks/Mapper/types/mapHandlers.ts';
import { ErrorInfo, useCallback, useEffect, useRef } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { useMapperHandlers } from './useMapperHandlers';

import { MapRootContent } from '@/hooks/Mapper/components/mapRootContent/MapRootContent.tsx';
import { MapRootProvider } from '@/hooks/Mapper/mapRootProvider';
import './common-styles/main.scss';
import { ToastProvider } from '@/hooks/Mapper/ToastProvider.tsx';

const ErrorFallback = () => {
  return <div className="!z-100 absolute w-screen h-screen bg-transparent"></div>;
};

const isCommand = (value: string): value is Command => Object.values(Commands).includes(value as Commands);

export interface MapEventPayload {
  type: string;
  body: unknown;
}

export interface MapperHooks {
  handleEvent: (event: string, handler: (payload: unknown) => void) => void;
  pushEvent: (event: string, payload: unknown) => unknown;
  pushEventAsync: <T = unknown>(event: string, payload: unknown) => Promise<T>;
  onError: (error: Error, componentStack: string | null | undefined) => void;
}

interface MapRootProps {
  hooks: MapperHooks;
}

export default function MapRoot({ hooks }: MapRootProps) {
  const providerRef = useRef<MapHandlers>(null);
  const hooksRef = useRef<MapperHooks>(hooks);

  const mapperHandlerRefs = useRef([providerRef]);

  const { handleCommand, handleMapEvent } = useMapperHandlers(mapperHandlerRefs.current, hooksRef);

  const logError = useCallback((error: Error, info: ErrorInfo) => {
    if (!hooksRef.current) {
      return;
    }
    hooksRef.current.onError(error, info.componentStack);
  }, []);

  useEffect(() => {
    if (!hooksRef.current) {
      return;
    }

    hooksRef.current.handleEvent('map_event', payload => {
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'type' in payload &&
        typeof payload.type === 'string' &&
        isCommand(payload.type) &&
        'body' in payload
      ) {
        handleMapEvent({ type: payload.type, body: payload.body });
      }
    });
  }, []);

  return (
    <PrimeReactProvider>
      <ToastProvider>
        <MapRootProvider fwdRef={providerRef} outCommand={handleCommand}>
          <ErrorBoundary FallbackComponent={ErrorFallback} onError={logError}>
            <ReactFlowProvider>
              <MapRootContent />
            </ReactFlowProvider>
          </ErrorBoundary>
        </MapRootProvider>
      </ToastProvider>
    </PrimeReactProvider>
  );
}
