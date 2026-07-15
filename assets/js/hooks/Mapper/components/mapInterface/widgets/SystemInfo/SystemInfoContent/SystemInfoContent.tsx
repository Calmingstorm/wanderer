import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { isWormholeSpace } from '@/hooks/Mapper/components/map/helpers/isWormholeSpace.ts';
import { useMemo } from 'react';
import { useMinuteClock } from '@/hooks/useMinuteClock';
import { getSystemById, sortWHClasses } from '@/hooks/Mapper/helpers';
import { InfoDrawer, MarkdownTextViewer, TimeAgo, WHClassView, WHEffectView } from '@/hooks/Mapper/components/ui-kit';
import { getSystemStaticInfo } from '@/hooks/Mapper/mapRootProvider/hooks/useLoadSystemStatic';
import { buildPilotIntelSnapshot } from '@/hooks/Mapper/helpers/pilotIntel';
import type { IntelFreshness, IntelRisk } from '@/hooks/Mapper/helpers/pilotIntel';
import clsx from 'clsx';
import classes from './SystemInfoContent.module.scss';

interface SystemInfoContentProps {
  systemId: string;
  onEditClick?(): void;
}

const FRESHNESS_LABELS: Record<IntelFreshness, string> = {
  fresh: 'Fresh',
  aging: 'Aging',
  stale: 'Stale',
  unknown: 'No scan time',
};

const RISK_LABELS: Record<IntelRisk, string> = {
  danger: 'Danger',
  caution: 'Caution',
  watch: 'Watch',
  nominal: 'No active flags',
  unknown: 'Intel incomplete',
};

export const SystemInfoContent = ({ systemId }: SystemInfoContentProps) => {
  const {
    data: { systems, wormholesData, systemSignatures, detailedKills, connections, characters },
  } = useMapRootState();

  const sys = getSystemById(systems, systemId)! || {};
  const systemStaticInfo = getSystemStaticInfo(systemId)!;
  const { description } = sys;
  const { system_class, region_name, constellation_name, statics, effect_name, effect_power } = systemStaticInfo || {};
  const isWH = isWormholeSpace(system_class);
  const sortedStatics = useMemo(() => sortWHClasses(wormholesData, statics), [wormholesData, statics]);
  const now = useMinuteClock();

  const hasKillCoverage = Object.prototype.hasOwnProperty.call(detailedKills, systemId);
  const intel = useMemo(
    () =>
      buildPilotIntelSnapshot({
        systemId,
        signatures: systemSignatures[systemId] || [],
        kills: detailedKills[systemId] || [],
        connections,
        characters,
        manualStatus: sys.status,
        hasKillCoverage,
        now,
      }),
    [characters, connections, detailedKills, hasKillCoverage, now, sys.status, systemId, systemSignatures],
  );

  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className={classes.IntelHeader}>
        <div>
          <div className={classes.Eyebrow}>Pilot brief</div>
          <div className={classes.IntelTitle}>Selected-system intelligence</div>
        </div>
        <div className={clsx(classes.RiskBadge, classes[`Risk_${intel.risk}`])}>{RISK_LABELS[intel.risk]}</div>
      </div>

      <div className={classes.MetricGrid}>
        <div className={classes.Metric}>
          <span>Scan state</span>
          <strong className={classes[`Freshness_${intel.scanFreshness}`]}>
            {FRESHNESS_LABELS[intel.scanFreshness]}
          </strong>
          <small>{intel.scanUpdatedAt ? <TimeAgo timestamp={intel.scanUpdatedAt} /> : 'No timestamp available'}</small>
        </div>
        <div className={classes.Metric}>
          <span>Unresolved</span>
          <strong>{intel.unresolvedSignatureCount}</strong>
          <small>{intel.unresolvedWormholeCount} wormholes</small>
        </div>
        <div className={classes.Metric}>
          <span>Kills · 1h</span>
          <strong>{intel.hasKillCoverage ? intel.recentKillCount : '—'}</strong>
          <small>{intel.hasKillCoverage ? 'zKill feed coverage' : 'Not loaded'}</small>
        </div>
        <div className={classes.Metric}>
          <span>Tracked local</span>
          <strong>{intel.onlinePilotCount}</strong>
          <small>{intel.onlineShipTypes.length > 0 ? intel.onlineShipTypes.join(', ') : 'No ships seen'}</small>
        </div>
      </div>

      {(intel.connectionCount > 0 || intel.riskReasons.length > 0) && (
        <div className={classes.AlertStack}>
          <div className={classes.ConnectionStrip}>
            <span>{intel.connectionCount} connections</span>
            <span className={clsx({ [classes.DangerText]: intel.eolConnectionCount > 0 })}>
              {intel.eolConnectionCount} EOL
            </span>
            <span className={clsx({ [classes.DangerText]: intel.criticalMassConnectionCount > 0 })}>
              {intel.criticalMassConnectionCount} critical mass
            </span>
          </div>
          {intel.riskReasons.length > 0 && (
            <ul className={classes.RiskReasons}>
              {intel.riskReasons.slice(0, 4).map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <InfoDrawer title="Constellation & Region">
        {constellation_name} / {region_name}
      </InfoDrawer>

      {isWH && (
        <InfoDrawer title="Statics">
          <div className="flex gap-1">
            {sortedStatics.map(x => (
              <WHClassView key={x} whClassName={x} />
            ))}
          </div>
        </InfoDrawer>
      )}

      {isWH && effect_name && (
        <InfoDrawer title="Effect">
          <WHEffectView effectName={effect_name} effectPower={effect_power} />
        </InfoDrawer>
      )}

      {description && (
        <InfoDrawer title="Notes">
          <MarkdownTextViewer>{description}</MarkdownTextViewer>
        </InfoDrawer>
      )}
    </div>
  );
};
