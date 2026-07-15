import type { Hook, ViewHookInterface } from 'phoenix_live_view';

interface PingState {
  _nowMs: number;
  ping(rtt: number | null): void;
}

type PingHook = Hook<PingState> & PingState;

const Ping: PingHook = {
  _nowMs: Date.now(),

  mounted() {
    this.handleEvent('pong', () => {
      const rtt = Date.now() - this._nowMs;
      this.el.dataset.tip = `ping: ${rtt}ms`;
      window.setTimeout(() => this.ping(rtt), 60_000);
    });
    this.ping(null);
  },

  reconnected() {
    this.ping(null);
  },

  disconnected() {},

  ping(this: PingState & ViewHookInterface, rtt) {
    this._nowMs = Date.now();
    this.pushEvent('ping', { rtt });
  },
};

export default Ping;
