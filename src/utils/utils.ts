import { FormData } from 'undici';

export const isPlainObject = (obj: unknown): obj is Record<string, any> => {
  return !!obj &&
    typeof obj === 'object' &&
    !Buffer.isBuffer(obj) &&
    !(obj instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(obj) &&
    !(obj instanceof URLSearchParams) &&
    !(obj instanceof Blob) &&
    !(typeof (obj as { pipe: any })?.pipe === 'function') &&
    !(obj instanceof FormData);
};
