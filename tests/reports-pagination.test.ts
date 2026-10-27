import { describe, expect, it, vi } from 'vitest';
import { ReportsController } from '../src/controllers/reports.js';
import type { NodeApiService } from '../src/services/node-api.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

describe('moderation pagination', () => {
  it('keeps older reports accessible with independent report/archive pages and search', async () => {
    const api = {
      isAuthenticated: vi.fn().mockResolvedValue({ isAuthenticated: true }),
      getNodeSettings: vi.fn().mockResolvedValue({}),
      getNewContentCounts: vi.fn().mockResolvedValue({ newContentCounts: {} }),
      getVideoReports: vi.fn().mockResolvedValue({ reports: [], hasMore: true }),
      getVideoReportsArchive: vi.fn().mockResolvedValue({ reports: [], hasMore: false }),
      setContentChecked: vi.fn(),
    };
    const controller = new ReportsController(api as unknown as NodeApiService);
    const reply = { view: vi.fn(), redirect: vi.fn() };
    await controller.getVideosRoot(
      {
        session: { jwtToken: 'token' },
        query: { page: '2', archivePage: '3', search: 'spam' },
      } as unknown as FastifyRequest,
      reply as unknown as FastifyReply
    );
    expect(api.getVideoReports).toHaveBeenCalledWith('token', { offset: 200, search: 'spam' });
    expect(api.getVideoReportsArchive).toHaveBeenCalledWith('token', {
      offset: 300,
      search: 'spam',
    });
    expect(reply.view).toHaveBeenCalledWith(
      'reports-videos',
      expect.objectContaining({
        model: expect.objectContaining({
          reportPage: 2,
          archivePage: 3,
          reportHasMore: true,
        }) as unknown,
      })
    );
  });
});
