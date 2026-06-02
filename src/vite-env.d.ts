/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WEREAD_API_KEY?: string;
  readonly WEREAD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}