import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config/index.js';
import type { Container } from '../src/core/container.js';
import type { FfmpegService } from '../src/services/ffmpeg.js';
import type { NodeApiService } from '../src/services/node-api.js';
import type { S3Service } from '../src/services/s3.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

vi.mock('../src/utils/hardware.js', () => ({
  detectSystemCpu: () =>
    Promise.resolve({ processingAgentName: 'CPU', processingAgentModel: 'Test CPU' }),
}));
import { SettingsController } from '../src/controllers/settings.js';
import { LifecycleManager } from '../src/core/lifecycle.js';

const gpu = {
  id: 'AMD:0000:03:00.0',
  processingAgentName: 'AMD',
  processingAgentModel: 'Test Radeon',
  deviceIndex: 129,
  backend: 'vaapi',
  renderDevice: '/dev/dri/renderD129',
  available: true,
};
const mac = {
  id: 'videotoolbox:default',
  processingAgentName: 'VideoToolbox',
  processingAgentModel: 'macOS hardware video',
  deviceIndex: 0,
  backend: 'videotoolbox',
  available: true,
};
const assess = vi.fn();
const save = vi.fn();
const config = {
  clientSettings: {
    processingAgent: {
      processingAgentType: 'gpu',
      gpuId: gpu.id,
      renderDevice: '/dev/dri/renderD128',
    },
  },
  saveClientSettings: save,
} as unknown as Config;

beforeEach(() => {
  vi.clearAllMocks();
  assess.mockResolvedValue([gpu]);
});

describe('GPU settings and startup', () => {
  const intelDevices = [
    {
      ...gpu,
      id: 'Intel:adapter',
      processingAgentName: 'Intel',
      backend: 'qsv',
      deviceIndex: 3,
      renderDevice: undefined,
    },
    { ...gpu, id: 'Intel:0000:00:02.0', processingAgentName: 'Intel' },
  ];

  it.each(intelDevices)(
    'persists a usable Intel $backend device after a fresh probe',
    async (intel) => {
      assess.mockResolvedValue([intel]);
      const reply = await select(intel.id);
      expect(assess).toHaveBeenCalledWith(true);
      expect(save).toHaveBeenCalledWith({
        processingAgent: expect.objectContaining({
          processingAgentType: 'gpu',
          gpuId: intel.id,
          backend: intel.backend,
          deviceIndex: intel.deviceIndex,
          renderDevice: intel.renderDevice,
        }),
      });
      expect(reply.status).toHaveBeenCalledWith(200);
    }
  );

  it.each(intelDevices)(
    'restores Intel $backend by identity and refreshes device information',
    async (intel) => {
      const previous = config.clientSettings.processingAgent;
      try {
        config.clientSettings.processingAgent = {
          processingAgentType: 'gpu',
          gpuId: intel.id,
          deviceIndex: 0,
        };
        assess.mockResolvedValue([intel]);
        await startup();
        expect(save).toHaveBeenCalledWith({
          processingAgent: expect.objectContaining({
            gpuId: intel.id,
            backend: intel.backend,
            deviceIndex: intel.deviceIndex,
            renderDevice: intel.renderDevice,
          }),
        });
      } finally {
        config.clientSettings.processingAgent = previous;
      }
    }
  );
  async function select(
    gpuId: string
  ): Promise<{ status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }> {
    const reply = { status: vi.fn(), send: vi.fn() };
    reply.status.mockReturnValue(reply);
    const controller = new SettingsController(
      config,
      {} as NodeApiService,
      {} as S3Service,
      { assessGpus: assess } as unknown as FfmpegService
    );
    await controller.apiSetGpuAcceleration(
      { body: { gpuId } } as FastifyRequest,
      reply as unknown as FastifyReply
    );
    return reply;
  }

  it('persists a usable Linux backend and render device after a fresh probe', async () => {
    const reply = await select(gpu.id);
    expect(assess).toHaveBeenCalledWith(true);
    expect(save).toHaveBeenCalledWith({
      processingAgent: expect.objectContaining({
        processingAgentType: 'gpu',
        backend: 'vaapi',
        renderDevice: '/dev/dri/renderD129',
      }),
    });
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it('persists a usable macOS VideoToolbox selection', async () => {
    assess.mockResolvedValue([mac]);
    const reply = await select(mac.id);
    expect(assess).toHaveBeenCalledWith(true);
    expect(save).toHaveBeenCalledWith({
      processingAgent: expect.objectContaining({
        processingAgentType: 'gpu',
        gpuId: mac.id,
        backend: 'videotoolbox',
        processingAgentName: 'VideoToolbox',
      }),
    });
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it('rejects a failed GPU probe without replacing the saved selection', async () => {
    assess.mockResolvedValue([
      { ...gpu, available: false, unavailableReason: 'Driver unavailable' },
    ]);
    const reply = await select(gpu.id);
    expect(reply.status).toHaveBeenCalledWith(400);
    expect(save).not.toHaveBeenCalled();
  });

  it('allows CPU selection without probing hardware', async () => {
    await select('');
    expect(assess).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({
      processingAgent: expect.objectContaining({ processingAgentType: 'cpu' }),
    });
  });

  async function startup(): Promise<void> {
    const services = {
      config,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      ffmpegService: {
        assessGpus: assess,
        getDiagnostics: () => Promise.resolve({ path: '/test/ffmpeg', version: 'test' }),
      },
    };
    const lifecycle = new LifecycleManager({
      resolve: (name: keyof typeof services) => services[name],
    } as unknown as Container);
    await lifecycle['performEncodingDecodingAssessment']();
  }

  it('restores a Linux GPU by identity and refreshes its changed render node', async () => {
    await startup();
    expect(save).toHaveBeenCalledWith({
      processingAgent: expect.objectContaining({
        gpuId: gpu.id,
        backend: 'vaapi',
        renderDevice: '/dev/dri/renderD129',
      }),
    });
  });

  it('restores a saved macOS VideoToolbox backend at startup', async () => {
    const previous = config.clientSettings.processingAgent;
    try {
      config.clientSettings.processingAgent = {
        processingAgentType: 'gpu',
        gpuId: mac.id,
        backend: 'videotoolbox',
      };
      assess.mockResolvedValue([mac]);
      await startup();
      expect(save).toHaveBeenCalledWith({
        processingAgent: expect.objectContaining({
          gpuId: mac.id,
          backend: 'videotoolbox',
          processingAgentName: 'VideoToolbox',
        }),
      });
    } finally {
      config.clientSettings.processingAgent = previous;
    }
  });

  it('falls back to CPU at startup if the saved GPU is unusable', async () => {
    assess.mockResolvedValue([{ ...gpu, available: false }]);
    await startup();
    expect(save).toHaveBeenCalledWith({
      processingAgent: expect.objectContaining({ processingAgentType: 'cpu' }),
    });
  });
});
