import type { Hook } from 'phoenix_live_view';

const countdown = (secondsCount: number): void => {
  const dateEnd = Date.now() + secondsCount * 1000;

  const calculate = (): void => {
    const timeRemaining = Math.floor((dateEnd - Date.now()) / 1000);
    if (timeRemaining < 0) return;

    const secondsElement = document.getElementById('version-update-seconds');
    if (secondsElement) secondsElement.textContent = String(timeRemaining % 3600);
  };

  calculate();
  window.setInterval(calculate, 1000);
};

const LAST_VERSION_KEY = 'wandererLastVersion';

const updateVersion = (newVersion: string | undefined): void => {
  if (!newVersion) return;
  localStorage.setItem(LAST_VERSION_KEY, newVersion);
  window.location.reload();
};

interface NewVersionUpdateMethods {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type NewVersionUpdateHook = Hook<NewVersionUpdateMethods> & NewVersionUpdateMethods;

const NewVersionUpdate: NewVersionUpdateHook = {
  mounted() {
    const refreshZone = this.el.querySelector<HTMLElement>('#refresh-area');

    refreshZone?.addEventListener('click', () => {
      this.el.querySelectorAll<HTMLElement>('.hex-brick').forEach(element => {
        element.classList.add('hex-brick--active');
      });
      updateVersion(this.el.dataset.version);
    });

    this.updated?.();
  },

  reconnected() {
    this.updated?.();
  },

  updated() {
    const activeVersion = this.getItem(LAST_VERSION_KEY);
    const lastVersion = this.el.dataset.version;
    if (!lastVersion || activeVersion === lastVersion) return;

    if (this.el.dataset.enabled === 'true') {
      this.el.classList.remove('hidden');
      const autoRefreshTimeout = Math.floor(Math.random() * 76) + 75;
      countdown(autoRefreshTimeout);
      window.setTimeout(() => updateVersion(lastVersion), autoRefreshTimeout * 1000);
    } else {
      updateVersion(lastVersion);
    }
  },

  getItem(key) {
    return localStorage.getItem(key);
  },

  setItem(key, value) {
    localStorage.setItem(key, value);
  },
};

export default NewVersionUpdate;
