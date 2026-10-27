import { Link, useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { Menu, X, Store, LayoutDashboard, LogOut } from "lucide-react";
import { useAuth } from "../../context/AuthContext";

interface HeaderProps {
    isMenuOpen: boolean;
    setIsMenuOpen: (isOpen: boolean) => void;
    scrolled: boolean;
}

export const Header = ({
    isMenuOpen,
    setIsMenuOpen,
    scrolled,
}: HeaderProps) => {
    const { isAuthenticated, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };
    return (
        <header
            className={`sticky top-0 z-50 w-full border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 transition-shadow duration-300 ${scrolled ? "shadow-md" : ""
                }`}
        >
            <div className="container mx-auto flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-2 animate-slide-in-left">
                    <div className="h-10 w-10 rounded-lg  flex items-center justify-center shadow-lg">
                        <Store className="h-6 w-6" />
                    </div>
                    <span className="text-xl font-bold bg-gradient-to-r from-primary to-purple-600 bg-clip-text ">
                        Exceledge-ERP
                    </span>
                </div>

                <div className="md:hidden">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="relative"
                    >
                        {isMenuOpen ? (
                            <X className="h-6 w-6" />
                        ) : (
                            <Menu className="h-6 w-6" />
                        )}
                    </Button>
                </div>

                <nav className="hidden md:flex items-center gap-8 animate-fade-in">
                    <a
                        href="#home"
                        className="text-sm font-medium hover:text-primary transition-colors"
                    >
                        Home
                    </a>
                    <a
                        href="#about"
                        className="text-sm font-medium hover:text-primary transition-colors"
                    >
                        About
                    </a>
                    <a
                        href="#services"
                        className="text-sm font-medium hover:text-primary transition-colors"
                    >
                        Services
                    </a>
                    <a
                        href="#pricing"
                        className="text-sm font-medium hover:text-primary transition-colors"
                    >
                        Pricing
                    </a>
                    <a
                        href="#contact"
                        className="text-sm font-medium hover:text-primary transition-colors"
                    >
                        Contact
                    </a>
                </nav>

                <div className="hidden md:flex items-center gap-3 animate-slide-in-right">
                    {isAuthenticated ? (
                        <>
                            <Link to="/dashboard">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="flex items-center gap-2 border border-gray-600"
                                >
                                    <LayoutDashboard className="h-4 w-4" />
                                    Dashboard
                                </Button>
                            </Link>
                            <Button
                                onClick={handleLogout}
                                variant="outline"
                                size="sm"
                                className="flex items-center gap-2 border-red-500 text-red-500 hover:bg-red-50 hover:text-red-600"
                            >
                                <LogOut className="h-4 w-4" />
                                Logout
                            </Button>
                        </>
                    ) : (
                        <>
                            <Link to="/login">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="border border-gray-600"
                                >
                                    Login
                                </Button>
                            </Link>
                            <Link to="/signup">
                                <Button
                                    size="sm"
                                    className="border border-gray-600 bg-yellow-500 text-white font-medium hover:bg-yellow-600"
                                >
                                    Get Started
                                </Button>
                            </Link>
                        </>
                    )}
                </div>
            </div>

            {/* Mobile Navigation */}
            {isMenuOpen && (
                <div className="md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 shadow-lg animate-fade-in">
                    <div className="px-4 py-3 space-y-1 max-h-[calc(100vh-4rem)] overflow-y-auto">
                        <a
                            href="#home"
                            className="block py-3 px-4 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Home
                        </a>
                        <a
                            href="#about"
                            className="block py-3 px-4 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            About
                        </a>
                        <a
                            href="#services"
                            className="block py-3 px-4 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Services
                        </a>
                        <a
                            href="#pricing"
                            className="block py-3 px-4 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Pricing
                        </a>
                        <a
                            href="#contact"
                            className="block py-3 px-4 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Contact
                        </a>
                        <div className="pt-3 border-t mt-3 flex flex-col gap-2 pb-2">
                            <Link to="/login" className="w-full">
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Login
                                </Button>
                            </Link>
                            <Link to="/signup" className="w-full">
                                <Button
                                    className="w-full bg-gradient-to-r from-primary to-purple-600 hover:opacity-90"
                                    onClick={() => setIsMenuOpen(false)}
                                >
                                    Get Started
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
};
