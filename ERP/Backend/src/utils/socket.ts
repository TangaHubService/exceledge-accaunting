import { Server, Socket } from 'socket.io';

let io: Server;

export const initSocket = (server: any) => {
    console.log('Socket.io initialized');
    io = new Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL,
            methods: ['GET', 'POST'],
            credentials: true
        },
        transports: ['websocket', 'polling']
    });

    io.on("connection", (socket: Socket) => {
        console.log("Client connected:", socket.id);

        // Client joins an organization room for notifications
        socket.on("joinOrganization", (data: { organizationId: string }, callback?: () => void) => {
            if (!data?.organizationId) {
                console.warn("No organizationId provided for joinOrganization");
                return;
            }
            const roomName = `org-${data.organizationId}`;
            console.log(`Joining organization room: ${roomName}, Socket ID: ${socket.id}`);
            socket.join(roomName);
            if (typeof callback === 'function') {
                callback();
            }
        });

        // Client joins a branch-specific room for scoped notifications
        socket.on("joinBranch", (data: { organizationId: string; branchId: number }, callback?: () => void) => {
            if (!data?.organizationId || !data?.branchId) {
                console.warn("Missing organizationId or branchId for joinBranch");
                return;
            }
            const roomName = `org-${data.organizationId}-branch-${data.branchId}`;
            console.log(`Joining branch room: ${roomName}, Socket ID: ${socket.id}`);
            socket.join(roomName);
            if (typeof callback === 'function') {
                callback();
            }
        });

        // Client leaves a branch-specific room
        socket.on("leaveBranch", (data: { organizationId: string; branchId: number }) => {
            if (!data?.organizationId || !data?.branchId) return;
            const roomName = `org-${data.organizationId}-branch-${data.branchId}`;
            socket.leave(roomName);
        });

        // Client joins a transaction room
        socket.on("joinTransaction", (data: { ref: string }, callback?: () => void) => {
            if (!data?.ref) {
                console.warn("No ref provided for joinTransaction");
                return;
            }
            const roomName = `trx-${data.ref}`;
            console.log(`Joining room: ${roomName}, Socket ID: ${socket.id}`);
            socket.join(roomName);
            if (typeof callback === 'function') {
                callback();
            }
        });

        socket.on("disconnect", (reason) => {
            console.log("Client disconnected:", socket.id, "Reason:", reason);
        });

        socket.on("error", (error) => {
            console.error("Socket error:", error);
        });
    });

    io.engine.on("connection_error", (err) => {
        console.error("Socket connection error:", err);
    });

    return io;
}

export const getIO = (): Server => {
    if (!io) {
        throw new Error("Socket.io not initialized! Call initSocket() first.");
    }
    return io;
}

/** Emit an event to all clients in an organization (org-wide). */
export const emitToOrganization = (organizationId: string | number, event: string, data: any) => {
    try {
        getIO().to(`org-${organizationId}`).emit(event, data);
    } catch (error) {
        console.error("Failed to emit to organization:", error);
    }
};

/** Emit an event to all clients in a specific branch. */
export const emitToBranch = (organizationId: string | number, branchId: number, event: string, data: any) => {
    try {
        getIO().to(`org-${organizationId}-branch-${branchId}`).emit(event, data);
    } catch (error) {
        console.error("Failed to emit to branch:", error);
    }
};

export const emitTransactionUpdate = (ref: string, data: any, organizationId: string) => {
    try {
        const io = getIO();
        io.to(`trx-${ref}`).emit('transactionUpdate', data);
        io.to(`org-${organizationId}`).emit('transactionUpdate', data);
    } catch (error) {
        console.error("Failed to emit transaction update:", error);
    }
};
