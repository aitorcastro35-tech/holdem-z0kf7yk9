import { useSyncExternalStore } from 'react';

/** Minimal hash router: "#/reference/grid?x=1" → ['reference','grid'] */
function getHash() {
  return window.location.hash.replace(/^#\/?/, '');
}
export function useRoute(): { parts: string[]; query: URLSearchParams } {
  const h = useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    getHash,
  );
  const [path, q] = h.split('?');
  return { parts: path.split('/').filter(Boolean), query: new URLSearchParams(q ?? '') };
}
export function go(path: string) {
  window.location.hash = '/' + path.replace(/^\//, '');
  window.scrollTo({ top: 0 });
}
