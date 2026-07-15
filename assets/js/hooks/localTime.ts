import type { Hook } from 'phoenix_live_view';

const LocalTime: Hook = {
  mounted() {
    this.updated?.();
  },

  updated() {
    const dt = new Date(this.el.textContent ?? '');
    const options: Intl.DateTimeFormatOptions = { hour12: false };
    this.el.textContent = dt.toLocaleString('en-US', options);
    this.el.classList.remove('invisible');
  },
};

export default LocalTime;
