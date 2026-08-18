/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEREAD_API_URL?: string;
  readonly VITE_WEREAD_SERVER_SYNC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}