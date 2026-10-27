import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { isTokenValid } from '../utils/jwtValidation';
import { apiClient } from '../lib/api-client';
import { resetSubscriptionModalDismissal } from '../utils/subscriptionModalDismissal';

type User = {
    id: string;
    email: string;
    name: string;
    token: string;
    role?: string;
} | null;

type AuthContextType = {
    user: User;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (userData: User) => void;
    logout: () => void;
    refreshUserProfile: () => Promise<void>;
    isSystemOwner: () => boolean;
    isAdmin: () => boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User>(null);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);

    useEffect(() => {
        const initializeAuth = async () => {
            // Skip auth initialization on public auth pages to prevent redirect loops
            if (typeof window !== 'undefined' && (
                window.location.pathname === '/login' ||
                window.location.pathname === '/reset-password' ||
                window.location.pathname === '/forgot-password' ||
                window.location.pathname === '/signup' ||
                window.location.pathname === '/verify'
            )) {
                setIsAuthenticated(false);
                setIsLoading(false);
                return;
            }

            const storedToken = localStorage.getItem('token');
            const storedUser = localStorage.getItem('user');

            // Allow authentication with just a valid token - organizationId is optional
            // Users can be authenticated without an organization (e.g., just created one)
            if (storedToken && isTokenValid(storedToken)) {
                setIsAuthenticated(true);
                if (storedUser) {
                    try {
                        const parsedUser = JSON.parse(storedUser);
                        setUser(parsedUser);
                    } catch (e) {
                        console.error('Failed to parse stored user:', e);
                    }
                }
                
                // Refresh user profile to get latest role and data
                try {
                    const profileData = await apiClient.profile();
                    const updatedUser: User = {
                        id: String(profileData.id),
                        email: profileData.email,
                        name: profileData.name,
                        token: localStorage.getItem('token') || storedToken,
                        role: profileData.role,
                    };
                    setUser(updatedUser);
                    localStorage.setItem('user', JSON.stringify(updatedUser));
                } catch (error) {
                    console.error('Failed to refresh user profile on mount:', error);
                    // Don't logout on error - user is still authenticated with stored data
                }
            } else if (storedToken && !isTokenValid(storedToken)) {
                const refreshed = await apiClient.trySilentRefresh();
                const newToken = localStorage.getItem('token');
                if (refreshed && newToken && isTokenValid(newToken)) {
                    setIsAuthenticated(true);
                    try {
                        const profileData = await apiClient.profile();
                        const updatedUser: User = {
                            id: String(profileData.id),
                            email: profileData.email,
                            name: profileData.name,
                            token: newToken,
                            role: profileData.role,
                        };
                        setUser(updatedUser);
                        localStorage.setItem('user', JSON.stringify(updatedUser));
                    } catch {
                        setIsAuthenticated(false);
                    }
                } else {
                    localStorage.removeItem('token');
                    localStorage.removeItem('refresh_token');
                    localStorage.removeItem('current_organization_id');
                    localStorage.removeItem('user');
                    setIsAuthenticated(false);
                }
            } else {
                // No token at all
                setIsAuthenticated(false);
            }
            setIsLoading(false);
        };
        
        initializeAuth();
    }, []);


    const login = (userData: User) => {
        if (userData) {
            setUser(userData);
            setIsAuthenticated(true);
            localStorage.setItem('user', JSON.stringify(userData));
            localStorage.setItem('token', userData.token);
            // A fresh login should always re-evaluate the subscription-required modal,
            // even if it was dismissed earlier in a previous session.
            resetSubscriptionModalDismissal();
        }
    };

    // Function to check if user is system owner
    const isSystemOwner = () => {
        return user?.role === 'SYSTEM_OWNER';
    };

    // Function to check if user is admin
    const isAdmin = () => {
        return user?.role === 'ADMIN';
    };

    const refreshUserProfile = async () => {
        try {
            const profileData = await apiClient.profile();
            const token = localStorage.getItem('token') || user?.token || '';
            const updatedUser: User = {
                id: String(profileData.id),
                email: profileData.email,
                name: profileData.name,
                token: token,
                role: profileData.role, // Updated role (ADMIN)
            };
            setUser(updatedUser);
            localStorage.setItem('user', JSON.stringify(updatedUser));
        } catch (error) {
            console.error('Failed to refresh user profile:', error);
            // Don't logout on error - user is still authenticated
        }
    };

    const logout = () => {
        setUser(null);
        setIsAuthenticated(false);
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        localStorage.removeItem('current_organization_id');
        localStorage.clear();
        window.location.href = '/login';
    };

    return (
        <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, logout, refreshUserProfile, isSystemOwner, isAdmin }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
