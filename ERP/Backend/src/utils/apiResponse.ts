export const success = (data: any, message?: string) => ({
    success: true,
    data,
    message,
});

export const error = (message: string, code?: string, details?: any) => ({
    success: false,
    error: message,
    code,
    details,
});
