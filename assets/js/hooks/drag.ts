import { Droppable } from '@shopify/draggable';
import type { Hook } from 'phoenix_live_view';

const Drag: Hook = {
  mounted() {
    let lastDropzone: string | null = null;
    let droppableOrigin: HTMLElement | null = null;
    const containers = document.querySelectorAll<HTMLElement>('.dropzone');
    const selector = `#${this.el.id}`;

    const droppable = new Droppable(containers, {
      delay: 100,
      draggable: '.draggable',
      dropzone: '.dropzone',
      mirror: {
        constrainDimensions: true,
      },
    });

    droppable.on('drag:start', event => {
      lastDropzone = null;
      droppableOrigin = event.originalSource;
    });

    droppable.on('droppable:dropped', event => {
      const originDropzone = droppableOrigin?.parentElement?.dataset.dropzone;
      const targetDropzone = event.dropzone.dataset.dropzone;

      if (originDropzone !== targetDropzone) {
        lastDropzone = targetDropzone ?? null;
        event.cancel();
      }
    });

    droppable.on('droppable:stop', () => {
      if (!lastDropzone || !droppableOrigin) return;

      this.pushEventTo(selector, 'dropped', {
        draggedId: droppableOrigin.id,
        dropzoneId: lastDropzone,
      });
    });
  },
};

export default Drag;
