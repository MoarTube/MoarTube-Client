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
  private _isConnected = false;

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
    if (this.websocketClient) {
      this.disconnect();
    }

    const settings = this.config.clientSettings;
    const url = `${settings.nodeWebsocketProtocol}://${settings.nodeIp}:${String(settings.nodePort)}`;
    this.logger.info(`Connecting to Node WebSocket at ${url}`);

    this.websocketClient = new WebSocket(url);

    this.websocketClient.on('open', () => {
      this.logger.info(`Validating connection to Node: ${url}`);
      this._isConnected = true;
      this.websocketClient?.send(JSON.stringify({ 
        eventName: 'register', 
        socketType: 'moartube_client', 
        jwtToken: jwtToken 
      }));

      this.startPingPong(jwtToken, url);
    });

    this.websocketClient.on('message', (message: WebSocket.Data) => {
      this.handleMessage(message);
    });

    this.websocketClient.on('close', () => {
      this.logger.info(`Disconnected from Node: ${url}`);
      this.cleanup();
      // Auto-reconnect logic? Legacy does: setTimeout(connectWebsocketClient, 1000);
      setTimeout(() => { this.connect(jwtToken); }, 1000);
    });

    this.websocketClient.on('error', (err) => {
      this.logger.error('WebSocket error', err);
    });
  }

  public disconnect(): void {
    if (this.websocketClient) {
      this.websocketClient.terminate();
      this.websocketClient = null;
    }
    this.cleanup();
  }

  private startPingPong(jwtToken: string, url: string): void {
     this.pingIntervalTimer = setInterval(() => {
        if (!this.pingTimeoutTimer) {
             this.pingTimeoutTimer = setTimeout(() => {
                 this.logger.warn(`Terminating unresponsive connection to ${url}`);
                 this.disconnect();
                 // Reconnect happens in 'close' handler or manually?
                 // Legacy calls terminate() which triggers close.
             }, 3000);

             this.websocketClient?.send(JSON.stringify({ eventName: 'ping', jwtToken }));
        }
     }, 1000);
  }

  private cleanup(): void {
      this._isConnected = false;
      if (this.pingIntervalTimer) {clearInterval(this.pingIntervalTimer);}
      if (this.pingTimeoutTimer) {clearTimeout(this.pingTimeoutTimer);}
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

          const parsedMessage = JSON.parse(msgStr) as { eventName?: string; data?: unknown };

          if (parsedMessage.eventName === 'pong') {
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
