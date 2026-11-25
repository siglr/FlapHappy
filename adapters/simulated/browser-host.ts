import type { Host, HostInfo } from '../../core/sim';

/** Plain-browser stubs for the dev harness page: file dialogs use a file input and a download. */
export class BrowserHost implements Host {
  capabilities = { files: true, alwaysOnTop: false, textCopy: false, opacity: false, compact: false, openFolder: false };

  constructor(private infoValue: Partial<HostInfo> = {}) {}

  async info(): Promise<HostInfo> {
    return { source: 'simulated', dev: true, version: 'harness', platform: 'browser', ...this.infoValue };
  }

  openJson(): Promise<string | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const f = input.files && input.files[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => resolve(null);
        r.readAsText(f);
      };
      input.click();
    });
  }

  async saveJson(name: string, text: string): Promise<boolean> {
    const a = document.createElement('a');
    a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(text);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  }

  setAlwaysOnTop(): void {}
  setOpacity(): void {}
  setCompact(): void {}
  openProfilesFolder(): void {}
  quit(): void {}
}
