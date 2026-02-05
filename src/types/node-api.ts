export interface S3Config {
    bucketName: string;
    region: string;
    endpoint?: string;
    sessionToken?: string;
    bucket?: string;
    accessKeyId: string;
    secretAccessKey: string;
    [key: string]: unknown;
}

export interface StorageConfig {
    storageMode: 'filesystem' | 's3provider';
    s3Config?: S3Config;
    [key: string]: unknown;
}

export interface NodeSettings {
    nodeName?: string;
    nodeDescription?: string;
    publicNodeProtocol?: string;
    publicNodeAddress?: string;
    publicNodePort?: number | string;
    username?: string;
    password?: string;
    storageConfig?: StorageConfig;
    isCloudflareCdnEnabled?: boolean;
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

export interface StreamVideoResponse extends BaseNodeResponse {
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
    cryptoWalletAddressId: string;
    walletAddress: string;
    chain: string;
    currency: string;
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

