import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const template = readFileSync('public/views/videos.ejs', 'utf8');
const start = template.indexOf('showLiveModal(videoId) {');
const method = template.slice(start, template.indexOf('showPublishWizardModal', start));

interface StreamOptions {
  title: string;
}
interface ModalOptions {
  showDenyButton: boolean;
  confirmButtonText: string;
  denyButtonText: string;
  willOpen(): void;
  preDeny(): StreamOptions | false;
  preConfirm(): StreamOptions | false;
}
interface AjaxResult {
  done(callback: (data: unknown) => void): AjaxResult;
  fail(callback: (xhr: { responseJSON?: { message: string } }) => void): AjaxResult;
  always(): AjaxResult;
}

it.each([
  [undefined, false, undefined],
  ['video123', false, undefined],
  ['video123', true, undefined],
  ['video123', true, 'message'],
  ['video123', true, 'empty'],
] as const)(
  'shows the right stream actions for video %s and submits their mode',
  async (videoId, resume, failure) => {
    let options: ModalOptions | undefined;
    let finish: ((result: unknown) => void) | undefined;
    const inputs = new Map<string, { value: string; checked: boolean }>();
    const input = (id: string): { value: string; checked: boolean } => {
      const existing = inputs.get(id);
      if (existing) {
        return existing;
      }
      const created = { value: '', checked: false };
      inputs.set(id, created);
      return created;
    };
    const validation = vi.fn();
    const ajax = vi.fn(
      (request: { url: string; data?: string }): AjaxResult => ({
        done(callback): AjaxResult {
          if (request.url === '/network') {
            callback({ networkAddresses: ['127.0.0.1'] });
          }
          if (request.url.endsWith('/data')) {
            callback({
              videoData: {
                title: 'live',
                description: 'description',
                tags: 'test',
                meta: {
                  resolution: '720p',
                  rtmpPort: 1935,
                  networkAddress: '127.0.0.1',
                  isRecordingStreamRemotely: true,
                  isRecordingStreamLocally: true,
                },
              },
            });
          }
          return this;
        },
        fail(callback): AjaxResult {
          if (request.url === '/streams/start' && failure !== undefined) {
            callback(
              failure === 'message' ? { responseJSON: { message: 'Resume rejected by Node' } } : {}
            );
          }
          return this;
        },
        always(): AjaxResult {
          return this;
        },
      })
    );
    const $ = Object.assign(
      (selector: string) => ({
        append(): void {},
        focus(): void {},
        val(value: string | number): void {
          input(selector).value = String(value);
        },
        prop(_property: string, value: boolean): void {
          input(selector).checked = value;
        },
      }),
      { ajax }
    );
    const Swal = {
      mixin: () => ({
        fire: (config: ModalOptions): Promise<unknown> => {
          options = config;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      }),
      getPopup: () => ({
        querySelector: (selector: string) => input(selector),
        querySelectorAll: () => [{ value: '720p', checked: true }],
      }),
      showValidationMessage: validation,
    };
    const instance = runInNewContext(`({ ${method} })`, {
      Swal,
      $,
      document: { getElementById: () => ({}) },
      console: { log() {} },
    }) as {
      showLiveModal(videoId?: string): void;
      updateTagsInput(): { getValue(): string[] };
      showAlert(isError: boolean, message: string): void;
    };
    const showAlert = vi.fn();
    instance.showAlert = showAlert;
    instance.updateTagsInput = () => ({ getValue: () => ['test'] });
    instance.showLiveModal(videoId);
    if (!options || !finish) {
      throw new Error('Modal did not open');
    }
    expect(options.showDenyButton).toBe(videoId !== undefined);
    expect(options.confirmButtonText).toBe(
      videoId !== undefined ? 'Restart' : '<i class="fa fa-thumbs-up"></i> Stream!'
    );
    expect(options.denyButtonText).toBe('Resume');
    options.willOpen();
    input('#importTitleInput').value = '';
    expect(options.preDeny()).toBe(false);
    expect(validation).toHaveBeenCalledWith('enter a title');
    input('#importTitleInput').value = 'live';
    input('#importDescriptionInput').value = 'description';
    input('#rtmpPortInput').value = '1935';
    const value = resume ? options.preDeny() : options.preConfirm();
    if (value === false) {
      throw new Error('Valid stream form rejected');
    }
    expect(value.title).toBe('live');
    finish({ isConfirmed: !resume, isDenied: resume, value });
    await Promise.resolve();
    const request = ajax.mock.calls.find(([request]) => request.url === '/streams/start')?.[0];
    if (request?.data === undefined) {
      throw new Error('Stream request missing');
    }
    expect(JSON.parse(request.data) as unknown).toMatchObject({
      resume,
      title: 'live',
    });
    if (failure !== undefined) {
      expect(showAlert).toHaveBeenCalledWith(
        true,
        failure === 'message' ? 'Resume rejected by Node' : 'unable to resume stream'
      );
    } else {
      expect(showAlert).not.toHaveBeenCalled();
    }
  }
);
