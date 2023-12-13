# MoarTube-Client
A repository containing the client software for managing your [MoarTube](https://www.moartube.com) node. The software is a cross-platform Electron application that makes managing your node as simple as reading this sentence.

# Features
 - Cross platform support for Windows/macOS/Linux
 - Video on demand (VoD) and HLS live streaming
 - **HLS** *(H.264, AAC)*, **MP4** *(H.264, AAC)*, **WEBM** *(VP9, Opus)*, **OGV** *(VP8, Opus)* container formats
 - Transcode static MP4/WEBM video to HLS/MP4/WEBM/OGV
 - Transcode RTMP Live stream (such as from OBS) to HLS live stream
 - Video output resolutions, 30fps: 2160p, 1440p, 1080p, 720p, 480p, 360p, 240p
 - No server-side encoding; client-side only
 - HTTPS/WSS
 - GPU acceleration for Nvidia and AMD (Windows only)
 - Admin panel for managing videos and live streams
 - Discussion section and live stream chat for all videos
 - Dark mode option and browser appearance configuration recognition
 - Reports section for comments and video
 - Comment monitoring overview with moderation functionality
 - Captcha functionality to limit abuse
 - Publicize your node on [MoarTube](http://www.moartube.com), or run your node privately

## How to Get Started
Download the MoarTube Client from the [releases](https://github.com/cconley717/MoarTube-Client/releases) page for your operating system and run it, or follow the manual approach. The default login credentials for your node are below. Be sure to change these upon logging in.

**username**: admin

**password**: admin

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
