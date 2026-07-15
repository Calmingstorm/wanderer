import type { Hook, ViewHookInterface } from 'phoenix_live_view';

interface LocalStorageSettingMethods {
  key(this: ViewHookInterface): string;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type LocalStorageSettingHook = Hook<LocalStorageSettingMethods> & LocalStorageSettingMethods;

const LocalStorageSetting: LocalStorageSettingHook = {
  key() {
    return this.el.dataset.key ?? '';
  },

  getItem(key) {
    return localStorage.getItem(key);
  },

  setItem(key, value) {
    localStorage.setItem(key, value);
  },

  mounted() {
    const key = this.key();
    this.pushEvent(`ls_restore_${key}`, { value: this.getItem(key) });
    this.handleEvent(`ls_update_${key}`, ({ value }: { value: string }) => this.setItem(key, value));
  },
};

export default LocalStorageSetting;
