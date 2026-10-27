export interface Supplier {
  id: number;
  name: string;
  email: string;
  phone?: string;
  contactPerson?: string;
  address?: string;
}

export interface FormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  contactPerson: string;
}

export interface SupplierRowProps {
  supplier: Supplier;
  onEdit: (supplier: Supplier) => void;
  onDelete: (id: string | number) => void;
}

export interface SuppliersTableProps {
  suppliers: Supplier[];
  onAdd: () => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (id: string | number) => void;
}

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export interface SuppliersCardProps {
  loading: boolean;
  suppliers: Supplier[];
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onAdd: () => void;
  onEdit: (supplier: Supplier) => void;
  onDelete: (id: string | number) => void;
}

export interface SupplierDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editingSupplier: Supplier | null;
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  onSubmit: (e: React.FormEvent) => void;
}

export interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  onClose: () => void;
}

export interface SuppliersPageProps {
  apiClient: any; // Using any to avoid complex interface matching since apiClient is a class
  organizationId: string | number;
}

export type Order = {
  id: number;
  orderNumber: string;
  status: string;
  totalAmount: string;
  orderedAt: string;
  expectedDeliveryDate: string | null;
  supplier: {
    id: number;
    name: string;
    email: string;
    phone?: string;
  };
  items: Array<{
    id: number;
    productName: string;
    quantity: number;
    quantityReceived?: number;
    unitPrice: string;
    totalPrice: string;
  }>;
};

export type OrdersListProps = {
  organizationId: string | number;
};
