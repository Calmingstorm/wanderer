import { useMapEventListener } from '@/hooks/Mapper/events';
import { parseSignatures } from '@/hooks/Mapper/helpers';
import { Commands, ExtendedSystemSignature, SignatureKind } from '@/hooks/Mapper/types';
import { buildSignatureReconciliation, SignatureReconciliation, getSignatureStateFingerprint } from '../helpers';
import { useCallback, useEffect, useState } from 'react';
import useRefState from 'react-usestateref';

import { SETTINGS_KEYS } from '@/hooks/Mapper/constants/signatures.ts';
import { UseSystemSignaturesDataProps } from './types';
import { useSignatureFetching } from './useSignatureFetching';

export const useSystemSignaturesData = ({
  systemId,
  settings,
  onLazyDeleteChange,
}: Omit<UseSystemSignaturesDataProps, 'deletionTiming'> & {
  onSignatureDeleted?: (deletedSignatures: ExtendedSystemSignature[]) => void;
}) => {
  const [signatures, setSignatures, signaturesRef] = useRefState<ExtendedSystemSignature[]>([]);
  const [selectedSignatures, setSelectedSignatures] = useState<ExtendedSystemSignature[]>([]);
  const [hasUnsupportedLanguage, setHasUnsupportedLanguage] = useState<boolean>(false);

  const { handleGetSignatures, handleUpdateSignatures, handleApplyReconciliation } = useSignatureFetching({
    systemId,
    settings,
    signaturesRef,
    setSignatures,
  });

  const prepareReconciliation = useCallback(
    (clipboardString: string): SignatureReconciliation | null => {
      const incomingSignatures = parseSignatures(
        clipboardString,
        Object.keys(settings).filter(settingKey => settingKey in SignatureKind),
      ) as ExtendedSystemSignature[];

      if (incomingSignatures.length === 0) {
        return null;
      }

      const clipboardRows = clipboardString.split('\n').filter(row => row.trim() !== '');
      const detectedSignatureCount = clipboardRows.filter(row => row.match(/^[A-Z]{3}-\d{3}/)).length;
      setHasUnsupportedLanguage(detectedSignatureCount > incomingSignatures.length);

      // Scanner reconciliation always opens in update-only mode. Removing signatures
      // requires an explicit choice in the preview, regardless of prior lazy-delete settings.
      return buildSignatureReconciliation(signaturesRef.current, incomingSignatures, false);
    },
    [settings, signaturesRef],
  );

  const applyReconciliation = useCallback(
    async (reconciliation: SignatureReconciliation, deleteConnections: boolean): Promise<boolean> => {
      if (getSignatureStateFingerprint(signaturesRef.current) !== reconciliation.baseFingerprint) {
        return false;
      }

      await handleApplyReconciliation(reconciliation, deleteConnections);

      const keepLazy = settings[SETTINGS_KEYS.KEEP_LAZY_DELETE] as boolean;
      if (reconciliation.fullSync && !keepLazy) {
        onLazyDeleteChange?.(false);
      }
      return true;
    },
    [handleApplyReconciliation, onLazyDeleteChange, settings, signaturesRef],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedSignatures.length) return;

    const selectedIds = selectedSignatures.map(s => s.eve_id);
    const finalList = signatures.filter(s => !selectedIds.includes(s.eve_id));

    setSelectedSignatures([]);

    await handleUpdateSignatures(finalList, false, true);
  }, [handleUpdateSignatures, selectedSignatures, signatures]);

  const handleSelectAll = useCallback(() => {
    setSelectedSignatures(signatures);
  }, [signatures]);

  useMapEventListener(event => {
    if (event.name === Commands.signaturesUpdated && String(event.data) === String(systemId)) {
      handleGetSignatures();
      return true;
    }
  });

  useEffect(() => {
    if (!systemId) {
      setSignatures([]);
      return;
    }
    handleGetSignatures();
  }, [systemId]);

  return {
    signatures,
    selectedSignatures,
    setSelectedSignatures,
    handleDeleteSelected,
    handleSelectAll,
    prepareReconciliation,
    applyReconciliation,
    hasUnsupportedLanguage,
  };
};
