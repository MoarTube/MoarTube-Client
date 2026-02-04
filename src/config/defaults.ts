export const DEFAULT_CLIENT_SETTINGS = {
  clientPort: 8080,
  nodeIp: '127.0.0.1',
  nodePort: 3000,
  nodeHttpProtocol: 'http',
  nodeWebsocketProtocol: 'ws',
  isDeveloperMode: false,
  processingAgent: {
    processingAgentType: 'cpu',
    processingAgentName: '',
    processingAgentModel: ''
  },
  // bitrate units are in kilobytes per second
  videoEncoderSettings: {
    hls: {
      "2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
      "framerate": 30, "segmentLength": 6, "gop": 180
    },
    mp4: {
      "2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
      "framerate": 30, "gop": 60
    },
    webm: {
      "2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
      "framerate": 30, "gop": 60
    },
    ogv: {
      "2160p-bitrate": 15000, "1440p-bitrate": 12000, "1080p-bitrate": 10000, "720p-bitrate": 8000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
      "framerate": 30, "gop": 60
    }
  },
  liveEncoderSettings: {
    hls: {
      "2160p-bitrate": 10000, "1440p-bitrate": 10000, "1080p-bitrate": 8000, "720p-bitrate": 6000, "480p-bitrate": 5000, "360p-bitrate": 4000, "240p-bitrate": 3000,
      "framerate": 30, "segmentLength": 3, "gop": 90
    }
  }
};
