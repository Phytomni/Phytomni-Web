import type { PiniaPluginContext } from "pinia";

export type ActionObserverEvent = {
  actionName: string;
  errorMessage: string;
};

export type ActionObserverSink = (event: ActionObserverEvent) => void;

export function createActionObserverPlugin(
  sink: ActionObserverSink = () => undefined
) {
  return ({ store }: PiniaPluginContext) => {
    store.$onAction(({ name, after, onError }) => {
      onError((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        try {
          sink({ actionName: name, errorMessage });
        } catch {
          // Sink must never mask or replace the original action failure.
        }
      });
      after(() => {
        /* success path: intentionally silent */
      });
    });
  };
}
