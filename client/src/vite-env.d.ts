/// <reference types="vite/client" />

// The silent looping video used to keep phone screens on (see common/keepAwake.ts).
declare module 'nosleep.js/src/media.js' {
  const media: { webm: string; mp4: string };
  export default media;
}
