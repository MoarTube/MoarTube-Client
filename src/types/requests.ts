export interface VideoSearchQuery {
    searchTerm?: string;
    sortTerm?: string;
    tagTerm?: string;
    tagLimit?: number;
    timestamp?: number;
}

export interface StartStreamBody {
    title: string;
    description: string;
    tags: string;
    rtmpPort: string;
    resolution: string;
    isRecordingStreamRemotely: boolean;
    isRecordingStreamLocally: boolean;
    networkAddress: string;
    videoId?: string;
}

export interface StopStreamParams {
    videoId: string;
}

export interface VideoIdParams {
    videoId: string;
}

export interface StopImportBody {
    videoId: string;
}

export interface PublishBody {
    videoId: string;
    publishings: string;
}

export interface StopPublishBody {
    videoId: string;
}

export interface UnpublishBody {
    videoId: string;
    format: string;
    resolution: string;
}

export interface VideoDataBody {
    videoId: string;
    title: string;
    description: string;
    tags: string;
}

export interface AddToIndexBody {
    videoId: string;
    containsAdultContent: boolean;
    termsOfServiceAgreed: boolean;
    cloudflareTurnstileToken: string;
}

export interface RemoveFromIndexBody {
    videoId: string;
    cloudflareTurnstileToken: string;
}

export interface VideoPermissionsBody {
    videoId: string;
    type: string;
    isEnabled: boolean;
}

export interface DeleteVideosBody {
    videoIds: string[];
}

export interface FinalizeVideosBody {
    videoIds: string[];
}

export interface UpdateChatSettingsBody {
    isChatHistoryEnabled: boolean;
    chatHistoryLimit: number;
}

export interface SetGpuAccelerationBody {
    isGpuAccelerationEnabled: boolean;
}

export interface SetClientEncodingBody {
    videoEncoderSettings: Record<string, unknown>;
    liveEncoderSettings: Record<string, unknown>;
}

export interface SetNodeNameBody {
    nodeName: string;
}

export interface SetNodeAboutBody {
    nodeAbout: string;
}

export interface SetNodeIdBody {
    nodeId: string;
}

export interface SetSecureConnectionBody {
    isSecure: boolean;
}

export interface SetNetworkInternalBody {
    nodeListeningPort: number;
}

export interface SetNetworkExternalBody {
    publicNodeProtocol: string;
    publicNodeAddress: string;
    publicNodePort: number;
}

export interface SetCloudflareConfigBody {
    cloudflareEmailAddress: string;
    cloudflareZoneId: string;
    cloudflareGlobalApiKey: string;
}

export interface SetTurnstileConfigBody {
    cloudflareTurnstileSiteKey: string;
    cloudflareTurnstileSecretKey: string;
}

export interface ToggleCommentsBody {
    isCommentsEnabled: boolean;
}

export interface ToggleLikesBody {
    isLikesEnabled: boolean;
}

export interface ToggleDislikesBody {
    isDislikesEnabled: boolean;
}

export interface ToggleReportsBody {
    isReportsEnabled: boolean;
}

export interface ToggleLiveChatBody {
    isLiveChatEnabled: boolean;
}

export interface ToggleDatabaseBody {
    databaseConfig: Record<string, unknown>;
}

export interface ToggleStorageBody {
    storageConfig: {
        storageMode: string;
        s3Config: Record<string, unknown>;
    };
}


