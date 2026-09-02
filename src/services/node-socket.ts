import { Buffer } from 'node:buffer';
import WebSocket from 'ws';
import { BaseService } from './base.js';
import type { Logger } from '@/utils/logger.js';
import type { Config } from '@/config/index.js';
import type { SocketService } from './socket.js';
import type { VideoPublishService } from './video-publish.js';
import type { LiveStreamService } from './live-stream.js';
import type { VideoImportService } from './video-import.js';

export class NodeSocketService extends BaseService {
  private websocketClient: WebSocket | null = null;
  private pingIntervalTimer: NodeJS.Timeout | null = null;
  private pingTimeoutTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _isConnected = false;
  private shouldReconnect = false;

  constructor(
    logger: Logger,
    private readonly config: Config,
    private readonly socketService: SocketService,
    private readonly videoPublishService: VideoPublishService,
    private readonly liveStreamService: LiveStreamService,
    private readonly videoImportService: VideoImportService
  ) {
    super('nodeSocketService', logger);
  }

  public get isConnected(): boolean {
    return this._isConnected;
  }

  public connect(jwtToken: string): void {
    // A new connection always replaces the previous one. This also cancels a
    // reconnect that may have been scheduled by an older connection.
    this.disconnect();
    this.shouldReconnect = true;

    this.openConnection(jwtToken);
  }

  private openConnection(jwtToken: string): void {
    const settings = this.config.clientSettings;
    const url = `${settings.nodeWebsocketProtocol}://${settings.nodeIp}:${String(settings.nodePort)}`;
    this.logger.info(`Connecting to Node WebSocket at ${url}`);

    const websocketClient = new WebSocket(url);
    this.websocketClient = websocketClient;

    websocketClient.on('open', () => {
      if (this.websocketClient !== websocketClient || !this.shouldReconnect) {
        websocketClient.terminate();
        return;
      }

      this.logger.info(`Validating connection to Node: ${url}`);
      this._isConnected = true;
      websocketClient.send(
        JSON.stringify({
          eventName: 'register',
          socketType: 'moartube_client',
          jwtToken: jwtToken,
        })
      );

      this.startPingPong(jwtToken, url, websocketClient);
    });

    websocketClient.on('message', (message: WebSocket.Data) => {
      if (this.websocketClient === websocketClient) {
        this.handleMessage(message);
      }
    });

    websocketClient.on('close', () => {
      // A replaced socket may still emit close after its replacement has been
      // created. It must not clear or reconnect the active socket.
      if (this.websocketClient !== websocketClient) {
        return;
      }

      this.logger.info(`Disconnected from Node: ${url}`);
      this.websocketClient = null;
      this.cleanup();

      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.shouldReconnect) {
            return;
          }
          this.openConnection(jwtToken);
        }, 1000);
      }
    });

    websocketClient.on('error', (err) => {
      if (this.websocketClient === websocketClient) {
        this.logger.error('WebSocket error', err);
      }
    });
  }

  public disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.websocketClient) {
      const websocketClient = this.websocketClient;
      this.websocketClient = null;
      websocketClient.removeAllListeners('close');
      websocketClient.terminate();
    }
    this.cleanup();
  }

  public send(message: unknown): void {
    if (
      !this.websocketClient ||
      !this.isConnected ||
      this.websocketClient.readyState !== WebSocket.OPEN
    ) {
      this.logger.warn('Cannot send WebSocket message: Node connection is not open');
      return;
    }

    this.websocketClient.send(JSON.stringify(message));
  }

  /**
   * Broadcast a video_status echo to the Node, which relays it back to every
   * connected client (see handleVideoStatusEcho below). Used for status
   * transitions such as "publishing_stopping"/"streaming_stopping" so any
   * other connected admin clients stay in sync, and for the "_stopped"
   * transitions the browser UI listens for directly.
   */
  public sendVideoStatusEcho(jwtToken: string, type: string, videoId: string): void {
    this.send({
      eventName: 'echo',
      jwtToken,
      data: {
        eventName: 'video_status',
        payload: { type, videoId },
      },
    });
  }

  private startPingPong(jwtToken: string, url: string, websocketClient: WebSocket): void {
    this.pingIntervalTimer = setInterval(() => {
      if (this.websocketClient !== websocketClient) {
        return;
      }

      if (!this.pingTimeoutTimer) {
        this.pingTimeoutTimer = setTimeout(() => {
          this.logger.warn(`Terminating unresponsive connection to ${url}`);
          this.disconnect();
        }, 3000);

        // this.logger.info(`Sending ping... Token starts with: ${jwtToken.substring(0, 5)}`);
        websocketClient.send(JSON.stringify({ eventName: 'ping', jwtToken }));
      }
    }, 1000);
  }

  private cleanup(): void {
    this._isConnected = false;
    if (this.pingIntervalTimer) {
      clearInterval(this.pingIntervalTimer);
    }
    if (this.pingTimeoutTimer) {
      clearTimeout(this.pingTimeoutTimer);
    }
    this.pingIntervalTimer = null;
    this.pingTimeoutTimer = null;
  }

  private handleMessage(message: WebSocket.Data): void {
    try {
      let msgStr: string;
      if (Buffer.isBuffer(message)) {
        msgStr = message.toString();
      } else if (Array.isArray(message)) {
        msgStr = Buffer.concat(message).toString();
      } else if (message instanceof ArrayBuffer) {
        msgStr = Buffer.from(message).toString();
      } else {
        msgStr = message;
      }

      // this.logger.info(`WebSocket message received: ${msgStr.substring(0, 200)}`);

      const parsedMessage = JSON.parse(msgStr) as { eventName?: string; data?: unknown };

      if (parsedMessage.eventName === 'pong') {
        // this.logger.info('Received pong from Node');
        if (this.pingTimeoutTimer) {
          clearTimeout(this.pingTimeoutTimer);
          this.pingTimeoutTimer = null;
        }
      } else if (parsedMessage.eventName === 'registered') {
        this.logger.info('Registered with MoarTube Node');
      } else if (parsedMessage.eventName === 'echo') {
        this.handleEchoEvent(parsedMessage.data);
      }
    } catch (err) {
      this.logger.error('Error parsing WebSocket message', err);
    }
  }

  private handleEchoEvent(data: unknown): void {
    if (data === undefined || data === null || typeof data !== 'object') {
      return;
    }

    const echoData = data as { eventName?: string; payload?: unknown };

    if (echoData.eventName === 'video_status') {
      this.handleVideoStatusEcho(echoData.payload, data, echoData.eventName);
    } else if (echoData.eventName === 'video_data') {
      this.socketService.broadcast(echoData.eventName, data);
    }
  }

  private handleVideoStatusEcho(payload: unknown, originalData: unknown, eventName: string): void {
    const p = payload as { videoId: string; type: string } | undefined;

    if (!p) {
      return;
    }

    const { videoId, type } = p;

    switch (type) {
      case 'importing_stopping':
        this.videoImportService.stoppingVideoImport(videoId);
        break;
      case 'importing_stopped':
        this.videoImportService.stoppedVideoImport(videoId, originalData);
        break;
      case 'publishing_stopping':
        this.videoPublishService.stoppingPublishVideoEncoding(videoId);
        break;
      case 'publishing_stopped':
        this.videoPublishService.stopPendingPublishVideo(videoId);
        this.socketService.broadcast('echo', originalData);
        break;
      case 'streaming_stopping':
        this.liveStreamService.stopLiveStream(videoId);
        break;
      case 'streaming_stopped':
        this.socketService.broadcast('echo', originalData);
        break;
      default:
        this.socketService.broadcast(eventName, originalData);
        break;
    }
  }
}
