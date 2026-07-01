import { useEffect, useState, useCallback, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { CHART_COLORS } from '../lib/constants';

const ROOM_NAME = typeof window !== 'undefined'
  ? (sessionStorage.getItem('insight-room-id') || (() => {
      const id = 'insight-' + Math.random().toString(36).substring(2, 10);
      sessionStorage.setItem('insight-room-id', id);
      return id;
    })())
  : 'insight-executive-war-room';

// Lightweight presence hook: shares live cursor positions between viewers of the
// same room. (Scenario-simulation lever sync was removed along with the
// Simulation feature.)
export function useMultiplayer() {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [awareness, setAwareness] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);

  useEffect(() => {
    // Connect to public demo server
    const wsProvider = new WebsocketProvider(
      'wss://demos.yjs.dev',
      ROOM_NAME,
      ydoc
    );

    setAwareness(wsProvider.awareness);

    // Initialize local awareness
    const userColor = CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)];
    wsProvider.awareness.setLocalStateField('user', {
      name: `Executive ${Math.floor(Math.random() * 100)}`,
      color: userColor
    });

    // Observe awareness changes (presence)
    const observeAwareness = () => {
      const states = Array.from(wsProvider.awareness.getStates().entries());
      const users = states
        .filter(([clientId, state]) => clientId !== ydoc.clientID && state.user)
        .map(([clientId, state]) => ({
          clientId,
          ...state.user,
          cursor: state.cursor
        }));
      setRemoteUsers(users);
    };
    wsProvider.awareness.on('change', observeAwareness);

    return () => {
      wsProvider.disconnect();
      ydoc.destroy();
    };
  }, [ydoc]);

  const updateCursorPosition = useCallback((x, y) => {
    if (awareness) {
      awareness.setLocalStateField('cursor', { x, y });
    }
  }, [awareness]);

  return {
    remoteUsers,
    updateCursorPosition,
    clientId: ydoc.clientID
  };
}
