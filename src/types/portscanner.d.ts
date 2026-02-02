declare module 'portscanner' {
    export function checkPortStatus(port: number, host: string): Promise<string>;
}
