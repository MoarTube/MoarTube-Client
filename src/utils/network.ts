import os from 'os';
import portscanner from 'portscanner';

export function getNetworkAddresses(): string[] {
    const networkInterfaces = os.networkInterfaces();

    const ipv4Addresses: string[] = ['127.0.0.1'];
    const ipv6Addresses: string[] = ['::1'];

    for (const networkInterfaceKey of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[networkInterfaceKey];

        if (networkInterface) {
            for (const networkInterfaceElement of networkInterface) {
                const networkAddress = networkInterfaceElement.address;

                if (networkInterfaceElement.family === 'IPv4' && networkAddress !== '127.0.0.1') {
                    ipv4Addresses.push(networkAddress);
                }
                else if (networkInterfaceElement.family === 'IPv6' && networkAddress !== '::1') {
                    ipv6Addresses.push(networkAddress);
                }
            }
        }
    }

    return ipv4Addresses.concat(ipv6Addresses);
}

 
export async function checkNetworkPortStatus(port: number, host: string): Promise<string> {
    // Portscanner types might be missing, so we trust it returns string
     
    return await portscanner.checkPortStatus(port, host);
}

export function isPortValid(port: any): boolean {
    const portNumber = parseInt(port, 10);
    return !isNaN(portNumber) && portNumber > 0 && portNumber <= 65535;
}
