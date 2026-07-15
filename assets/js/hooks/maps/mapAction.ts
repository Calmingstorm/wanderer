import type { Hook } from 'phoenix_live_view';

const MapAction: Hook = {
  mounted() {
    this.el.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const confirmation = this.el.dataset.confirm;
      if (confirmation && !window.confirm(confirmation)) return;

      const eventName = this.el.dataset.event;
      if (eventName) {
        this.pushEvent(eventName, { data: this.el.dataset.data });
      }
    });
  },
};

export default MapAction;
