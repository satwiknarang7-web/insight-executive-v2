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

export function useMultiplayer() {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [syncedState, setSyncedState] = useState({});
  const [remoteUsers, setRemoteUsers] = useState([]);

  // Get shared map for simulation levers
  const simulationMap = useMemo(() => ydoc.getMap('simulation-state'), [ydoc]);

  useEffect(() => {
    // Connect to public demo server
    const wsProvider = new WebsocketProvider(
      'wss://demos.yjs.dev', 
      ROOM_NAME, 
      ydoc
    );

    setProvider(wsProvider);
    setAwareness(wsProvider.awareness);

    // Initialize local awareness
    const userColor = CHART_COLORS[Math.floor(Math.random() * CHART_COLORS.length)];
    wsProvider.awareness.setLocalStateField('user', {
      name: `Executive ${Math.floor(Math.random() * 100)}`,
      color: userColor
    });

    // Observe changes to the simulation state
    const observeSimulation = () => {
      setSyncedState(simulationMap.toJSON());
    };
    simulationMap.observe(observeSimulation);

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
  }, [ydoc, simulationMap]);

  const updateSimulationState = useCallback((id, value) => {
    simulationMap.set(id, value);
  }, [simulationMap]);

  const resetSimulationState = useCallback(() => {
    simulationMap.clear();
  }, [simulationMap]);

  const updateCursorPosition = useCallback((x, y) => {
    if (awareness) {
      awareness.setLocalStateField('cursor', { x, y });
    }
  }, [awareness]);

  return {
    syncedState,
    updateSimulationState,
    resetSimulationState,
    remoteUsers,
    updateCursorPosition,
    clientId: ydoc.clientID
  };
}
