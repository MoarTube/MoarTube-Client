import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const template = readFileSync('public/views/videos.ejs', 'utf8');
const socketStart = template.indexOf('connectWebsocket() {');
const socketMethod = template.slice(
  socketStart,
  template.indexOf('showImportModal() {', socketStart)
);
const imageStart = template.indexOf('refreshLiveImages(videoId, images, version) {');
const imageMethod = template.slice(
  imageStart,
  template.indexOf('showThumbnailModal(videoId) {', imageStart)
);

class Element {
  id = '';
  src = '';
  className = '';
  alt = '';
  dataset: Record<string, string> = {};
  constructor(private readonly elements: Map<string, Element>) {}
  replaceWith(image: Element): void {
    this.elements.delete(this.id);
    this.elements.set(image.id, image);
  }
  querySelector(selector: string): Element | undefined {
    return this.elements.get(selector.slice(1));
  }
}

function page(modalVideoId = 'video') {
  const elements = new Map<string, Element>();
  const add = (id: string): Element => {
    const element = new Element(elements);
    element.id = id;
    elements.set(id, element);
    return element;
  };
  add('video-thumbnail-loading-spinner-video');
  add('video-images-modal').dataset['videoId'] = modalVideoId;
  for (const kind of ['thumbnail', 'preview', 'poster']) {
    add(kind + '-image-button');
  }
  interface Connection {
    onmessage?: (message: { data: string }) => void;
  }
  let socket: Connection | undefined;
  function createSocket(): Connection {
    const connection: Connection = {};
    socket = connection;
    return connection;
  }
  const sandbox = {
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: () => new Element(elements),
    },
    window: { location: { protocol: 'http:', host: 'localhost' } },
    Date: class extends Date {
      static override now(): number {
        return 1000;
      }
    },
    WebSocket: createSocket,
    $: () => ({ length: 0 }),
    console: { log: vi.fn() },
  };
  runInNewContext(readFileSync('public/javascript/memory-limits.js', 'utf8'), sandbox);
  const controller = runInNewContext(`({ ${socketMethod}, ${imageMethod} })`, sandbox) as {
    EXTERNAL_VIDEOS_BASE_URL: string;
    connectWebsocket(): void;
  };
  controller.EXTERNAL_VIDEOS_BASE_URL = 'https://media.example';
  controller.connectWebsocket();
  function status(payload: Record<string, unknown>): void {
    if (socket?.onmessage === undefined) {
      throw new Error('WebSocket was not connected');
    }
    socket.onmessage({ data: JSON.stringify({ eventName: 'video_status', payload }) });
  }
  return { elements, status };
}

it('waits for uploaded images and refreshes every ready event without the ten-second throttle', () => {
  const { elements, status } = page();
  status({ type: 'streaming', videoId: 'video', lengthTimestamp: '00:00:03.00', bandwidth: 0 });
  expect(elements.has('video-thumbnail-loading-spinner-video')).toBe(true);
  expect(elements.has('video-thumbnail-video')).toBe(false);
  for (const version of ['first', 'second', 'third']) {
    status({ type: 'images_updated', videoId: 'video', images: ['thumbnail'], version });
    expect(elements.get('video-thumbnail-video')?.src).toContain('revision=' + version);
    expect(elements.get('thumbnail-image-button')?.src).toContain('revision=' + version);
  }
  expect(elements.has('video-thumbnail-loading-spinner-video')).toBe(false);
  expect(elements.get('preview-image-button')?.src).toBe('');
});

it.each(['video', 'another-video'])(
  'refreshes preview/poster only in the matching open image modal (%s)',
  (modalVideoId) => {
    const { elements, status } = page(modalVideoId);
    status({
      type: 'images_updated',
      videoId: 'video',
      images: ['preview', 'poster'],
      version: 'ready',
    });
    for (const kind of ['preview', 'poster']) {
      const src = elements.get(kind + '-image-button')?.src;
      if (modalVideoId === 'video') {
        expect(src).toContain('/images/' + kind + '.jpg?revision=ready');
      } else {
        expect(src).toBe('');
      }
    }
    expect(elements.get('thumbnail-image-button')?.src).toBe('');
  }
);
