export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  balance: number;
  insuranceProvider?: string;
  countryCode?: string;
  tin?: string | null;
  TIN?: string | null;
  prcOrdCd?: string | null;
  isrccCd?: string | null;
  isrcRt?: number | null;
  address?: string | null;
  custPrvncNm?: string | null;
  custDstrtNm?: string | null;
  custSctrNm?: string | null;
  custLocDesc?: string | null;
  isActive?: boolean;
}

export interface CustomerFormData {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  countryCode?: string;
  type: string;
  tin?: string | null;
  address?: string | null;
  custPrvncNm?: string | null;
  custDstrtNm?: string | null;
  custSctrNm?: string | null;
  custLocDesc?: string | null;
  balance: number;
  isrccCd?: string | null;
  isrcRt?: number | null;
}

export interface CustomerFilters {
  searchTerm: string;
  page: number;
  limit: number;
}
