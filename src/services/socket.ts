import type { Logger } from 'pino';
import { WebSocket } from 'ws';

export class SocketService {
    private readonly clients: Map<WebSocket, string | undefined> = new Map();

    constructor(private readonly logger: Logger) {}

    public handleConnection(socket: WebSocket, key?: string): void {
        this.clients.set(socket, key);
        this.logger.info(`[SocketService] Client connected (Key: ${key !== undefined && key !== '' ? 'Provided' : 'None'})`);

        socket.on('close', () => {
             this.clients.delete(socket);
             this.logger.info('[SocketService] Client disconnected');
        });
        
        socket.on('error', (err) => {
            this.logger.error(`[SocketService] Socket error: ${err instanceof Error ? err.message : String(err)}`);
        });

        // Optional: specific messages from client
        socket.on('message', (message) => {
             let msgContent = '';
             if (message instanceof ArrayBuffer) {
                 msgContent = Buffer.from(message).toString();
             } else if (Buffer.isBuffer(message)) {
                 msgContent = message.toString();
             } else if (Array.isArray(message)) {
                 msgContent = Buffer.concat(message).toString();
             } else {
                 msgContent = String(message);
             }
             this.logger.debug(`[SocketService] Received: ${msgContent}`);
        });
    }

    public broadcast(event: string, data: unknown): void {
        // Wrap data in format expected by listeners
        // If data already contains eventName, use it, otherwise wrap.
        // Legacy "echo" event passes { eventName: '...', ...payload } directly.
        // If 'event' is the eventName, we construct the payload.
        
        let payload: unknown;
        if (typeof data === 'object' && data !== null) {
            const dataObj = data as Record<string, unknown>;
            // Explicit check for undefined or empty string if that's what we mean, or just truthiness cast
            const eventName = dataObj['eventName'] as string | undefined;
            if (eventName === undefined || eventName === '') {
                payload = { eventName: event, ...dataObj };
            } else {
                 // If data already has eventName, verify it matches or just send it
                 payload = data;
            }
        } else {
             payload = { eventName: event, data };
        }

        const message = JSON.stringify(payload);
        // this.logger.debug(`[SocketService] Broadcasting: ${message}`);
        
        for (const client of this.clients.keys()) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    public broadcastToUser(key: string, event: string, data: unknown): void {
        const payload = this.createPayload(event, data);
        const message = JSON.stringify(payload);

        this.logger.debug(`[SocketService] Broadcasting event to user (key provided): ${event}`);

        for (const [client, clientKey] of this.clients) {
            if (clientKey === key && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        }
    }

    private createPayload(event: string, data: unknown): unknown {
        if (typeof data === 'object' && data !== null) {
            const dataObj = data as Record<string, unknown>;
            const eventName = dataObj['eventName'] as string | undefined;
            if (eventName === undefined || eventName === '') {
                return { eventName: event, ...dataObj };
            } else {
                 return data;
            }
        } else {
             return { eventName: event, data };
        }
    }
}
