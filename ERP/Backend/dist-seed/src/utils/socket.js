"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitTransactionUpdate = exports.emitToBranch = exports.emitToOrganization = exports.getIO = exports.initSocket = void 0;
const socket_io_1 = require("socket.io");
let io;
const initSocket = (server) => {
    console.log('Socket.io initialized');
    io = new socket_io_1.Server(server, {
        cors: {
            origin: process.env.FRONTEND_URL,
            methods: ['GET', 'POST'],
            credentials: true
        },
        transports: ['websocket', 'polling']
    });
    io.on("connection", (socket) => {
        console.log("Client connected:", socket.id);
        // Client joins an organization room for notifications
        socket.on("joinOrganization", (data, callback) => {
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
        socket.on("joinBranch", (data, callback) => {
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
        socket.on("leaveBranch", (data) => {
            if (!data?.organizationId || !data?.branchId)
                return;
            const roomName = `org-${data.organizationId}-branch-${data.branchId}`;
            socket.leave(roomName);
        });
        // Client joins a transaction room
        socket.on("joinTransaction", (data, callback) => {
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
};
exports.initSocket = initSocket;
const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized! Call initSocket() first.");
    }
    return io;
};
exports.getIO = getIO;
/** Emit an event to all clients in an organization (org-wide). */
const emitToOrganization = (organizationId, event, data) => {
    try {
        (0, exports.getIO)().to(`org-${organizationId}`).emit(event, data);
    }
    catch (error) {
        console.error("Failed to emit to organization:", error);
    }
};
exports.emitToOrganization = emitToOrganization;
/** Emit an event to all clients in a specific branch. */
const emitToBranch = (organizationId, branchId, event, data) => {
    try {
        (0, exports.getIO)().to(`org-${organizationId}-branch-${branchId}`).emit(event, data);
    }
    catch (error) {
        console.error("Failed to emit to branch:", error);
    }
};
exports.emitToBranch = emitToBranch;
const emitTransactionUpdate = (ref, data, organizationId) => {
    try {
        const io = (0, exports.getIO)();
        io.to(`trx-${ref}`).emit('transactionUpdate', data);
        io.to(`org-${organizationId}`).emit('transactionUpdate', data);
    }
    catch (error) {
        console.error("Failed to emit transaction update:", error);
    }
};
exports.emitTransactionUpdate = emitTransactionUpdate;
