import type { FastifyInstance } from 'fastify';
import type { Container } from '@/core/container.js';
import { SettingsController } from '@/controllers/settings.js';

export function settingsRoutes(
  fastify: FastifyInstance & ReturnType<FastifyInstance['withTypeProvider']>,
  container: Container
): void {
  const logger = container.resolve('logger');
  const config = container.resolve('config');
  const nodeApiService = container.resolve('nodeApiService');
  const s3Service = container.resolve('s3Service');

  const settingsController = new SettingsController(logger, config, nodeApiService, s3Service);

  // View
  fastify.get('/', {
    schema: { tags: ['Settings'] }
  }, settingsController.getSettingsPage.bind(settingsController));

  // Client API
  fastify.get('/client', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetClientSettings.bind(settingsController));

  fastify.post('/client/encoding', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetClientEncoding.bind(settingsController));

  fastify.post('/client/gpuAcceleration', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetGpuAcceleration.bind(settingsController));

  // Node API
  fastify.get('/node', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetNodeSettings.bind(settingsController));
  
  fastify.get('/node/avatar', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetNodeAvatar.bind(settingsController));

  fastify.post('/node/avatar', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeAvatar.bind(settingsController));

  fastify.get('/node/banner', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetNodeBanner.bind(settingsController));

  fastify.post('/node/banner', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeBanner.bind(settingsController));

  fastify.post('/node/personalize/name', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeName.bind(settingsController));

  fastify.post('/node/personalize/about', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeAbout.bind(settingsController));

  fastify.post('/node/personalize/id', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeId.bind(settingsController));

  fastify.post('/node/network/secure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetSecureConnection.bind(settingsController));

  fastify.post('/node/network/internal', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNetworkInternal.bind(settingsController));

  fastify.post('/node/network/external', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNetworkExternal.bind(settingsController));

  // Cloudflare
  fastify.post('/node/cloudflare/configure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetCloudflareConfig.bind(settingsController));

  fastify.post('/node/cloudflare/clear', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiClearCloudflareConfig.bind(settingsController));

  fastify.post('/node/cloudflare/turnstile/configure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetTurnstileConfig.bind(settingsController));

  fastify.post('/node/cloudflare/turnstile/clear', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiClearTurnstileConfig.bind(settingsController));

  // Toggles
  fastify.post('/node/comments/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleComments.bind(settingsController));

  fastify.post('/node/likes/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleLikes.bind(settingsController));

  fastify.post('/node/dislikes/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleDislikes.bind(settingsController));

  fastify.post('/node/reports/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleReports.bind(settingsController));

  fastify.post('/node/liveChat/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleLiveChat.bind(settingsController));

  // Database / Storage
  fastify.post('/node/database/config/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleDatabase.bind(settingsController));

  fastify.post('/node/storage/config/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleStorage.bind(settingsController));

  fastify.post('/node/account', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetAccountCredentials.bind(settingsController));
}
