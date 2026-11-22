import { useCallback, useEffect, useRef, useState } from 'react';

export type UserPosition = { latitude: number; longitude: number; accuracy: number; capturedAt?:number };

export function useGeolocation(autoRequest: boolean,maximumAge=60000) {
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const alive = useRef(true);
  const requested = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const locate = useCallback(() => {
    requested.current = true;
    const id = ++requestId.current;
    if (!navigator.geolocation || !window.isSecureContext) {
      setStatus('error');
      setError('Lokalizacja jest niedostępna. Otwórz stronę przez HTTPS lub wybierz obszar na mapie.');
      return;
    }
    setStatus('loading');
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords,timestamp }) => {
        if (!alive.current || id !== requestId.current) return;
        setPosition({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,capturedAt:timestamp });
        setStatus('success');
      },
      (e) => {
        if (!alive.current || id !== requestId.current) return;
        setStatus('error');
        setError(e.code === 1
          ? 'Brak zgody na lokalizację. Aby użyć GPS, zezwól na lokalizację w ustawieniach przeglądarki.'
          : e.code === 3
            ? 'Przekroczono czas ustalania pozycji. Spróbuj ponownie lub wybierz obszar na mapie.'
            : 'Nie udało się ustalić pozycji. Włącz usługi lokalizacji lub wybierz obszar na mapie.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge },
    );
  }, [maximumAge]);

  useEffect(() => {
    if (autoRequest && !requested.current) locate();
  }, [autoRequest, locate]);

  return { position, status, error, locate };
}
