import type { Hook } from 'phoenix_live_view';

const DownloadJson: Hook = {
  mounted() {
    const button = this.el;

    button.addEventListener('click', () => {
      const blob = new Blob([button.dataset.content ?? '{}'], { type: 'application/json' });
      const link = document.createElement('a');
      link.download = `${button.dataset.name ?? 'download'}.json`;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    });
  },
};

export default DownloadJson;
