<img src="https://github.com/MoarTube/MoarTube-Client/assets/26640616/539be602-3608-428d-b6d6-34aec9b4a05d" alt="logo" width="200"/>

# **MoarTube-Client**
Welcome to **MoarTube Client**, the client-side software for managing your own videos and live streams! This cross-platform, terminal-based Node.js Express application is for managing your [MoarTube Node](https://github.com/MoarTube/MoarTube-Node). Whether you want to share your node’s videos with [MoarTube](https://www.moartube.com) or run your node privately, MoarTube gives you the freedom to do it your way.


[TL;DR: Watch the Quickstart Video](https://www.moartube.com/guides/moartube-quick-start)

# 🚀 **How to Get Started**
Welcome to the **MoarTube Client setup guide**! Follow these simple steps to get your MoarTube Client up and running. Don’t worry—MoarTube is designed to be so easy to set up and use, you’ll be done in minutes.

When you’re ready, make sure to check out the [MoarTube Node](https://github.com/MoarTube/MoarTube-Node) if you haven’t already.


## Table of Contents
- [Features](#features)
- [System Requirements](#system-requirements-lightweight-flexible-and-powerful)
- [Prerequisites](#prerequisites)
  - [npm](#npm)
  - [git](#git)
- [Installation Methods](#installation-methods)
  - [npm](#npm-1)
  - [git](#git-1)
- [Next Steps](#next-steps)
  - [Open the MoarTube Client](#open-the-moartube-client)
  - [Default Login Credentials](#default-login-credentials)
  - [Get MoarTube Node](#get-moartube-node)

# Features
## 🖥️ Platform Support
- Cross-platform compatibility: **Windows**, **macOS**, and **Linux**
- Capable of running on a **[Raspberry Pi Zero 2 W](https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/)**
- Run your node **Privately** or **publicize** your videos and streams on [MoarTube](http://www.moartube.com)
- MoarTube Client performs **video and stream processing** on your local machine
- MoarTube Node handles **storage and distribution** of your content
- Host your node:
  - **In the cloud**
  - **On your home WiFi**

## 📹 Video & Streaming Features
- **Video on Demand (VoD)** and **HLS Live Streaming**
- Supported formats:
  - **HLS** *(H.264, AAC)*
  - **MP4** *(H.264, AAC)*
  - **WEBM** *(VP9, Opus)*
  - **OGV** *(VP8, Opus)*
- Transcoding capabilities:
  - Convert **MP4/WEBM** videos to **HLS/MP4/WEBM/OGV**
  - Transcode **RTMP streams** ([e.g., from OBS](https://www.moartube.com/guides/how-to-live-stream-obs)) into **HLS live streams**
- Video resolutions: **2160p**, **1440p**, **1080p**, **720p**, **480p**, **360p**, **240p**
- Video player modes:
  - **Streamer Mode**
  - **Theater Mode**
  - **Fullscreen Mode**
- **Anonymous Comments & Live Stream Chat**:
  - Foster engagement while maintaining user privacy

## 💾 Data Processing, Storage, Distribution
- Processing
  - **CPU** and **GPU** support
  - Nvidia, AMD
    - Windows Only
- Storage
  - Local database storage using **SQLite**
  - Decentralize your node with a remote **Postgres** database
  - **File system** to store your videos and live streams locally on your node
  - **S3-compatible provider** to store your videos and live streams in the cloud
    - Amazon Web Services (AWS), DigitalOcean Spaces, Minio, etc...
    - **path-style** and **vhost-style** URL compatibility
- Distribution
  - Leverage Cloudflare's CDN for global content distribution

## ⚙️ Admin & Moderation
- **Admin Panel**
  - Managing videos and live streams
- **Reports Section**:
  - Track and moderate comments and videos
- **Comment Monitoring Overview**:
  - Includes moderation tools

## 💵 Monetization & Promotion
- Monetization via cryptocurrency:
  - Accept **ETH** and **BNB** via MetaMask
  - Provide **wallet addresses** to your viewers for donations
- Promote your node by providing links to:
  - **Social media platforms**
  - **Websites**
  - **External platforms**

## 🛠️ Advanced Features
- [**Cloudflare CDN**](https://www.moartube.com/guides/how-to-enable-cloudflare-cdn):
  - Cloudflare's **global network** facilitates mass data propagation for audiences of any size, anywhere.
  - Data is transmitted throughout Cloudflare's **global network** within milliseconds of beng requested.
  - Available to a free-tier Cloudflare account.
- [**Cloudflare Turnstile**](https://www.moartube.com/guides/how-to-enable-cloudflare-turnstile):
  - Next-generation **bot detection** and **human verification** without intrusive captchas.
  - Available to a free-tier Cloudflare account.
- [**Postgres**]()
  - Remote database storage for video and live stream metadata and information.
  - Host your database **anywhere**.
- [**S3 Providers**]()
  - Remote storage for video and live stream content.
  - Seemingly **unlimited** storage size and can meet **high demand**.
    - cheap and affordable
  - Compatible with any S3 provider that conforms to the AWS S3 specification.
- [**Dual Box Compatibility**](https://www.moartube.com/guides/how-to-dual-box):
  - Broadcast an OBS RTMP stream to a dedicated processing system running the MoarTube Client.
  - Can broadcast to a dedicated processing system over LAN or WAN.
  - No plugins like NDI required.
- [**GPU Acceleration**](https://www.moartube.com/guides/how-to-enable-gpu-acceleration):
  - Supports **Nvidia** and **AMD** GPUs for accelerated encoding/decoding (Windows only).

## 🏆 Why Choose MoarTube?
MoarTube empowers you to take control of your media hosting with privacy, decentralization, and robust features designed to rival major platforms—all while remaining lightweight, accessible, and cost-effective, all from a single node.

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/0d8ac95f-f68b-4e36-849e-28139b45ce50)

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/918aa074-b6e2-49f1-8d14-5c2ed1bcd582)

![image](https://github.com/MoarTube/MoarTube-Client/assets/26640616/068ec86b-a3d8-4285-9b64-4b71f64cce41)

# System Requirements: Lightweight, Flexible, and Powerful
MoarTube is designed to be lightweight and accessible, making it the most resource-efficient self-hosted video and live streaming solution available today.

## 📋 **Efficient and Resourceful**
- **MoarTube Client** handles the intensive computational tasks for **video and live stream decoding/encoding**. This means performance is only limited by the system it runs on.
- Prefer a dedicated setup? MoarTube supports **dual boxing**. You can run the client on a **dedicated system** for optimized performance.

## 🎮 **GPU Acceleration**
- **Accelerate** encoding/decoding with **Nvidia** and **AMD GPUs** (Windows only).
- **GPU acceleration** is disabled by default. Simply toggle it on in the settings if needed.

## 💻 **Requirements**
- **Node.js v20 or later** is required to run the software.

# Prerequisites

Observe the corresponding prerequisite for your installation method.

## npm
If you're using npm to install the software, make sure that [Node.js and npm](https://nodejs.org/en) are installed on your machine.

## git
You can clone the repo, but make sure that [Node.js and npm](https://nodejs.org/en) are installed on your machine.

# Installation Methods

Choose any of the following installation methods.

## [npm](https://www.npmjs.com/package/@moartube/moartube-client)

You can install MoarTube Client globally:

```bash
npm i @moartube/moartube-client -g
```

And run from the command-line globally:

```bash
moartube-client
```

<br>

You can install MoarTube Client locally:

```bash
npm i @moartube/moartube-client
```

And run from the command-line locally:

```bash
node node_modules/@moartube/moartube-client/moartube-client.js
```

### [git](https://github.com/MoarTube/MoarTube-Client)

```bash
git clone https://github.com/MoarTube/MoarTube-Client
```

Open a terminal in the cloned directory and run:

```bash
npm install
```

```bash
node moartube-client.js
```

# Next Steps

## Open the MoarTube Client

Open a web browser at [localhost:8080](http://localhost:8080) to view the MoarTube Client user interface and log into your node.

## Default Login Credentials

The default login credentials for your node are below. Be sure to change these upon logging in.

By default, MoarTube Client listens on port 8080.

**username**: admin<br/>**password**: admin

## Get MoarTube Node

If you haven't already, it's time to get the [MoarTube Node](https://github.com/MoarTube/MoarTube-Node).
