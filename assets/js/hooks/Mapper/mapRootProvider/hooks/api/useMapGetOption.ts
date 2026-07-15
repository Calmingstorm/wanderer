import { useMemo } from 'react';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { MapOptions } from '@/hooks/Mapper/types';

export const useMapGetOption = <K extends keyof MapOptions>(option: K): MapOptions[K] => {
  const {
    data: { options },
  } = useMapRootState();

  return useMemo(() => options[option], [option, options]);
};
