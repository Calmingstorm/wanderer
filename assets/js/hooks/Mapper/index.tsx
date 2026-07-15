import type { Hook, ViewHookInterface } from 'phoenix_live_view';
import { createRoot, Root } from 'react-dom/client';
import Mapper, { MapperHooks } from './MapRoot';

const LAST_VERSION_KEY = 'wandererLastVersion';
const UI_LOADED_EVENT = 'ui_loaded';

type HookContext = MapperHookState & ViewHookInterface;

type MapperHookState = {
  _rootEl: Root | null;
  _errorCount: number;
  handleEventWrapper(this: HookContext, event: string, handler: (payload: unknown) => void): void;
  pushEventAsync<T = unknown>(this: HookContext, event: string, payload: unknown): Promise<T>;
  render(this: HookContext, hooks: MapperHooks): void;
};

const MapperHook: Hook<MapperHookState> & MapperHookState = {
  _rootEl: null,
  _errorCount: 0,

  mounted() {
    const rootEl = document.getElementById(this.el.id);
    if (!rootEl) {
      throw new Error(`Mapper root element not found: ${this.el.id}`);
    }

    const activeVersion = localStorage.getItem(LAST_VERSION_KEY);
    this._rootEl = createRoot(rootEl);

    const handleError = (error: Error, componentStack: string | null | undefined) => {
      this.pushEvent('log_map_error', { error: error.message, componentStack });
    };

    this.render({
      handleEvent: this.handleEventWrapper.bind(this),
      pushEvent: this.pushEvent.bind(this),
      pushEventAsync: <T = unknown,>(event: string, payload: unknown) => this.pushEventAsync<T>(event, payload),
      onError: handleError,
    });

    this.pushEvent(UI_LOADED_EVENT, { version: activeVersion });
  },

  handleEventWrapper(event, handler) {
    this.handleEvent(event, (body: unknown) => {
      handler(body);
    });
  },

  reconnected() {
    const activeVersion = localStorage.getItem(LAST_VERSION_KEY);
    this.pushEvent(UI_LOADED_EVENT, { version: activeVersion });
  },

  async pushEventAsync<T = unknown>(this: HookContext, event: string, payload: unknown): Promise<T> {
    return new Promise<T>(resolve => {
      this.pushEvent(event, payload, (reply: T) => {
        resolve(reply);
      });
    });
  },

  render(hooks) {
    if (!this._rootEl) {
      throw new Error('Mapper React root is not initialized');
    }
    this._rootEl.render(<Mapper hooks={hooks} />);
  },

  destroyed() {
    this._rootEl?.unmount();
    this._rootEl = null;
  },
};

export default MapperHook;
