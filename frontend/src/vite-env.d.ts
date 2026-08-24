/**
 * File: vite-env.d.ts
 * Description: Ambient types for Vite's client API and for importing images as modules.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-17
 */
/// <reference types="vite/client" />
// to recognize image imports
declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}

declare module '*.jpg' {
  const content: string;
  export default content;
}

declare module '*.jpeg' {
  const content: string;
  export default content;
}

declare module '*.gif' {
  const content: string;
  export default content;
}
