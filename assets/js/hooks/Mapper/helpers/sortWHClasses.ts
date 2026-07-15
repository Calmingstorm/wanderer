import { WORMHOLES_ADDITIONAL_INFO } from '@/hooks/Mapper/components/map/constants.ts';
import { WormholeDataRaw } from '@/hooks/Mapper/types';

export const sortWHClasses = (wormholesData: Record<string, WormholeDataRaw>, statics: string[]) => {
  if (!statics || !wormholesData) {
    return [];
  }

  return statics
    .map(x => wormholesData[x])
    .filter(x => !!x)
    .map(x => ({
      name: x.name,
      ...(x.dest.length === 1 ? WORMHOLES_ADDITIONAL_INFO[x.dest[0]] : undefined),
    }))
    .sort((a, b) => (a.wormholeClassID ?? Infinity) - (b.wormholeClassID ?? Infinity))
    .map(x => x.name);
};
