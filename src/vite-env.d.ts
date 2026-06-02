/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly WEREAD_API_KEY?: string;
  readonly WEREAD_API_URL?: string;
  readonly WEREAD_SERVER_SYNC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}