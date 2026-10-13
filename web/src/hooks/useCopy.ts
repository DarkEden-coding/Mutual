import { useCallback } from 'react';
import { useToast } from '../components/Toast';

export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (text: string, what = 'Link') => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${what} copied`, 'success');
      } catch {
        // Fallback for insecure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          toast(`${what} copied`, 'success');
        } catch {
          toast('Could not copy. Select the text and copy it manually.', 'error');
        }
        ta.remove();
      }
    },
    [toast],
  );
}
