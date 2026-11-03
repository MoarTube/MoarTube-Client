import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { VideoPublishService } from '../src/services/video-publish.js';

interface EncodingMonitor {
  process: EventEmitter & { kill: Mock };
  stdout: PassThrough;
  stderr: PassThrough;
  progress: number[];
  resolve: Mock;
  reject: Mock;
  untrack: Mock;
  service: VideoPublishService;
}

describe('publishing structured FFmpeg progress', () => {
  afterEach(() => vi.restoreAllMocks());

  function monitor(): EncodingMonitor {
    const stdout = new PassThrough(),
      stderr = new PassThrough();
    const process = Object.assign(new EventEmitter(), { stdout, stderr, kill: vi.fn() });
    const progress: number[] = [];
    const service = Object.create(VideoPublishService.prototype) as VideoPublishService;
    Object.assign(service, {
      cancelled: new Set(),
      activeEncodingJobs: new Map(),
      closing: false,
      pendingPublishVideoQueue: [],
      inProgressPublishingJobs: [],
      socketService: {
        broadcastToUser: (
          _token: string,
          _event: string,
          data: { payload: { progress: number } }
        ) => progress.push(data.payload.progress),
      },
    });
    const resolve = vi.fn(),
      reject = vi.fn(),
      untrack = vi.fn();
    service['monitorEncodingProcess'](
      process as unknown as ChildProcess,
      {
        videoId: 'test',
        jwtToken: 'test',
        format: 'mp4',
        resolution: '720p',
        sourceFileExtension: '.mp4',
        progress: 0,
        stage: 'encoding',
      },
      resolve,
      reject,
      untrack
    );
    return { process, stdout, stderr, progress, resolve, reject, untrack, service };
  }

  it.each([
    ['one record per chunk', ['out_time_us=2000000\n', 'out_time_us=4000000\n']],
    [
      'multiple records in one chunk',
      ['out_time_us=2000000\nprogress=continue\nout_time_us=4000000\nprogress=end\n'],
    ],
    ['split keys and timestamps', ['out_ti', 'me_us=20', '00000\r', '\nout_time_us=', '4000000\n']],
  ])('handles %s', (_name, chunks) => {
    const run = monitor();
    run.stderr.write('Dura');
    run.stderr.write('tion: 00:00:04.00, start: 0\nframe=0 time=00:00:00.00\r');
    for (const chunk of chunks) {
      run.stdout.write(chunk);
    }
    expect(run.progress).toEqual([25, 49]);
    run.process.emit('exit', 0);
    expect(run.resolve).not.toHaveBeenCalled();
    run.stdout.end();
    run.stderr.end();
    run.process.emit('close', 0);
    expect(run.progress).toEqual([25, 49, 50]);
    expect(run.resolve).toHaveBeenCalledOnce();
    expect(run.untrack).toHaveBeenCalledOnce();
  });

  it('handles progress arriving before duration and ignores invalid or backward timestamps', () => {
    const run = monitor();
    run.stdout.write('out_time_us=N/A\nout_time_us=-1000\nout_time_us=2000000\n');
    expect(run.progress).toEqual([]);
    run.stderr.write('Duration: 00:00:04.00\n');
    expect(run.progress).toEqual([25]);
    run.stdout.write('out_time_us=1000000\nout_time_us=Infinity\n');
    expect(run.progress).toEqual([25]);
    run.stdout.end();
    run.stderr.end();
    run.process.emit('close', 0);
  });

  it('keeps error diagnostics bounded and does not report completion on failure', () => {
    const run = monitor();
    run.stderr.write('x'.repeat(100000) + 'encoder failed');
    run.stdout.end();
    run.stderr.end();
    run.process.emit('close', 1);
    expect(run.resolve).not.toHaveBeenCalled();
    expect(run.progress).toEqual([]);
    expect(run.reject).toHaveBeenCalledOnce();
    const error = run.reject.mock.calls[0]?.[0] as Error;
    expect(error.message).toContain('encoder failed');
    expect(error.message.length).toBeLessThan(66000);
  });

  it('waits for the complete duration when its fractional seconds span chunks', () => {
    const run = monitor();
    run.stderr.write('Duration: 00:00:04');
    run.stdout.write('out_time_us=2250000\n');
    expect(run.progress).toEqual([]);
    run.stderr.write('.50, start: 0\n');
    expect(run.progress).toEqual([25]);
    run.stdout.end();
    run.stderr.end();
    run.process.emit('close', 0);
  });

  it('suppresses progress after cancellation', () => {
    const run = monitor();
    run.service.stoppingPublishVideoEncoding('test');
    run.stdout.write('out_time_us=2000000\n');
    run.stderr.write('Duration: 00:00:04.00\n');
    run.stdout.end();
    run.stderr.end();
    run.process.emit('close', 0);
    expect(run.process.kill).toHaveBeenCalled();
    expect(run.progress).toEqual([]);
  });
});
