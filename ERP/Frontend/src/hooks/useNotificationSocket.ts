import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL;

type Notification = {
    id: string;
    title: string;
    message: string;
    isRead: boolean;
    createdAt: string;
    type?: string;
    data?: any;
};

export const useNotificationSocket = (organizationId: string | null) => {
    const socketRef = useRef<Socket | null>(null);
    const [newNotification, setNewNotification] = useState<Notification | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        if (!organizationId) return;

        // Initialize socket connection
        const socket = io(WS_URL, {
            reconnection: true,
            transports: ['websocket', 'polling'],
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('🔌 Notification WebSocket connected:', socket.id);
            setIsConnected(true);

            // Join organization room for notifications
            socket.emit('joinOrganization', { organizationId });
        });

        socket.on('disconnect', () => {
            console.log('🔌 Notification WebSocket disconnected');
            setIsConnected(false);
        });

        // Listen for new notifications
        socket.on('newNotification', (notification: Notification) => {
            console.log('🔔 New notification received:', notification);
            setNewNotification(notification);
        });

        socket.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        return () => {
            console.log('🧹 Cleaning up notification socket...');
            socket.off('newNotification');
            socket.disconnect();
        };
    }, [organizationId]);

    return {
        newNotification,
        isConnected,
        clearNotification: () => setNewNotification(null),
    };
};
