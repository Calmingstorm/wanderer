import { Droppable } from '@shopify/draggable';
import type { Hook } from 'phoenix_live_view';

interface DragStartEvent {
  originalSource: HTMLElement;
}

interface DroppableEvent {
  dropzone: HTMLElement;
  cancel(): void;
}

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
      const { originalSource } = event as unknown as DragStartEvent;
      lastDropzone = null;
      droppableOrigin = originalSource;
    });

    droppable.on('droppable:dropped', event => {
      const droppedEvent = event as unknown as DroppableEvent;
      const originDropzone = droppableOrigin?.parentElement?.dataset.dropzone;
      const targetDropzone = droppedEvent.dropzone.dataset.dropzone;

      if (originDropzone !== targetDropzone) {
        lastDropzone = targetDropzone ?? null;
        droppedEvent.cancel();
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
