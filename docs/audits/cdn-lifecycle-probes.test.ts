/**
 * Audit observations, not desired regression behavior: these tests confirm known defects.
 * Copy into MoarTube-Node/tests/unit/controllers to run with the Node Vitest aliases.
 * See cdn-lifecycle-audit.md for the interpretation and required corrected expectations.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: vi.fn(), operation: vi.fn(), credentials: vi.fn() }));
vi.mock('@/config/index.js', () => ({ getConfig: mocks.config }));
vi.mock('@/services/cloudflare-tunnel-runtime.js', () => ({
  requestTunnelOperation: mocks.operation,
}));
vi.mock('@utils/index.js', async (original) => ({
  ...(await original<object>()),
  isCloudflareCredentialsValid: mocks.credentials,
}));
import { settingsRoutes } from '@/routes/settings.js';
import { withSettingsChange } from '@/utils/settings-change.js';
import { SettingsController } from '@/controllers/settings.js';
import { SettingsService } from '@/services/settings.js';
import { withJobAdmission } from '@/utils/distribution-admission.js';
import { buildExternalVideosBaseUrl } from '@/config/urls.js';

let app: FastifyInstance;
let directory: string;
let settings: Record<string, unknown>;
let videoRecords: object[];
const rewriteS3 = vi.fn();
let cloudflare: Record<string, ReturnType<typeof vi.fn>>;
const payload = {
  cloudflareEmailAddress: 'email@example.com',
  cloudflareZoneId: 'zone',
  cloudflareGlobalApiKey: 'key',
};

beforeEach(async () => {
  vi.clearAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moartube-cdn-test-'));
  videoRecords = [];
  settings = {
    isCloudflareTunnelEnabled: true,
    isCloudflareCdnEnabled: false,
    cloudflareTunnelName: 'old-quick',
    cloudflareEmailAddress: '',
    cloudflareZoneId: '',
    cloudflareGlobalApiKey: '',
    publicNodeProtocol: 'http',
    publicNodePort: 9090,
    publicNodeAddress: 'node.example.com',
    storageConfig: { storageMode: 'filesystem' },
  };
  const config = {
    paths: {
      nodeSettingsPath: path.join(directory, 'settings.json'),
      videosDirectoryPath: directory,
      dataDirectoryPath: directory,
    },
    get nodeSettings() {
      return { ...settings };
    },
    reloadNodeSettings: vi.fn(),
    updateNodeSettings: (updates: object) => {
      settings = { ...settings, ...updates };
    },
    getExternalVideosBaseUrl: () => buildExternalVideosBaseUrl(settings as never),
  };
  mocks.config.mockReturnValue(config);
  mocks.credentials.mockResolvedValue(true);
  mocks.operation.mockImplementation(async (operation) => {
    if (operation === 'prepare_cdn_clear') {
      expect(settings.isCloudflareCdnEnabled).toBe(true);
      expect(settings.cloudflareGlobalApiKey).not.toBe('');
      return { mode: 'named', status: 'running', name: settings.cloudflareTunnelName };
    }
    await withSettingsChange(config.paths.nodeSettingsPath, () => Promise.resolve());
    if (settings.isCloudflareTunnelEnabled === false)
      return { mode: 'none', status: 'stopped', name: '' };
    if (!settings.isCloudflareCdnEnabled) settings.cloudflareTunnelName = 'new-generated-quick';
    return {
      mode: settings.isCloudflareCdnEnabled ? 'named' : 'quick',
      status: 'running',
      name: settings.cloudflareTunnelName,
    };
  });
  const service = new SettingsService(
    { info: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  cloudflare = {
    retryPendingPurges: vi.fn().mockResolvedValue(undefined),
    resolveCdnPublicAddress: vi.fn().mockResolvedValue('node.example.com'),
    validateCdnConfiguration: vi.fn().mockResolvedValue(undefined),
    withConfigurationRollback: vi.fn(async (_email, _zone, _key, operation) => operation()),
    setCdnConfiguration: vi.fn().mockResolvedValue(undefined),
    addCdnDnsRecord: vi.fn().mockResolvedValue(undefined),
    purgeEntireCacheWithCredentials: vi.fn().mockResolvedValue(undefined),
    resetCdn: vi.fn().mockResolvedValue(undefined),
    purgeAdaptiveVideos: vi.fn().mockResolvedValue(undefined),
    purgeWatchPages: vi.fn().mockResolvedValue(undefined),
    purgeVideo: vi.fn().mockResolvedValue(undefined),
  };
  const services: Record<string, object> = {
    settingsService: service,
    cloudflareService: cloudflare,
    videosService: {
      getAllVideosData: async () => videoRecords,
      rewriteS3VideoManifests: rewriteS3,
    },
    websocketService: {},
  };
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('optionalAuthenticate', async () => {});
  app.decorate(
    'authenticate',
    async (
      request: { headers: { authorization?: string } },
      reply: { code: (code: number) => { send: (body: object) => unknown } }
    ) => {
      if (request.headers.authorization !== 'Bearer test')
        return reply.code(401).send({ isError: true });
    }
  );
  await app.register(
    async (scope) => {
      settingsRoutes(scope as never, { resolve: (name: string) => services[name] } as never);
    },
    { prefix: '/settings' }
  );
});
afterEach(async () => {
  await app.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
const configure = (body: object = payload) =>
  app.inject({
    method: 'POST',
    url: '/settings/cloudflare/configure',
    headers: { authorization: 'Bearer test' },
    payload: body,
  });
const clear = () =>
  app.inject({
    method: 'POST',
    url: '/settings/cloudflare/clear',
    headers: { authorization: 'Bearer test' },
    payload: {},
  });


import { VideosController } from '@/controllers/videos.js';
import { withDistributionTransition } from '@/utils/distribution-admission.js';

it.each([true, false])('AUDIT: failed provider rollback during CDN enabled=%s leaves jobs admitted and no pending recovery', async (enabled) => {
  if (!enabled) await configure();
  cloudflare.withConfigurationRollback.mockImplementationOnce(async (_email, _zone, _key, operation) => {
    try { return await operation(); }
    catch (failure) { throw new AggregateError([failure, new Error('rollback failed')], 'Cloudflare change failed and recovery is incomplete'); }
  });
  if (enabled) cloudflare.addCdnDnsRecord.mockRejectedValueOnce(new Error('DNS failed'));
  else cloudflare.resetCdn.mockRejectedValueOnce(new Error('reset partially failed'));
  const response = await (enabled ? configure() : clear());
  expect(response.statusCode).toBe(400);
  expect(settings.cloudflareAddressMigrationPending).not.toBe(true);
  await expect(withJobAdmission(async () => 'job admitted')).resolves.toBe('job admitted');
});

it('AUDIT: enabling another zone after failed removal bypasses the old purge recovery', async () => {
  await configure();
  cloudflare.purgeEntireCacheWithCredentials.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('old zone purge failed'));
  const removed = await clear();
  expect(removed.statusCode).toBe(502);
  expect(settings.cloudflareAddressMigrationPending).toBe(true);
  cloudflare.retryPendingPurges.mockRejectedValue(new Error('old zone still has pending purges'));
  const enabled = await configure({ ...payload, cloudflareZoneId: 'different-zone' });
  expect(enabled.statusCode).toBe(200);
  expect(settings.cloudflareAddressMigrationPending).toBe(false);
  expect(cloudflare.retryPendingPurges).not.toHaveBeenCalled();
  await expect(withJobAdmission(async () => 'job admitted')).resolves.toBe('job admitted');
});

it('AUDIT: an upload with cleared activity flags can write while CDN transition is in progress and after it is marked pending', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  const controller = new VideosController(
    { getVideo: vi.fn().mockResolvedValue({ video_id: 'video123', is_publishing: false }), setError: vi.fn() } as never,
    {} as never,
    { validateVideoUploadParams: () => true, trackProgress: vi.fn(), isValidVideoMimeType: () => true,
      getVideoDestinationPath: () => 'manifest.m3u8', saveUploadedFile: write } as never,
    {} as never, {} as never);
  const request = { params: { videoId: 'video123' }, query: { format: 'm3u8', resolution: '720p', finalBatch: 'false' },
    parts: async function* () { yield { type: 'file', filename: 'manifest.m3u8', mimetype: 'application/x-mpegURL' }; } };
  const reply = { status: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
  await withDistributionTransition(async () => {
    settings.cloudflareAddressMigrationPending = true;
    await controller.uploadVideo(request as never, reply as never);
  });
  expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ isError: false }));
  expect(write).toHaveBeenCalledOnce();
});


it('AUDIT: a stale worker settings write erases committed CDN and recovery fields', async () => {
  const { Config } = await vi.importActual<typeof import('@/config/index.js')>('@/config/index.js');
  const { NodeSettingsSchema } = await import('@/config/schema.js');
  const initial = NodeSettingsSchema.parse({ username: 'user', password: 'password', nodeListeningPort: 9090, storageConfig: { storageMode: 'filesystem' }, databaseConfig: { databaseDialect: 'sqlite' } });
  const file = path.join(directory, 'stale-workers.json');
  const worker = () => Object.assign(Object.create(Config.prototype), {
    _nodeSettings: { ...initial }, _paths: { nodeSettingsPath: file },
  });
  const first = worker();
  const second = worker();
  first.updateNodeSettings({ isCloudflareCdnEnabled: true, publicNodeProtocol: 'https', publicNodeAddress: 'example.com', publicNodePort: 443,
    cloudflareAddressMigrationPending: true,
    cloudflarePublicAddressBackup: { publicNodeProtocol: 'http', publicNodeAddress: 'localhost', publicNodePort: 9090 } });
  second.updateNodeSettings({ nodeName: 'Unrelated name change' });
  const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(persisted.cloudflareAddressMigrationPending).toBe(false);
  expect(persisted.isCloudflareCdnEnabled).toBe(false);
  expect(persisted.cloudflarePublicAddressBackup).toBeUndefined();
});

it('AUDIT: a stale retry after completion can fail migration without reestablishing the job block', async () => {
  await configure();
  expect(settings.cloudflareAddressMigrationPending).toBe(false);
  cloudflare.retryPendingPurges.mockRejectedValueOnce(new Error('pending purge failure'));
  const result = await app.inject({ method: 'POST', url: '/settings/cloudflare/retry', headers: { authorization: 'Bearer test' }, payload: {} });
  expect(result.statusCode).toBe(502);
  expect(result.json().cloudflareAddressMigrationPending).toBe(false);
  await expect(withJobAdmission(async () => 'admitted')).resolves.toBe('admitted');
});

it('AUDIT: saved restart state after removal commit has no old-zone final purge target for recovery', async () => {
  await configure();
  const original = settings.cloudflarePublicAddressBackup as object;
  // Exact persisted state if the process dies after clearCloudflareConfig and before final invalidation.
  Object.assign(settings, original, { isCloudflareCdnEnabled: false, cloudflareAddressMigrationPending: true,
    cloudflareEmailAddress: '', cloudflareGlobalApiKey: '', cloudflareZoneId: '' });
  cloudflare.purgeEntireCacheWithCredentials.mockClear();
  const result = await app.inject({ method: 'POST', url: '/settings/cloudflare/retry', headers: { authorization: 'Bearer test' }, payload: {} });
  expect(result.statusCode).toBe(200);
  expect(settings.cloudflareAddressMigrationPending).toBe(false);
  expect(cloudflare.purgeEntireCacheWithCredentials).not.toHaveBeenCalled();
});

it('AUDIT: successful CDN removal leaves zone HTTPS, cache level and browser TTL changed', async () => {
  const axios = (await import('axios')).default;
  const { CloudflareService } = await import('@/services/cloudflare.js');
  const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ data: { success: true } });
  const put = vi.spyOn(axios, 'put').mockResolvedValue({ data: { success: true } });
  const get = vi.spyOn(axios, 'get').mockResolvedValue({ data: { success: true, result: [] } });
  try {
    const service = new CloudflareService({ info: vi.fn(), error: vi.fn() } as never, {} as never);
    await service.setCdnConfiguration('email', 'zone', 'key');
    await service.resetCdn('email', 'zone', 'key');
    for (const suffix of ['always_use_https', 'cache_level', 'browser_cache_ttl']) {
      expect(patch.mock.calls.filter(([url]) => String(url).endsWith('/' + suffix))).toHaveLength(1);
    }
  } finally { patch.mockRestore(); put.mockRestore(); get.mockRestore(); }
});


it.each(['credentials', 'zone', 'validation', 'provider', 'dns', 'initial-purge', 'settings-save', 'final-purge', 'reconcile', 'wrong-mode', 'completion-save'])(
  'AUDIT sweep: enable failure at %s preserves the appropriate saved-state block', async (stage) => {
    const config = mocks.config();
    const fail = new Error('injected ' + stage);
    if (stage === 'credentials') mocks.credentials.mockResolvedValueOnce(false);
    if (stage === 'zone') cloudflare.resolveCdnPublicAddress.mockRejectedValueOnce(fail);
    if (stage === 'validation') cloudflare.validateCdnConfiguration.mockRejectedValueOnce(fail);
    if (stage === 'provider') cloudflare.setCdnConfiguration.mockRejectedValueOnce(fail);
    if (stage === 'dns') cloudflare.addCdnDnsRecord.mockRejectedValueOnce(fail);
    if (stage === 'initial-purge') cloudflare.purgeEntireCacheWithCredentials.mockRejectedValueOnce(fail);
    if (stage === 'final-purge') cloudflare.purgeEntireCacheWithCredentials.mockResolvedValueOnce(undefined).mockRejectedValueOnce(fail);
    if (stage === 'reconcile') mocks.operation.mockRejectedValueOnce(fail);
    if (stage === 'wrong-mode') mocks.operation.mockResolvedValueOnce({ status: 'running', mode: 'quick', name: 'old' });
    if (stage === 'settings-save' || stage === 'completion-save') {
      const update = config.updateNodeSettings;
      config.updateNodeSettings = (data: Record<string, unknown>) => {
        if ((stage === 'settings-save' && data.isCloudflareCdnEnabled === true) ||
            (stage === 'completion-save' && data.cloudflareAddressMigrationPending === false)) throw fail;
        update(data);
      };
    }
    const response = await configure();
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const committed = ['final-purge', 'reconcile', 'wrong-mode', 'completion-save'].includes(stage);
    expect(settings.isCloudflareCdnEnabled).toBe(committed);
    expect(settings.cloudflareAddressMigrationPending === true).toBe(committed);
    if (committed) await expect(withJobAdmission(async () => {})).rejects.toThrow('retry');
  });

it.each(['provider', 'initial-purge', 'restore-dns', 'settings-save', 'final-purge', 'reconcile', 'completion-save'])(
  'AUDIT sweep: disable failure at %s preserves the appropriate saved-state block', async (stage) => {
    await configure();
    const fail = new Error('injected ' + stage);
    if (stage === 'provider') cloudflare.resetCdn.mockRejectedValueOnce(fail);
    if (stage === 'initial-purge') cloudflare.purgeEntireCacheWithCredentials.mockRejectedValueOnce(fail);
    if (stage === 'final-purge') cloudflare.purgeEntireCacheWithCredentials.mockResolvedValueOnce(undefined).mockRejectedValueOnce(fail);
    if (stage === 'restore-dns') mocks.operation.mockRejectedValueOnce(fail);
    if (stage === 'reconcile') mocks.operation.mockImplementationOnce(async () => ({ mode: 'named', status: 'running', name: 'old' })).mockRejectedValueOnce(fail);
    if (stage === 'settings-save' || stage === 'completion-save') {
      const config = mocks.config(); const update = config.updateNodeSettings;
      config.updateNodeSettings = (data: Record<string, unknown>) => {
        if ((stage === 'settings-save' && data.isCloudflareCdnEnabled === false) ||
            (stage === 'completion-save' && data.cloudflareAddressMigrationPending === false)) throw fail;
        update(data);
      };
    }
    const response = await clear();
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    const committed = ['final-purge', 'reconcile', 'completion-save'].includes(stage);
    expect(settings.isCloudflareCdnEnabled).toBe(!committed);
    expect(settings.cloudflareAddressMigrationPending === true).toBe(committed);
    if (committed) await expect(withJobAdmission(async () => {})).rejects.toThrow('retry');
  });

it.each([true, false])('AUDIT sweep: failed media recovery for CDN=%s retains pending state', async (enabled) => {
  await configure();
  if (!enabled) await clear();
  settings.cloudflareAddressMigrationPending = true;
  videoRecords = [{ videoId: 'video123', outputs: { m3u8: ['720p'] } }];
  const folder = path.join(directory, 'video123', 'adaptive', 'm3u8');
  fs.mkdirSync(folder, { recursive: true });
  fs.mkdirSync(path.join(folder, 'manifest-720p.m3u8')); // deterministic read failure
  const result = await app.inject({ method: 'POST', url: '/settings/cloudflare/retry', headers: { authorization: 'Bearer test' }, payload: {} });
  expect(result.statusCode).toBe(502);
  expect(settings.cloudflareAddressMigrationPending).toBe(true);
});
