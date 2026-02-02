export interface Env {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  isDockerEnvironment: boolean;
}

export function getEnv(): Env {
  const nodeEnv = (process.env['NODE_ENV'] as Env['nodeEnv']) || 'development';

  return {
    port: Number(process.env['PORT']) || 3000,
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    isDockerEnvironment: process.env['DOCKER_ENV'] === 'true',
  };
}
