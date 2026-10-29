if (process.platform !== 'linux') throw new Error('Linux desktop preparation requires Linux.');
await import('./prepare-desktop-unix.mjs');
