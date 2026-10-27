import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/button";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.href = "/";
    };

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                    <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-red-100">
                        <div className="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full mb-6">
                            <AlertTriangle className="h-8 w-8 text-red-600" />
                        </div>

                        <h1 className="text-2xl font-bold text-gray-900 mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-gray-600 mb-8 text-sm leading-relaxed">
                            We encountered an unexpected error. Don't worry, your data is safe.
                            Please try refreshing the page or return to the dashboard.
                        </p>

                        <div className="flex flex-col gap-3">
                            <Button
                                onClick={this.handleReload}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2 h-11"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Refresh Page
                            </Button>

                            <Button
                                variant="outline"
                                onClick={this.handleReset}
                                className="w-full border-gray-200 text-gray-700 hover:bg-gray-50 gap-2 h-11"
                            >
                                <Home className="h-4 w-4" />
                                Back to Dashboard
                            </Button>
                        </div>

                        {process.env.NODE_ENV === "development" && this.state.error && (
                            <div className="mt-8 p-4 bg-gray-900 rounded-lg text-left overflow-auto max-h-40">
                                <code className="text-xs text-red-400 block whitespace-pre">
                                    {this.state.error.stack}
                                </code>
                            </div>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
