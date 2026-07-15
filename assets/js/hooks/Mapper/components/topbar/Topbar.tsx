import { sortOnlineFunc } from '@/hooks/Mapper/components/hooks/useGetOwnOnlineCharacters.ts';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { WithChildren } from '@/hooks/Mapper/types/common.ts';
import clsx from 'clsx';
import { useMemo } from 'react';
import { Characters } from '../characters/Characters';
import classes from './Topbar.module.scss';

const Topbar = ({ children }: WithChildren) => {
  const {
    data: { characters, userCharacters, systems, selectedSystems, map_slug: mapSlug },
  } = useMapRootState();

  const charsToShow = useMemo(() => {
    return characters.filter(x => userCharacters.includes(x.eve_id)).sort(sortOnlineFunc);
  }, [characters, userCharacters]);

  const onlineCount = useMemo(() => charsToShow.filter(character => character.online).length, [charsToShow]);
  const selectedSystem = useMemo(
    () => (selectedSystems.length === 1 ? systems.find(system => system.id === selectedSystems[0]) : null),
    [selectedSystems, systems],
  );

  return (
    <nav className={clsx(classes.Topbar, 'pointer-events-auto')} aria-label="Map command bar">
      <div className={classes.ContextBlock}>
        <div className={classes.Eyebrow}>Active chain</div>
        <div className={classes.MapName}>{mapSlug || 'Wanderer map'}</div>
      </div>

      <div className={classes.SelectionBlock}>
        <span className={classes.SelectionLabel}>Focus</span>
        <strong>{selectedSystem?.name || selectedSystem?.temporary_name || 'Select a system'}</strong>
      </div>

      <div className={classes.ActionSlot}>{children}</div>

      <div className={classes.CrewBlock}>
        <span className={classes.CrewStatus}>
          <i /> {onlineCount} online
        </span>
        <Characters data={charsToShow} />
      </div>
    </nav>
  );
};

// eslint-disable-next-line react/display-name
export default Topbar;
