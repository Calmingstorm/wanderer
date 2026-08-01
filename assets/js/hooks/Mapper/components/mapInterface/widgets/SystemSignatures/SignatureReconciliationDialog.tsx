import { WdButton, WdCheckbox } from '@/hooks/Mapper/components/ui-kit';
import { SignatureReconciliation } from './helpers';
import { Dialog } from 'primereact/dialog';

interface Props {
  reconciliation: SignatureReconciliation;
  deleteConnections: boolean;
  canDeleteConnections: boolean;
  onDeleteConnectionsChange: (value: boolean) => void;
  onFullSyncChange: (value: boolean) => void;
  onCancel: () => void;
  error?: string | null;
  onConfirm: () => void;
}

const SignatureList = ({ label, signatures, tone }: { label: string; signatures: Array<{ eve_id: string; name?: string; linked_system?: { solar_system_name: string } }>; tone: string }) => (
  <div className="min-w-0">
    <div className={`mb-1 text-xs font-semibold ${tone}`}>{label} ({signatures.length})</div>
    <div className="max-h-28 overflow-auto rounded border border-stone-700 bg-stone-950/40 p-2 text-xs text-stone-300">
      {signatures.length === 0 ? <span className="text-stone-600">None</span> : signatures.map(signature => (
        <div key={signature.eve_id} className="truncate">
          <strong>{signature.eve_id}</strong>{signature.name ? ` — ${signature.name}` : ''}
          {signature.linked_system ? ` → ${signature.linked_system.solar_system_name}` : ''}
        </div>
      ))}
    </div>
  </div>
);

export const SignatureReconciliationDialog = ({
  reconciliation,
  deleteConnections,
  canDeleteConnections,
  onDeleteConnectionsChange,
  onFullSyncChange,
  onCancel,
  error,
  onConfirm,
}: Props) => {
  const changedAfter = reconciliation.changed.map(change => change.after);
  const mutationCount = reconciliation.added.length + reconciliation.changed.length + reconciliation.removed.length;

  return (
    <Dialog header="Review scanner synchronization" visible modal draggable={false} resizable={false} style={{ width: '680px', maxWidth: 'calc(100vw - 32px)' }} onHide={onCancel}>
      <div className="flex flex-col gap-4">
        <div className="rounded border border-sky-700/50 bg-sky-950/20 p-3 text-sm text-stone-300">
          Nothing has been changed. Review the proposed reconciliation below before committing it.
        </div>

        <WdCheckbox
          id="signature-full-sync"
          label="Full scanner sync: remove stored signatures absent from this scan"
          value={reconciliation.fullSync}
          onChange={event => onFullSyncChange(!!event.checked)}
        />
        {!reconciliation.fullSync && <div className="-mt-3 text-xs text-stone-500">Safe default: additions and upgrades only. Existing chain data is retained.</div>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SignatureList label="Additions" signatures={reconciliation.added} tone="text-emerald-400" />
          <SignatureList label="Changes" signatures={changedAfter} tone="text-amber-400" />
          <SignatureList label="Removals" signatures={reconciliation.removed} tone="text-red-400" />
        </div>

        {reconciliation.affectedLinks.length > 0 && (
          <div className="rounded border border-red-700/60 bg-red-950/25 p-3">
            <div className="mb-2 text-sm font-semibold text-red-300">Affected links ({reconciliation.affectedLinks.length})</div>
            <div className="mb-3 text-xs text-stone-300">
              Removing a linked signature also removes the reciprocal/backlink signature in the linked system. Affected linked systems are shown below when counterpart data is available. The map connection remains unless the explicit option below is enabled.
            </div>
            <SignatureList label="Linked signatures and affected systems" signatures={reconciliation.affectedLinks} tone="text-red-300" />
            <div className="mt-3">
              <WdCheckbox
                id="signature-delete-connections"
                label="Also delete linked map connections"
                value={deleteConnections}
                onChange={event => onDeleteConnectionsChange(!!event.checked)}
                className={!canDeleteConnections ? 'opacity-50 pointer-events-none' : undefined}
              />
              {!canDeleteConnections && <div className="mt-1 text-xs text-stone-500">You do not have permission to delete connections.</div>}
            </div>
          </div>
        )}

        {error && <div className="rounded border border-red-700/60 bg-red-950/25 p-3 text-sm text-red-300">{error}</div>}

        <div className="flex justify-end gap-2">
          <WdButton label="Cancel" severity="secondary" outlined size="small" onClick={onCancel} />
          <WdButton
            label={mutationCount === 0 ? 'No changes' : `Apply ${mutationCount} change${mutationCount === 1 ? '' : 's'}`}
            severity={reconciliation.removed.length > 0 ? 'danger' : 'success'}
            size="small"
            disabled={mutationCount === 0}
            onClick={onConfirm}
          />
        </div>
      </div>
    </Dialog>
  );
};
