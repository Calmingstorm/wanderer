import { Widget } from '@/hooks/Mapper/components/mapInterface/components';
import { SETTINGS_KEYS, SIGNATURE_WINDOW_ID, SignatureSettingsType } from '@/hooks/Mapper/constants/signatures';
import { useHotkey } from '@/hooks/Mapper/hooks/useHotkey';
import { useMapRootState } from '@/hooks/Mapper/mapRootProvider';
import { useCallback, useMemo, useState } from 'react';
import { parseSignatures } from '@/hooks/Mapper/helpers';
import {
  getSignaturePasteLocationWarning,
  SignaturePasteLocationWarning,
} from '@/hooks/Mapper/helpers/signaturePasteGuard';
import { SignatureKind, UserPermission } from '@/hooks/Mapper/types';
import { buildSignatureReconciliation, getSignatureScanProgress, SignatureReconciliation } from './helpers';
import { useSignatureUndo } from './hooks/useSignatureUndo';
import { useSystemSignaturesData } from './hooks/useSystemSignaturesData';
import { SystemSignaturesHeader } from './SystemSignatureHeader';
import { SystemSignaturesContent } from './SystemSignaturesContent';
import { SystemSignatureSettingsDialog } from './SystemSignatureSettingsDialog';
import { SignaturePasteLocationDialog } from './SignaturePasteLocationDialog';
import { SignatureReconciliationDialog } from './SignatureReconciliationDialog';

export const SystemSignatures = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [pendingPaste, setPendingPaste] = useState<{ clipboardString: string; warning: SignaturePasteLocationWarning } | null>(null);
  const [reconciliation, setReconciliation] = useState<SignatureReconciliation | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleteConnections, setDeleteConnections] = useState(false);

  const {
    data: { characters, followingCharacterEveId, mainCharacterEveId, selectedSystems, systems, userCharacters, userPermissions },
    outCommand,
    storedSettings: { settingsSignatures, settingsSignaturesUpdate },
  } = useMapRootState();

  const [systemId] = selectedSystems;
  const isSystemSelected = selectedSystems.length === 1;

  const handleLazyDeleteToggle = useCallback(
    (value: boolean) => settingsSignaturesUpdate(prev => ({ ...prev, [SETTINGS_KEYS.LAZY_DELETE_SIGNATURES]: value })),
    [settingsSignaturesUpdate],
  );

  const {
    signatures,
    selectedSignatures,
    setSelectedSignatures,
    handleDeleteSelected,
    handleSelectAll,
    prepareReconciliation,
    applyReconciliation,
    hasUnsupportedLanguage,
  } = useSystemSignaturesData({ systemId, settings: settingsSignatures, onLazyDeleteChange: handleLazyDeleteToggle });

  const pasteLocationWarning = useMemo(
    () => getSignaturePasteLocationWarning({
      characters,
      followingCharacterEveId,
      mainCharacterEveId,
      selectedMapSystemId: systemId,
      systems,
      userCharacters,
    }),
    [characters, followingCharacterEveId, mainCharacterEveId, systemId, systems, userCharacters],
  );

  const openPreview = useCallback((clipboardString: string) => {
    const preview = prepareReconciliation(clipboardString);
    if (preview) {
      setPreviewError(null);
      setDeleteConnections(false);
      setReconciliation(preview);
    }
  }, [prepareReconciliation]);

  const handleGuardedPaste = useCallback((clipboardString: string) => {
    const parsed = parseSignatures(
      clipboardString,
      Object.keys(settingsSignatures).filter(settingKey => settingKey in SignatureKind),
    );
    if (parsed.length === 0) return;
    if (pasteLocationWarning) {
      setPendingPaste({ clipboardString, warning: pasteLocationWarning });
      return;
    }
    openPreview(clipboardString);
  }, [openPreview, pasteLocationWarning, settingsSignatures]);

  const handleConfirmLocation = useCallback(() => {
    if (pendingPaste && systemId === pendingPaste.warning.selectedMapSystemId) openPreview(pendingPaste.clipboardString);
    setPendingPaste(null);
  }, [openPreview, pendingPaste, systemId]);

  const handleApplyPreview = useCallback(async () => {
    if (!reconciliation) return;
    const applied = await applyReconciliation(reconciliation, deleteConnections);
    if (!applied) {
      setPreviewError('Signatures changed while this preview was open. Close it and paste again.');
      return;
    }
    setReconciliation(null);
    setPreviewError(null);
  }, [applyReconciliation, deleteConnections, reconciliation]);

  const deletedSignatures = useMemo(() => signatures.filter(signature => signature.deleted), [signatures]);
  const progress = useMemo(() => getSignatureScanProgress(signatures), [signatures]);
  const { countdown, handleUndo } = useSignatureUndo(systemId, settingsSignatures, deletedSignatures, outCommand);

  useHotkey(true, ['z', 'Z'], (event: KeyboardEvent) => {
    if (deletedSignatures.length > 0 && countdown > 0) {
      event.preventDefault();
      event.stopPropagation();
      handleUndo();
    }
  });

  const handleSettingsSave = useCallback((newSettings: SignatureSettingsType) => {
    settingsSignaturesUpdate(newSettings);
    setShowSettings(false);
  }, [settingsSignaturesUpdate]);

  return (
    <Widget
      label={<SystemSignaturesHeader
        sigCount={signatures.length}
        scanProgress={progress}
        lazyDeleteValue={settingsSignatures[SETTINGS_KEYS.LAZY_DELETE_SIGNATURES] as boolean}
        pendingCount={deletedSignatures.length}
        undoCountdown={countdown}
        onLazyDeleteChange={handleLazyDeleteToggle}
        onUndoClick={handleUndo}
        onSettingsClick={() => setShowSettings(true)}
      />}
      windowId={SIGNATURE_WINDOW_ID}
    >
      {!isSystemSelected ? (
        <div className="w-full h-full flex justify-center items-center select-none text-center text-stone-400/80 text-sm">System is not selected</div>
      ) : (
        <SystemSignaturesContent
          systemId={systemId}
          signatures={signatures}
          selectedSignatures={selectedSignatures}
          onSelectSignatures={setSelectedSignatures}
          onDeleteSelected={handleDeleteSelected}
          onSelectAll={handleSelectAll}
          onPaste={handleGuardedPaste}
          hasUnsupportedLanguage={hasUnsupportedLanguage}
          settings={settingsSignatures}
        />
      )}
      {showSettings && <SystemSignatureSettingsDialog settings={settingsSignatures} onCancel={() => setShowSettings(false)} onSave={handleSettingsSave} />}
      {pendingPaste && <SignaturePasteLocationDialog warning={pendingPaste.warning} onCancel={() => setPendingPaste(null)} onConfirm={handleConfirmLocation} />}
      {reconciliation && (
        <SignatureReconciliationDialog
          reconciliation={reconciliation}
          deleteConnections={deleteConnections}
          canDeleteConnections={!!userPermissions[UserPermission.DELETE_CONNECTION]}
          error={previewError}
          onDeleteConnectionsChange={value => setDeleteConnections(value && !!userPermissions[UserPermission.DELETE_CONNECTION])}
          onFullSyncChange={fullSync => {
            setDeleteConnections(false);
            setPreviewError(null);
            setReconciliation(buildSignatureReconciliation(signatures, reconciliation.incoming, fullSync));
          }}
          onCancel={() => {
            setDeleteConnections(false);
            setPreviewError(null);
            setReconciliation(null);
          }}
          onConfirm={handleApplyPreview}
        />
      )}
    </Widget>
  );
};

export default SystemSignatures;
