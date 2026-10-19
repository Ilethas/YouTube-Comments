import type { ForgeConfig } from '@electron-forge/shared-types';
import type { MakerSquirrelConfig } from '@electron-forge/maker-squirrel';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import identity from './src/shared/application-identity.json';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: identity.packageName,
    executableName: identity.executableName,
    icon: path.resolve(__dirname, 'assets/application.ico'),
    extraResource: [path.resolve(__dirname, 'THIRD_PARTY_NOTICES.md'), path.resolve(__dirname, 'third-party')],
    win32metadata: { ProductName: identity.displayName, FileDescription: identity.displayName },
  },
  rebuildConfig: {},
  makers: [
    // Resolvable names preserve config when Forge 7.11's --targets selects a
    // module name. Maker instances instead expose the short name "squirrel".
    { name: '@electron-forge/maker-squirrel', config: {
      name: identity.squirrelPackageId,
      title: identity.displayName,
      exe: `${identity.executableName}.exe`,
      setupExe: identity.setupExe,
      setupIcon: path.resolve(__dirname, 'assets/application.ico'),
      nuspecTemplate: path.resolve(__dirname, 'assets/windows.nuspectemplate'),
      // No hosted branding dependency or Electron icon download at install time.
      iconUrl: '',
      noMsi: true,
      noDelta: true,
    } satisfies MakerSquirrelConfig },
    { name: '@electron-forge/maker-zip', config: {}, platforms: ['win32', 'darwin'] },
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
