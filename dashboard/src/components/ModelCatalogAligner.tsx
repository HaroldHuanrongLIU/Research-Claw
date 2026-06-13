import { useEffect } from 'react';
import { useGatewayStore } from '../stores/gateway';
import { useConfigStore } from '../stores/config';
import { useModelCatalogStore } from '../stores/model-catalog';

/**
 * Invisible startup hook: once boot reaches 'ready' (config.get done) and the
 * gateway is connected, align RC's model cards against OpenClaw's catalog exactly
 * once. The store guards re-entry and idempotency; this component only drives the
 * trigger off connection/boot state.
 */
export default function ModelCatalogAligner() {
  const connState = useGatewayStore((s) => s.state);
  const bootState = useConfigStore((s) => s.bootState);

  useEffect(() => {
    if (bootState === 'ready' && connState === 'connected') {
      void useModelCatalogStore.getState().alignConfigOnStartup();
    }
  }, [bootState, connState]);

  return null;
}
