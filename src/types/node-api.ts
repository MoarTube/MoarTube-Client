export interface NodeSettings {
    nodeName?: string;
    nodeDescription?: string;
    publicNodeProtocol?: string;
    publicNodeAddress?: string;
    publicNodePort?: number | string;
    username?: string;
    password?: string;
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

export interface Video {
    id: string;
    title: string;
    description: string;
    tags: string;
    views: number;
    creation_timestamp: number;
    [key: string]: unknown;
}

export interface VideoDataAllResponse {
    videoData: Video[];
    [key: string]: unknown;
}
