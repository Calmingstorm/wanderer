import { CharacterTypeRaw, SolarSystemRawType } from '@/hooks/Mapper/types';

export type SignaturePasteLocationWarning = {
  activeCharacterName: string;
  currentMapSystemId: string | null;
  currentSystemName: string;
  currentSolarSystemId: number;
  selectedMapSystemId: string;
  selectedSystemName: string;
  selectedSolarSystemId: number;
};

type SignaturePasteGuardInput = {
  characters: CharacterTypeRaw[];
  followingCharacterEveId: string | null;
  mainCharacterEveId: string | null;
  selectedMapSystemId: string | undefined;
  systems: SolarSystemRawType[];
  userCharacters: string[];
};

const getDisplayName = (system: SolarSystemRawType | undefined, fallbackSolarSystemId: number): string => {
  if (!system) return `solar system ${fallbackSolarSystemId}`;

  const canonicalName = system.system_static_info.solar_system_name;
  const alias = system.temporary_name || system.name;

  if (alias && alias !== canonicalName) {
    return `${alias} (${canonicalName})`;
  }

  return alias || canonicalName || `solar system ${fallbackSolarSystemId}`;
};

const getActiveCharacter = ({
  characters,
  followingCharacterEveId,
  mainCharacterEveId,
  userCharacters,
}: Omit<SignaturePasteGuardInput, 'selectedMapSystemId' | 'systems'>): CharacterTypeRaw | null => {
  const ownCharacterIds = new Set(userCharacters);
  const preferredIds = [followingCharacterEveId, mainCharacterEveId].filter(
    (id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index,
  );

  for (const characterId of preferredIds) {
    const character = characters.find(
      candidate =>
        candidate.eve_id === characterId &&
        ownCharacterIds.has(candidate.eve_id) &&
        candidate.online &&
        candidate.location?.solar_system_id != null,
    );

    if (character) return character;
  }

  const ownOnlineCharactersWithLocations = characters.filter(
    character =>
      ownCharacterIds.has(character.eve_id) && character.online && character.location?.solar_system_id != null,
  );

  return ownOnlineCharactersWithLocations.length === 1 ? ownOnlineCharactersWithLocations[0] : null;
};

/**
 * Mirrors Pathfinder's signature-reader safety check without pretending the
 * clipboard tells us which character produced it. The mapper's followed
 * character is the best equivalent to Pathfinder's active character, followed
 * by the configured main character. If neither is usable, a single online own
 * character is safe to use; ambiguous or stale location data produces no
 * warning.
 */
export const getSignaturePasteLocationWarning = ({
  characters,
  followingCharacterEveId,
  mainCharacterEveId,
  selectedMapSystemId,
  systems,
  userCharacters,
}: SignaturePasteGuardInput): SignaturePasteLocationWarning | null => {
  if (!selectedMapSystemId) return null;

  const selectedSystem = systems.find(system => system.id === selectedMapSystemId);
  if (!selectedSystem) return null;

  const activeCharacter = getActiveCharacter({
    characters,
    followingCharacterEveId,
    mainCharacterEveId,
    userCharacters,
  });
  if (!activeCharacter || activeCharacter.location?.solar_system_id == null) return null;

  const currentSolarSystemId = activeCharacter.location.solar_system_id;

  const selectedSolarSystemId = selectedSystem.system_static_info.solar_system_id;
  if (selectedSolarSystemId === currentSolarSystemId) return null;

  const currentSystem = systems.find(system => system.system_static_info.solar_system_id === currentSolarSystemId);

  return {
    activeCharacterName: activeCharacter.name,
    currentMapSystemId: currentSystem?.id ?? null,
    currentSystemName: getDisplayName(currentSystem, currentSolarSystemId),
    currentSolarSystemId,
    selectedMapSystemId,
    selectedSystemName: getDisplayName(selectedSystem, selectedSolarSystemId),
    selectedSolarSystemId,
  };
};
