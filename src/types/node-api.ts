import type { CpuMetrics } from '@/utils/cpu-metrics.js';
import type { MemoryMetrics } from '@/utils/memory-metrics.js';
import type { StorageMetrics } from '@/utils/storage-metrics.js';

export type MetricResult<T> = { isError: false; metrics: T } | { isError: true };

export interface NodeMetricsBundle {
  cpu: MetricResult<CpuMetrics>;
  memory: MetricResult<MemoryMetrics>;
  disk: MetricResult<StorageMetrics>;
}

export interface NodeMetricsResponse {
  status: number;
  data: { isError: boolean; metrics?: NodeMetricsBundle };
}

export interface S3ProviderCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface S3ProviderClientConfig {
  credentials: S3ProviderCredentials;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  [key: string]: unknown;
}

export interface S3Config {
  bucketName: string;
  s3ProviderClientConfig: S3ProviderClientConfig;
  [key: string]: unknown;
}

export interface StorageConfig {
  storageMode: 'filesystem' | 's3provider';
  s3Config?: S3Config;
  [key: string]: unknown;
}

export interface NodeIcon {
  url: string;
  svgGraphic: string;
}

export interface NodeLink {
  url: string;
  description: string;
}

export interface NodeSettings {
  allowRemoteConnections?: boolean;
  nodeName?: string;
  nodeHeadline?: string;
  nodeBulletin?: string[];
  nodeLinks?: NodeLink[];
  nodeIcons?: NodeIcon[];
  nodeDescription?: string;
  publicNodeProtocol?: string;
  publicNodeAddress?: string;
  publicNodePort?: number | string;
  username?: string;
  password?: string;
  storageConfig?: StorageConfig;
  isCloudflareCdnEnabled?: boolean;
  /** Saved CDN transition still needs media, cache, or tunnel recovery. */
  cloudflareAddressMigrationPending?: boolean;
  cdnTransition?: { id: string; targetEnabled: boolean; stage: string } | null;
  /** Defaults to true on the Node; controls both quick and named tunnels. */
  isCloudflareTunnelEnabled?: boolean;
  /** Current generated quick name or configured named-tunnel name. */
  cloudflareTunnelName?: string;
  [key: string]: unknown;
}

export interface NewContentCounts {
  totalVideos: number;
  totalComments: number;
  [key: string]: unknown;
}

export interface AuthResponse {
  isError: boolean;
  isAuthenticated: boolean;
  message?: string;
  token?: string;
  redirectUrl?: string;
}

export interface BaseNodeResponse {
  isError: boolean;
  message?: string;
  [key: string]: unknown;
}

/** Safe lifecycle snapshot returned by tunnel operations; never contains credentials. */
export interface CloudflareTunnelState {
  mode: 'none' | 'quick' | 'named';
  status: 'stopped' | 'starting' | 'running' | 'error';
  name: string;
  publicUrl?: string;
  message?: string;
}

export interface CloudflareTunnelMutationResponse extends BaseNodeResponse {
  /** True even when persistence succeeds but the subsequent lifecycle operation fails. */
  settingsSaved: boolean;
  cloudflareAddressMigrationPending?: boolean;
  cdnTransition?: { id: string; targetEnabled: boolean; stage: string } | null;
  cloudflareTunnelName: string;
  isCloudflareCdnEnabled: boolean;
  isCloudflareTunnelEnabled: boolean;
  tunnel: CloudflareTunnelState;
}

export interface StreamVideoResponse extends BaseNodeResponse {
  videoId: string;
}

export interface CreateVideoResponse extends BaseNodeResponse {
  videoId: string;
}

export interface Video {
  id: string;
  title: string;
  description: string;
  tags: string;
  views: number;
  creation_timestamp: number;
  [key: string]: unknown;
}

export interface SourceFileExtensionResponse extends BaseNodeResponse {
  sourceFileExtension: string;
}

export interface VideoDataAllResponse {
  videoData: Video[];
  [key: string]: unknown;
}

export interface VideoMeta {
  networkAddress: string;
  rtmpPort: number | string;
  uuid: string;
  chatSettings: {
    isChatHistoryEnabled: boolean;
    chatHistoryLimit: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface VideoOutputs {
  m3u8?: string[];
  [key: string]: unknown;
}

export interface VideoData {
  uuid: string;
  isLive: boolean;
  isStreaming: boolean;
  isFinalized: boolean;
  isStreamRecordedRemotely?: boolean;
  networkAddress?: string;
  rtmpPort?: number;
  outputs?: VideoOutputs;
  chatSettings?: unknown;
  meta?: VideoMeta;
  video?: {
    sourceFileExtension: string;
  };
  [key: string]: unknown;
}

export interface VideoDataResponse extends BaseNodeResponse {
  videoData: VideoData;
}

export interface DeleteVideosResponse extends BaseNodeResponse {
  deletedVideoIds: string[];
  nonDeletedVideoIds: string[];
}

export interface FinalizeVideosResponse extends BaseNodeResponse {
  finalizedVideoIds: string[];
  nonFinalizedVideoIds: string[];
}

export interface VideoSource {
  src: string;
  type: string;
}

export interface VideoSourcesResponse extends BaseNodeResponse {
  adaptiveSources: VideoSource[];
  progressiveSources: VideoSource[];
}

export interface VideoTagsResponse extends BaseNodeResponse {
  tags: string[];
}

export interface VideoTagsAllResponse extends BaseNodeResponse {
  tags: string[];
}

export interface VideoPublishesResponse extends BaseNodeResponse {
  publishes: unknown[];
}

export interface VideoPermissionsResponse extends BaseNodeResponse {
  isCommentsEnabled: boolean;
  isLikesEnabled: boolean;
  isDislikesEnabled: boolean;
  isReportsEnabled: boolean;
  isLiveChatEnabled: boolean;
}

export interface Link {
  linkId: string;
  url: string;
  svgGraphic: string;
  [key: string]: unknown;
}

export interface GetLinksResponse extends BaseNodeResponse {
  links: Link[];
}

export interface CryptoWalletAddress {
  wallet_address_id: number;
  wallet_address: string;
  chain: string;
  chain_id: string;
  currency: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface GetMonetizationResponse extends BaseNodeResponse {
  cryptoWalletAddresses: CryptoWalletAddress[];
}

export interface Comment {
  commentId: string;
  text: string;
  creationDate: number;
  [key: string]: unknown;
}

export interface GetCommentsResponse extends BaseNodeResponse {
  comments: Comment[];
}

export interface Report {
  reportId: string;
  reason: string;
  [key: string]: unknown;
}

export interface GetReportsResponse extends BaseNodeResponse {
  hasMore?: boolean;
  reports: Report[];
}

export interface VideoBandwidthResponse extends BaseNodeResponse {
  bandwidth: number | string;
  [key: string]: unknown;
}

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  [key: string]: unknown;
}

export interface DatabaseConfig {
  [key: string]: unknown;
}
