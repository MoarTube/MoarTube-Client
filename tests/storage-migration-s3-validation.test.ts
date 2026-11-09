import { expect, it, vi } from 'vitest';
import { S3Service } from '../src/services/s3.js';
import { siloFixture, siloProxy } from './support/silo.js';

it('round-trips migration credentials without issuing deletes or disturbing video objects', async () => {
  const fixture = await siloFixture();
  const methods: string[] = [];
  const proxy = await siloProxy(fixture.config.s3ProviderClientConfig.endpoint, (request) => {
    methods.push(request.method ?? '');
  });
  const service = new S3Service({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never);
  try {
    await fixture.put('external/videos/video/source.mp4', 'video');
    await service.validateS3Config({
      ...fixture.config,
      s3ProviderClientConfig: { ...fixture.config.s3ProviderClientConfig, endpoint: proxy.endpoint },
    }, false);
    expect(methods).toContain('PUT');
    expect(methods).toContain('GET');
    expect(methods).not.toContain('DELETE');
    expect(await fixture.text('Moartube-Client-Test')).toBe('testing');
    expect(await fixture.text('external/videos/video/source.mp4')).toBe('video');
  } finally {
    service.close();
    await proxy.close();
    await fixture.close();
  }
});
