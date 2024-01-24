# MoarTube-Client
A repository containing the client software for managing your [MoarTube Node](https://github.com/cconley717/MoarTube-Node). The software is a cross-platform Electron (or terminal) application that makes managing your node's videos and live streams as simple as reading this sentence.

# How to Get Started
Download the MoarTube Client from the [releases](https://github.com/cconley717/MoarTube-Client/releases) page for your operating system and run it, or follow the manual approach to set up your client. When ready, head over to [MoarTube Node](https://github.com/cconley717/MoarTube-Node) if you haven't yet.

The default login credentials for your node are below. Be sure to change these upon logging in.

**username**: admin<br/>**password**: admin

# Features
 - Cross platform support for Windows/macOS/Linux
 - Admin panel for managing videos and live streams
 - Video on demand (VoD) and HLS live streaming
 - **HLS** *(H.264, AAC)*, **MP4** *(H.264, AAC)*, **WEBM** *(VP9, Opus)*, **OGV** *(VP8, Opus)* container formats
 - Transcode static MP4/WEBM video to HLS/MP4/WEBM/OGV
 - Transcode RTMP stream ([such as from OBS](https://moartu.be/nodes/chris_moartube_node/videos/e9p_nivxkX7)) to HLS live stream
 - Video output resolutions: 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p
 - Auto framerate; the framerate that goes in is the framerate that goes out to your viewers.
 - No server-side encoding; client-side only
 - [HTTPS/WSS](https://moartu.be/nodes/chris_moartube_node/videos/L9qCCrsMtJl) capabilities
 - [GPU acceleration](https://moartu.be/nodes/chris_moartube_node/videos/X3xL5oPTJaz) for Nvidia and AMD (Windows only)
 - Different video player modes: streamer, theater, fullscreen
 - Dark mode option and browser appearance configuration recognition
 - Video comments section and live stream chat
 - Reports section for comments and videos
 - Comment monitoring overview with moderation functionality
 - Run your node in the cloud or on your home WiFi
 - Publicize your node's content on [MoarTube](http://www.moartube.com) or run your node privately
 - [Dual box compatible](https://moartu.be/nodes/chris_moartube_node/videos/f7w9spnInuN); broadcast an RTMP stream with software such as OBS from a primary system over a network (WAN or LAN) to a secondary system running the MoarTube Client, separating stream broadcasting from stream processing. This is achieved without any special plugins, such as NDI.
 - [Cloudflare Turnstile](https://moartu.be/nodes/chris_moartube_node/videos/gQcsrSmsmrY); transparent bot detection and human verification without the annoyance of captcha, [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) is next-generation protection for your MoarTube Node.
 - [Cloudflare one-click integration](https://moartu.be/nodes/chris_moartube_node/videos/9aP6aY4DYeH); easily integrate your node into the [Cloudflare Network](https://www.cloudflare.com/network/), allowing for global media delivery capabilities that rivals major platforms, all from a single node. Features automated caching strategy configuration and automated cache management, and of course the best security from the world's leading CDN.

![image](https://github.com/cconley717/MoarTube-Client/assets/26640616/0d8ac95f-f68b-4e36-849e-28139b45ce50)

![image](https://github.com/cconley717/MoarTube-Client/assets/26640616/918aa074-b6e2-49f1-8d14-5c2ed1bcd582)

![image](https://github.com/cconley717/MoarTube-Client/assets/26640616/068ec86b-a3d8-4285-9b64-4b71f64cce41)

# Manual Approach

## Node.js Install Guide

### Ubuntu Linux
Run the command **sudo snap install node --classic --channel=21**

### Windows/macOS
Download and run the [Node.js](https://nodejs.org/en/download) installer for your system

## Setup Guide

**git clone** the MoarTube-Client repository

Open a terminal within the MoarTube-Client directory

Run the command **npm install**

Run the command **node client.js**

Open a web browser at [localhost:8080](http://localhost:8080) to view the MoarTube Client user interface

# Note

The MoarTube Client executable will likely display a warning when you run it since the software distribution is not code signed. It will remain unsigned for the time being as I can't justify spending a thousand dollars to obtain certification for a project that I just launched.

Always obtain the MoarTube Client from official channels; [releases](https://github.com/cconley717/MoarTube-Client/releases).
