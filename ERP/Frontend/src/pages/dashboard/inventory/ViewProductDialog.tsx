import { useState } from "react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
  DrawerClose,
} from "../../../components/ui/drawer";
import { Button } from "../../../components/ui/button";
import { useTheme } from "../../../context/ThemeContext";
import { type Product } from "../../../types";
import { useTranslation } from "react-i18next";
import { History, Edit } from "lucide-react";
import InventoryHistoryDialog from "./InventoryHistoryDialog";
import StockAdjustmentDialog from "./StockAdjustmentDialog";
import { PACKAGING_UNIT_LABELS } from "../../../types/ebm";
import { useRraCodeCatalog } from "../../../lib/useRraCodeCatalog";


// Helper function to compute remaining days
function getDaysRemaining(expiryDate: string) {
  const today = new Date();
  const expiry = new Date(expiryDate);
  const diffTime = expiry.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function ViewProductDialog({
  viewProduct,
  setViewProduct,
  onStockUpdated,
}: {
  viewProduct: Product | null;
  setViewProduct: (product: Product | null) => void;
  onStockUpdated?: () => void;
}) {

  const { t } = useTranslation();
  const { theme } = useTheme();
  const { catalog } = useRraCodeCatalog();
  const [showHistory, setShowHistory] = useState(false);
  const [showAdjustment, setShowAdjustment] = useState(false);

  const taxLabel = (() => {
    if (!viewProduct?.taxCode) return '';
    const fromCatalog = catalog.taxTypes.find((t) => t.code === viewProduct.taxCode);
    if (fromCatalog) {
      return fromCatalog.label.includes(fromCatalog.code)
        ? fromCatalog.label
        : `${fromCatalog.code} — ${fromCatalog.label} (${fromCatalog.rate}%)`;
    }
    return viewProduct.taxCode;
  })();


  return (
    <Drawer
      open={!!viewProduct}
      onOpenChange={(open) => !open && setViewProduct(null)}
    >
      <DrawerContent
        className={`sm:max-w-[500px] ${theme === "dark"
          ? "bg-gray-900 border-gray-700 text-gray-100"
          : "bg-white border-gray-200"
          }`}
      >
        <DrawerHeader>
          <DrawerTitle
            className={theme === "dark" ? "text-white" : "text-gray-900"}
          >
            {t('inventory.productDetails')}
          </DrawerTitle>

        </DrawerHeader>

        {viewProduct && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('common.name')}
                </p>
                <p className="mt-1">{viewProduct.name}</p>
              </div>
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  ID
                </p>
                <p className="mt-1 font-mono text-sm select-all break-all">{viewProduct.id}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.category')}
                </p>
                <p className="mt-1">{viewProduct.category || t('common.na')}</p>
              </div>
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.unitPrice')}
                </p>
                <p className="mt-1">{viewProduct.unitPrice} Frw</p>
              </div>
              {viewProduct.purchasePrice != null && (
                <div>
                  <p
                    className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                      }`}
                  >
                    Purchase Price
                  </p>
                  <p className="mt-1">{viewProduct.purchasePrice} Frw</p>
                </div>
              )}
              {viewProduct.taxCode && (
                <div>
                  <p
                    className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                      }`}
                  >
                    Tax Category
                  </p>
                  <p className="mt-1">
                    {taxLabel}
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.quantity')}
                </p>
                <p className="mt-1">{viewProduct.quantity || 0}</p>
              </div>
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.minStock')}
                </p>
                <p className="mt-1">{viewProduct.minStock || 0}</p>
              </div>
            </div>

            {viewProduct.batchNumber && (
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.batchNumber')}
                </p>
                <p className="mt-1 font-mono">{viewProduct.batchNumber}</p>
              </div>
            )}

            {viewProduct.barcode && (
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  Barcode
                </p>
                <p className="mt-1 font-mono">{viewProduct.barcode}</p>
              </div>
            )}

            {viewProduct.pkgUnitCd && (
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  Packaging
                </p>
                <p className="mt-1">
                  {PACKAGING_UNIT_LABELS[viewProduct.pkgUnitCd] || viewProduct.pkgUnitCd}
                  {viewProduct.packagingQty ? ` × ${viewProduct.packagingQty}` : ''}
                </p>
              </div>
            )}

            {viewProduct.expiryDate && (
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('inventory.expiryDate')}
                </p>
                <p className="mt-1">
                  {new Date(viewProduct.expiryDate).toLocaleDateString()}
                  <span className="ml-2 text-sm text-gray-500">
                    ({t('inventory.daysRemainingCount', { count: getDaysRemaining(viewProduct.expiryDate) })})
                  </span>
                </p>
              </div>
            )}

            {viewProduct.description && (
              <div>
                <p
                  className={`text-sm font-medium ${theme === "dark" ? "text-gray-400" : "text-gray-500"
                    }`}
                >
                  {t('common.description')}
                </p>
                <p className="mt-1 text-sm">{viewProduct.description}</p>
              </div>
            )}
          </div>
        )}

        <DrawerFooter className="flex justify-between">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowHistory(true)}
              className={
                theme === "dark" ? "border-gray-700 hover:bg-gray-800" : ""
              }
            >
              <History className="h-4 w-4 mr-2" />
              {t('inventory.viewHistory')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAdjustment(true)}
              className={
                theme === "dark" ? "border-gray-700 hover:bg-gray-800" : ""
              }
            >
              <Edit className="h-4 w-4 mr-2" />
              {t('inventory.adjustStock')}
            </Button>
          </div>
          <DrawerClose asChild>
            <Button
              type="button"
              variant="outline"
              className={
                theme === "dark" ? "border-gray-700 hover:bg-gray-800" : ""
              }
            >
              {t('common.close')}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>

      {/* Inventory History Dialog */}
      <InventoryHistoryDialog
        productId={viewProduct?.id || null}
        productName={viewProduct?.name}
        open={showHistory}
        onOpenChange={setShowHistory}
      />

      {/* Stock Adjustment Dialog */}
      <StockAdjustmentDialog
        productId={viewProduct?.id || null}
        productName={viewProduct?.name}
        currentStock={viewProduct?.quantity}
        open={showAdjustment}
        onOpenChange={setShowAdjustment}
        onSuccess={() => {
          onStockUpdated?.();
          setViewProduct(null); // Close product dialog after adjustment
        }}
      />
    </Drawer>
  );
}
