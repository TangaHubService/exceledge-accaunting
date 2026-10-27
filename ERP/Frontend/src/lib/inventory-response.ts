/**
 * Normalizes GET /inventory/products/:org responses.
 * Backend: success({ data: products[], lowStockProducts, pagination, ... })
 * → JSON body is { success, data: { data: [...], pagination, ... } }.
 */
export function parseInventoryGetProductsResponse(res: unknown): {
  items: unknown[];
  lowStockProducts: number;
  expiredProducts: number;
  expiringProducts: number;
  pagination: {
    totalItems?: number;
    totalPages?: number;
    currentPage?: number;
    limit?: number;
  };
} {
  const empty = {
    items: [] as unknown[],
    lowStockProducts: 0,
    expiredProducts: 0,
    expiringProducts: 0,
    pagination: {} as {
      totalItems?: number;
      totalPages?: number;
      currentPage?: number;
      limit?: number;
    },
  };
  if (!res || typeof res !== "object") return empty;
  const root = res as Record<string, unknown>;
  if (Array.isArray(root.products)) {
    return { ...empty, items: root.products };
  }
  const payload = root.data;
  if (Array.isArray(payload)) {
    return { ...empty, items: payload };
  }
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    return {
      items: Array.isArray(p.data) ? p.data : [],
      lowStockProducts: Number(p.lowStockProducts ?? 0),
      expiredProducts: Number(p.expiredProducts ?? 0),
      expiringProducts: Number(p.expiringProducts ?? 0),
      pagination:
        p.pagination && typeof p.pagination === "object"
          ? (p.pagination as (typeof empty)["pagination"])
          : {},
    };
  }
  return empty;
}
