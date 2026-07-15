import type { Hook } from 'phoenix_live_view';

const CopyToClipboard: Hook = {
  mounted() {
    const button = this.el;

    button.addEventListener('click', () => {
      button.classList.remove('copied');

      navigator.clipboard
        .writeText(button.dataset.url ?? '')
        .then(() => {
          button.classList.add('copied');
        })
        .catch((error: unknown) => {
          console.error('Failed to copy URL:', error);
        });
    });
  },
};

export default CopyToClipboard;
