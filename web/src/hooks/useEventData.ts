import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, openEventStream, type EventDTO, type ParticipantDTO, type StreamMessage, type ViewerDTO } from '../api';

export type EventLoad =
  | { status: 'loading' }
  | { status: 'notfound' }
  | { status: 'deleted' }
  | { status: 'error'; message: string }
  | { status: 'ready'; event: EventDTO; participants: ParticipantDTO[]; viewer: ViewerDTO };

export interface EventData {
  state: EventLoad;
  refetch: () => Promise<void>;
  setViewer: (v: ViewerDTO) => void;
  upsertParticipant: (p: ParticipantDTO) => void;
  setSnapshot: (event: EventDTO, participants: ParticipantDTO[]) => void;
  markDeleted: () => void;
  live: boolean;
}

/** Loads an event and keeps it fresh through the SSE stream. */
export function useEventData(id: string, enabled = true): EventData {
  const [state, setState] = useState<EventLoad>({ status: 'loading' });
  const [live, setLive] = useState(false);
  const idRef = useRef(id);
  idRef.current = id;

  const load = useCallback(async (): Promise<void> => {
    try {
      const snap = await api.getEvent(idRef.current);
      setState({ status: 'ready', ...snap });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (err instanceof ApiError && err.code === 'not_found') setState({ status: 'notfound' });
      else
        setState((cur) =>
          cur.status === 'ready' ? cur : { status: 'error', message: err instanceof Error ? err.message : 'Failed to load' },
        );
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setState({ status: 'loading' });
    void load();
  }, [id, enabled, load]);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready || !enabled) return;
    let dropped = false;
    const close = openEventStream(id, {
      onOpen: () => {
        setLive(true);
        if (dropped) {
          dropped = false;
          void load(); // catch up on anything missed while disconnected
        }
      },
      onError: () => {
        dropped = true;
        setLive(false);
      },
      onMessage: (m: StreamMessage) => {
        setState((cur) => {
          if (cur.status !== 'ready') return cur;
          switch (m.type) {
            case 'participant': {
              const exists = cur.participants.some((p) => p.id === m.participant.id);
              const participants = exists
                ? cur.participants.map((p) => (p.id === m.participant.id ? m.participant : p))
                : [...cur.participants, m.participant];
              return { ...cur, participants };
            }
            case 'event':
              return { ...cur, event: m.event, participants: m.participants };
            case 'deleted':
              return { status: 'deleted' };
          }
        });
      },
    });
    return () => {
      close();
      setLive(false);
    };
  }, [id, ready, enabled, load]);

  return {
    state,
    live,
    refetch: load,
    setViewer: (viewer) => setState((cur) => (cur.status === 'ready' ? { ...cur, viewer } : cur)),
    upsertParticipant: (p) =>
      setState((cur) => {
        if (cur.status !== 'ready') return cur;
        const exists = cur.participants.some((x) => x.id === p.id);
        return { ...cur, participants: exists ? cur.participants.map((x) => (x.id === p.id ? p : x)) : [...cur.participants, p] };
      }),
    setSnapshot: (event, participants) => setState((cur) => (cur.status === 'ready' ? { ...cur, event, participants } : cur)),
    markDeleted: () => setState({ status: 'deleted' }),
  };
}
