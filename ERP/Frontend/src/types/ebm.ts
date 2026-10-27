export enum RraTaxCode {
  A = 'A',
  B = 'B',
  C = 'C',
  D = 'D',
  E = 'E',
}

export const RRA_TAX_CODE_LABELS: Record<RraTaxCode, string> = {
  [RraTaxCode.A]: 'A — VAT Exempt (0%)',
  [RraTaxCode.B]: 'B — Standard VAT (18%)',
  [RraTaxCode.C]: 'C — Export / Zero-rated (0%)',
  [RraTaxCode.D]: 'D — Not VAT Registered (0%)',
  [RraTaxCode.E]: 'E — Other',
};

export const RRA_TAX_CODE_OPTIONS = Object.entries(RRA_TAX_CODE_LABELS).map(([value, label]) => ({
  value: value as RraTaxCode,
  label,
}));

export enum MeasurementUnit {
  PCS = 'PCS',
  KG = 'KG',
  LTR = 'LTR',
  MTR = 'MTR',
  BOX = 'BOX',
  PAIR = 'PAIR',
  DOZEN = 'DOZEN',
  GRAM = 'GRAM',
  ML = 'ML',
  OTHER = 'OTHER',
}

export type ProductType = 'PRODUCT' | 'RAW_MATERIAL' | 'SERVICE';

export const MEASUREMENT_UNIT_LABELS: Record<MeasurementUnit, string> = {
  [MeasurementUnit.PCS]: 'Pieces',
  [MeasurementUnit.KG]: 'Kilograms',
  [MeasurementUnit.LTR]: 'Litres',
  [MeasurementUnit.MTR]: 'Mètres',
  [MeasurementUnit.BOX]: 'Boxes',
  [MeasurementUnit.PAIR]: 'Pairs',
  [MeasurementUnit.DOZEN]: 'Dozens',
  [MeasurementUnit.GRAM]: 'Grams',
  [MeasurementUnit.ML]: 'Millilitres',
  [MeasurementUnit.OTHER]: 'Other',
};

export const MEASUREMENT_UNIT_OPTIONS = Object.entries(MEASUREMENT_UNIT_LABELS).map(
  ([value, label]) => ({ value: value as MeasurementUnit, label }),
);

/**
 * RRA/EBM packaging unit codes (product `pkgUnitCd`). This is how a product is
 * physically packaged for sale/purchase — e.g. a carton of bottles — distinct
 * from `MeasurementUnit`, which is the base unit the product is measured/sold in.
 *
 * Sourced from RRA's authoritative VSDC code list (`POST /code/selectCodes`,
 * class "17" — Packing Unit; cached locally in the `rra_codes` table by
 * `rra-master-data.service.ts`). The previous version of this table was
 * hand-guessed and included codes RRA doesn't recognize (e.g. "EA", "BX"),
 * which VSDC rejects with `resultCd 913: Code value error ... [<pkgUnitCd>]`.
 */
export const PACKAGING_UNIT_LABELS: Record<string, string> = {
  AM: 'Ampoule',
  BA: 'Barrel',
  BC: 'Bottlecrate',
  BE: 'Bundle',
  BF: 'Balloon, non-protected',
  BG: 'Bag',
  BJ: 'Bucket',
  BK: 'Basket',
  BL: 'Bale',
  BQ: 'Bottle, protected cylindrical',
  BR: 'Bar',
  BV: 'Bottle, bulbous',
  BZ: 'Bag',
  CA: 'Can',
  CH: 'Chest',
  CJ: 'Coffin',
  CL: 'Coil',
  CR: 'Wooden Box, Wooden Case',
  CS: 'Cassette',
  CT: 'Carton',
  CTN: 'Container',
  CY: 'Cylinder',
  DR: 'Drum',
  GT: 'Extra Countable Item',
  HH: 'Hand Baggage',
  IZ: 'Ingots',
  JR: 'Jar',
  JU: 'Jug',
  JY: 'Jerry Can Cylindrical',
  KZ: 'Canester',
  LZ: 'Logs, in bundle/bunch/truss',
  ML: 'Mills',
  NT: 'Net',
  OU: 'Non-Exterior Packaging Unit',
  PD: 'Poddon',
  PG: 'Plate',
  PI: 'Pipe',
  PO: 'Pilot',
  PU: 'Traypack',
  RL: 'Reel',
  RO: 'Roll',
  RZ: 'Rods, in bundle/bunch/truss',
  SK: 'Skeletoncase',
  TN: 'TAN',
  TY: 'Tank, cylindrical',
  VG: 'Bulk, gas (at 1031 mbar 15°C)',
  VL: 'Bulk, liquid (at normal temperature/pressure)',
  VO: 'Bulk, solid, large particles (nodules)',
  VQ: 'Bulk, gas (liquefied at abnormal temperature/pressure)',
  VR: 'Bulk, solid, granular particles (grains)',
  VT: 'Extra Bulk Item',
  VY: 'Bulk, fine particles (powder)',
};

export const PACKAGING_UNIT_OPTIONS = Object.entries(PACKAGING_UNIT_LABELS).map(
  ([value, label]) => ({ value, label: `${label} (${value})` }),
);

/**
 * RRA/EBM quantity unit codes (product `qtyUnitCd`) — the unit each item inside
 * the package is counted/measured in.
 *
 * Sourced from RRA's authoritative VSDC code list (`POST /code/selectCodes`,
 * class "10" — Quantity Unit; cached locally in the `rra_codes` table by
 * `rra-master-data.service.ts`). The previous version of this table included
 * codes RRA doesn't recognize (e.g. "G", "TN", "ML", "NT"), which VSDC rejects
 * with `resultCd 913: Code value error ... [<qtyUnitCd>]`.
 */
export const QUANTITY_UNIT_LABELS: Record<string, string> = {
  '4B': 'Pair',
  AV: 'Cap',
  BA: 'Barrel',
  BE: 'Bundle',
  BG: 'Bag',
  BL: 'Block',
  BLL: 'Barrel (petroleum)',
  BX: 'Box',
  CA: 'Can',
  CEL: 'Cell',
  CMT: 'Centimetre',
  CR: 'Carat',
  DR: 'Drum',
  DZ: 'Dozen',
  GLL: 'Gallon',
  GRM: 'Gram',
  GRO: 'Gross',
  KG: 'Kilogram',
  KTM: 'Kilometre',
  KWT: 'Kilowatt',
  L: 'Litre',
  LBR: 'Pound',
  LK: 'Link',
  LTR: 'Litre',
  M: 'Metre',
  M2: 'Square metre',
  M3: 'Cubic metre',
  MGM: 'Milligram',
  MTR: 'Metre',
  MWT: 'Megawatt hour',
  NO: 'Number',
  NX: 'Part per thousand',
  PA: 'Packet',
  PG: 'Plate',
  PR: 'Pair',
  RL: 'Reel',
  RO: 'Roll',
  SET: 'Set',
  ST: 'Sheet',
  TNE: 'Tonne (metric ton)',
  TU: 'Tube',
  U: 'Pieces / Item',
  YRD: 'Yard',
};

export const QUANTITY_UNIT_OPTIONS = Object.entries(QUANTITY_UNIT_LABELS).map(
  ([value, label]) => ({ value, label: `${label} (${value})` }),
);

/**
 * RRA/EBM origin-country codes (product `origin`, VSDC `OrgplceCd`) — ISO
 * 3166-1 alpha-2. Rwanda is listed first since it's the overwhelmingly common
 * default for locally sourced goods.
 */
export const ORIGIN_COUNTRY_LABELS: Record<string, string> = {
  RW: 'Rwanda',
  UG: 'Uganda',
  KE: 'Kenya',
  TZ: 'Tanzania',
  BI: 'Burundi',
  CD: 'DR Congo',
  SS: 'South Sudan',
  ET: 'Ethiopia',
  EG: 'Egypt',
  ZA: 'South Africa',
  NG: 'Nigeria',
  GH: 'Ghana',
  MA: 'Morocco',
  TN: 'Tunisia',
  DZ: 'Algeria',
  SN: 'Senegal',
  CI: "Côte d'Ivoire",
  CM: 'Cameroon',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
  MW: 'Malawi',
  MZ: 'Mozambique',
  AO: 'Angola',
  NA: 'Namibia',
  BW: 'Botswana',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  TR: 'Turkey',
  IN: 'India',
  CN: 'China',
  JP: 'Japan',
  KR: 'South Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  ID: 'Indonesia',
  TH: 'Thailand',
  VN: 'Vietnam',
  PK: 'Pakistan',
  BD: 'Bangladesh',
  GB: 'United Kingdom',
  IE: 'Ireland',
  FR: 'France',
  DE: 'Germany',
  NL: 'Netherlands',
  BE: 'Belgium',
  IT: 'Italy',
  ES: 'Spain',
  PT: 'Portugal',
  CH: 'Switzerland',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  PL: 'Poland',
  RU: 'Russia',
  UA: 'Ukraine',
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  AU: 'Australia',
  NZ: 'New Zealand',
};

export const ORIGIN_COUNTRY_OPTIONS = Object.entries(ORIGIN_COUNTRY_LABELS).map(
  ([value, label]) => ({ value, label: `${label} (${value})` }),
);

/**
 * Built-in RRA item classification codes (`itemClsCd`) for offline create when
 * `/itemClass/selectItemsClass` sync is unavailable (VSDC often returns 894
 * when RRA is unreachable).
 *
 * Only 10-digit codes verified against local VSDC `/items/saveItems`
 * (resultCd 000). Prefer syncing the live list via Fiscal Reports when the
 * gateway can reach RRA. Unknown codes are rejected with resultCd 910.
 */
/** Codes verified against local VSDC `/items/saveItems` (resultCd 000). */
export const ITEM_CLASSIFICATION_LABELS: Record<string, string> = {
  '5059690800': 'General merchandise',
  '5022110801': 'Food products',
  '5015151300': 'Beverages',
  '1110170400': 'Soft drinks / beverages',
  '1110162100': 'Grocery commodities',
  '1110151600': 'Packaged food',
  '1110160600': 'Raw / mineral materials',
  '3026530000': 'Metal bars / construction materials',
  '5612180500': 'Furniture & fittings materials',
  '3133130600': 'Non-metallic structural components',
};

export const ITEM_CLASSIFICATION_OPTIONS = Object.entries(ITEM_CLASSIFICATION_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export type EbmOutboxStatus = 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER';

export const OUTBOX_STATUS_CONFIG: Record<EbmOutboxStatus, { label: string; color: string }> = {
  PENDING: { label: 'Pending (Offline)', color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
  PROCESSING: { label: 'Submitted', color: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  SUCCEEDED: { label: 'Fiscalized', color: 'text-green-600 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  FAILED: { label: 'Failed', color: 'text-red-600 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
  DEAD_LETTER: { label: 'UN-FISCALIZED', color: 'text-rose-700 bg-rose-50 dark:bg-rose-900/20 border-rose-300 dark:border-rose-800 font-bold' },
};

export interface EbmOutboxEntry {
  id: number;
  organizationId: number;
  saleId: number;
  operation: string;
  idempotencyKey: string;
  status: EbmOutboxStatus;
  retryCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sdcDateTime: string | null;
  createdAt: string;
  sale?: {
    saleNumber: string;
    invoiceNumber: string | null;
    totalAmount: number;
    createdAt: string;
  };
}
