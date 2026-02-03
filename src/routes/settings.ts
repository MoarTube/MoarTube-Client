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
  fastify.get('/settings/client', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetClientSettings.bind(settingsController));

  fastify.post('/settings/client/encoding', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetClientEncoding.bind(settingsController));

  fastify.post('/settings/client/gpu-acceleration', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetGpuAcceleration.bind(settingsController));

  // Node API
  fastify.get('/settings/node', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiGetNodeSettings.bind(settingsController));
  
  fastify.post('/settings/node/avatar', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeAvatar.bind(settingsController));

  fastify.post('/settings/node/banner', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeBanner.bind(settingsController));

  fastify.post('/settings/node/personalize/name', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeName.bind(settingsController));

  fastify.post('/settings/node/personalize/about', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeAbout.bind(settingsController));

  fastify.post('/settings/node/personalize/id', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNodeId.bind(settingsController));

  fastify.post('/settings/node/network/secure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetSecureConnection.bind(settingsController));

  fastify.post('/settings/node/network/internal', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNetworkInternal.bind(settingsController));

  fastify.post('/settings/node/network/external', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetNetworkExternal.bind(settingsController));

  // Cloudflare
  fastify.post('/settings/node/cloudflare/configure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetCloudflareConfig.bind(settingsController));

  fastify.post('/settings/node/cloudflare/clear', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiClearCloudflareConfig.bind(settingsController));

  fastify.post('/settings/node/cloudflare/turnstile/configure', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiSetTurnstileConfig.bind(settingsController));

  fastify.post('/settings/node/cloudflare/turnstile/clear', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiClearTurnstileConfig.bind(settingsController));

  // Toggles
  fastify.post('/settings/node/comments/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleComments.bind(settingsController));

  fastify.post('/settings/node/likes/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleLikes.bind(settingsController));

  fastify.post('/settings/node/dislikes/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleDislikes.bind(settingsController));

  fastify.post('/settings/node/reports/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleReports.bind(settingsController));

  fastify.post('/settings/node/live-chat/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleLiveChat.bind(settingsController));

  // Database / Storage
  fastify.post('/settings/node/database/config/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleDatabase.bind(settingsController));

  fastify.post('/settings/node/database/config/empty', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiEmptyDatabase.bind(settingsController));

  fastify.post('/settings/node/storage/config/toggle', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiToggleStorage.bind(settingsController));

  fastify.post('/settings/node/storage/config/empty', {
    schema: { tags: ['Settings'] }
  }, settingsController.apiEmptyStorage.bind(settingsController));
}
