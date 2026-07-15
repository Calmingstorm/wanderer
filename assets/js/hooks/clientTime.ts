import type { Hook } from 'phoenix_live_view';

const ClientTime: Hook = {
  mounted() {
    this.updated?.();
  },
  updated() {
    const dt = new Date(Number(this.el.textContent));
    const options: Intl.DateTimeFormatOptions = { hour12: false, timeZone: 'UTC' };
    this.el.textContent = dt.toLocaleString('en-US', options);
    this.el.classList.remove('invisible');
  },
};

export default ClientTime;
