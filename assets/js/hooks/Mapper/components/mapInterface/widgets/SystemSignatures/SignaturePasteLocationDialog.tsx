import { emitMapEvent } from '@/hooks/Mapper/events';
import { SignaturePasteLocationWarning } from '@/hooks/Mapper/helpers/signaturePasteGuard';
import { Commands } from '@/hooks/Mapper/types';
import { Dialog } from 'primereact/dialog';
import { WdButton } from '@/hooks/Mapper/components/ui-kit';

interface SignaturePasteLocationDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
  warning: SignaturePasteLocationWarning;
}

export const SignaturePasteLocationDialog = ({ onCancel, onConfirm, warning }: SignaturePasteLocationDialogProps) => {
  const handleSelectCurrentSystem = () => {
    if (warning.currentMapSystemId) {
      emitMapEvent({
        name: Commands.selectSystems,
        data: { systems: [warning.currentMapSystemId] },
      });
      emitMapEvent({
        name: Commands.centerSystem,
        data: warning.currentMapSystemId,
      });
    }

    onCancel();
  };

  return (
    <Dialog
      header="Signature location mismatch"
      visible
      draggable={false}
      resizable={false}
      closable
      closeOnEscape
      modal
      style={{ width: '520px', maxWidth: 'calc(100vw - 32px)' }}
      onHide={onCancel}
    >
      <div className="flex flex-col gap-4">
        <div className="rounded border border-amber-600/50 bg-amber-950/25 p-3 text-sm text-stone-200">
          <div className="mb-2 flex items-center gap-2 font-semibold text-amber-300">
            <i className="pi pi-exclamation-triangle" aria-hidden="true" />
            You may be updating the wrong system
          </div>
          <p className="m-0 leading-5">
            The signature window is on <strong>{warning.selectedSystemName}</strong>, but{' '}
            <strong>{warning.activeCharacterName}</strong> is currently in <strong>{warning.currentSystemName}</strong>.
          </p>
        </div>

        <p className="m-0 text-xs leading-5 text-stone-400">
          Nothing has been changed yet. Continue only if the scan really belongs to {warning.selectedSystemName}.
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <WdButton label="Cancel" severity="secondary" outlined size="small" onClick={onCancel} />
          {warning.currentMapSystemId && (
            <WdButton
              label={`Select ${warning.currentSystemName}`}
              severity="warning"
              outlined
              size="small"
              onClick={handleSelectCurrentSystem}
            />
          )}
          <WdButton label="Update anyway" severity="danger" size="small" onClick={onConfirm} autoFocus />
        </div>
      </div>
    </Dialog>
  );
};
