import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "../ui/dialog";
import { Button } from "../ui/button";
import { useTheme } from "../../context/ThemeContext";
import { Loader2 } from "lucide-react";

interface ConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: "default" | "destructive" | "warning";
    loading?: boolean;
}

export default function ConfirmDialog({
    open,
    onClose,
    onConfirm,
    title,
    message,
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "default",
    loading = false
}: ConfirmDialogProps) {
    const { theme } = useTheme();

    const getVariantColors = () => {
        switch (variant) {
            case "destructive":
                return {
                    title: theme === "dark" ? "text-red-400" : "text-red-600",
                    button: theme === "dark" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"
                };
            case "warning":
                return {
                    title: theme === "dark" ? "text-amber-400" : "text-amber-600",
                    button: theme === "dark" ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-amber-500 hover:bg-amber-600 text-white"
                };
            default:
                return {
                    title: theme === "dark" ? "text-white" : "text-gray-900",
                    button: "bg-blue-600 hover:bg-blue-700 text-white"
                };
        }
    };

    const colors = getVariantColors();

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent
                className={`sm:max-w-[425px] rounded-2xl shadow-lg border ${theme === "dark"
                    ? "bg-gray-900 border-gray-700 text-gray-100"
                    : "bg-white border-gray-200 text-gray-800"
                    }`}
            >
                <DialogHeader>
                    <DialogTitle className={`text-xl font-semibold ${colors.title}`}>
                        {title}
                    </DialogTitle>
                    <DialogDescription className={theme === "dark" ? "text-gray-400" : "text-gray-500"}>
                        {message}
                    </DialogDescription>
                </DialogHeader>

                <DialogFooter className="flex justify-end gap-3 mt-4">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={loading}
                        className={`px-4 rounded-lg transition-colors ${theme === "dark"
                            ? "border-gray-700 text-gray-300 hover:bg-gray-800"
                            : "border-gray-300 text-gray-700 hover:bg-gray-100"
                            }`}
                    >
                        {cancelText}
                    </Button>
                    <Button
                        onClick={onConfirm}
                        disabled={loading}
                        className={`px-6 rounded-lg font-medium transition-all ${colors.button}`}
                    >
                        {loading ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>{confirmText}...</span>
                            </div>
                        ) : (
                            confirmText
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
