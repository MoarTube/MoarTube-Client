module.exports = {
  packagerConfig: {
    asar: {
      unpack: [ "**/node_modules/sharp/**/*", "**/node_modules/@img/**/*", "**/node_modules/ffmpeg-static/**/*" ]
    },
    extraResource: ["./public"]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
  publishers: [
    {
      name: "@electron-forge/publisher-github",
      config: {
        repository: {
          owner: "cconley717",
          name: "MoarTube-Client"
        }
      }
    }
  ]
};
