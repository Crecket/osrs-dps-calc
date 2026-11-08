import { useCallback, useEffect, useState } from 'react';

const read = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/**
 * A this-browser preference, false until set. It is read after the first render, which has to match the prerendered
 * page. Without storage it lasts until the page closes.
 */
const useStoredFlag = (key: string): [boolean, (on: boolean) => void] => {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(read(key)), [key]);
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      if (next) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // storage full or blocked
    }
  }, [key]);
  return [on, set];
};

export default useStoredFlag;
