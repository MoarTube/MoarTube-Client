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

export interface VideoData {
    uuid: string;
    isLive: boolean;
    isStreaming: boolean;
    isFinalized: boolean; // eslint-disable-line @typescript-eslint/naming-convention
    isStreamRecordedRemotely?: boolean;
    networkAddress?: string;
    rtmpPort?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    outputs?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chatSettings?: any;
    meta?: any;
    video?: {
        sourceFileExtension: string;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
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

export interface VideoSourcesResponse extends BaseNodeResponse {
    video: {
        adaptiveSources: any[];
        progressiveSources: any[];
        [key: string]: any;
    };
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



