import { jwtDecode } from "jwt-decode";

export const isTokenValid = (token: string) => {
    try {
        const decoded: any = jwtDecode(token);

        if (decoded.exp * 1000 < Date.now()) {
            return false;
        }

        return true;
    } catch {
        return false;
    }
};
